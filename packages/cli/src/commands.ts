import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import type { ChatEntry, ChatState, CoreMessage } from '@kothar/core/shared'
import { CliError, connect, garageOf, type Connection } from './client.ts'

// The kothar CLI: drives a running Kothar from a terminal or a script, over the same WebSocket the window uses.
// Exit codes, for scripts: EXIT below.

export const EXIT = {
  ok: 0,
  // The turn failed, the core refused, or no chat matched.
  failed: 1,
  usage: 2,
  // send --wait stopped at a permission request, a question or an extension waiting on the user. The chat waits too:
  // answer in the app, or with kothar approve / deny.
  needsYou: 3,
  timedOut: 4,
} as const

export type Io = {
  env: Record<string, string | undefined>
  stdout: (text: string) => void
  stderr: (text: string) => void
  cwd?: string
}

const HELP = `kothar: drive a running Kothar from the terminal.

Usage:
  kothar list [--all] [--json]              spaces and their workers, with status
  kothar new <folder> [--name N] [--engine E] [--json]
                                            make a space on a folder; prints its id
  kothar send <chat> <message> [--wait] [--approve] [--timeout S] [--quiet]
                                            send a message; with --wait, stream the reply and
                                            exit when the turn ends
  kothar status <chat> [--json]             status, engine, model, queue, pending requests
  kothar read <chat> [--last N] [--tools] [--json]
                                            the latest messages (default 10)
  kothar stop <chat> [--force]              stop the running turn
  kothar approve <chat> [request]           approve a pending permission request
  kothar deny <chat> [request]              deny one

<chat> is a chat's id, the start of one, or a space's name. Home is "home".
Kothar must be running; the CLI finds it through the garage (KOTHAR_GARAGE, else
~/Library/Application Support/Kothar).

send --wait exits 0 when the turn ends, 1 if it failed, 3 when it stops at a
permission request or question (the chat keeps waiting; use approve or deny, or
pass --approve to allow every request during the wait), 4 on --timeout.
`

type Options = NonNullable<ParseArgsConfig['options']>
const json: Options = { json: { type: 'boolean' } }
const COMMANDS: Record<string, { options: Options; positionals: [number, number] }> = {
  list: { options: { all: { type: 'boolean' }, ...json }, positionals: [0, 0] },
  new: { options: { name: { type: 'string' }, engine: { type: 'string' }, ...json }, positionals: [1, 1] },
  send: {
    options: {
      wait: { type: 'boolean', short: 'w' },
      approve: { type: 'boolean' },
      timeout: { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
    },
    positionals: [2, Infinity],
  },
  status: { options: json, positionals: [1, 1] },
  read: { options: { last: { type: 'string', short: 'n' }, tools: { type: 'boolean' }, ...json }, positionals: [1, 1] },
  stop: { options: { force: { type: 'boolean' } }, positionals: [1, 1] },
  approve: { options: {}, positionals: [1, 2] },
  deny: { options: {}, positionals: [1, 2] },
}

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(HELP)
    return command ? EXIT.ok : EXIT.usage
  }
  const spec = COMMANDS[command]
  if (!spec) {
    io.stderr(`kothar: unknown command "${command}". Run kothar --help.\n`)
    return EXIT.usage
  }
  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({ args: rest, options: spec.options, allowPositionals: true, strict: true }) as {
      values: Record<string, string | boolean | undefined>
      positionals: string[]
    })
  } catch (error) {
    io.stderr(`kothar ${command}: ${(error as Error).message}\n`)
    return EXIT.usage
  }
  const [min, max] = spec.positionals
  if (positionals.length < min || positionals.length > max) {
    io.stderr(`kothar ${command}: wrong number of arguments. Run kothar --help.\n`)
    return EXIT.usage
  }

  let connection: Connection | undefined
  try {
    connection = await connect(garageOf(io.env))
    const args = { connection, values, positionals, io }
    switch (command) {
      case 'list':
        return list(args)
      case 'new':
        return await create(args)
      case 'send':
        return await send(args)
      case 'status':
        return status(args)
      case 'read':
        return await read(args)
      case 'stop':
        return await stop(args)
      default:
        return respond(args, command === 'approve')
    }
  } catch (error) {
    io.stderr(`kothar ${command}: ${error instanceof Error ? error.message : String(error)}\n`)
    return error instanceof CliError ? error.code : EXIT.failed
  } finally {
    connection?.close()
  }
}

type Args = {
  connection: Connection
  values: Record<string, string | boolean | undefined>
  positionals: string[]
  io: Io
}

const HOME_ID = 'main'

/** The chat a user names: its id, a unique start of one (4+ characters), or a space's name, ignoring case. */
export function findChat(chats: Iterable<ChatState>, query: string): ChatState {
  const all = [...chats]
  const q = query.trim()
  if (q.toLowerCase() === 'home') {
    const home = all.find((chat) => chat.id === HOME_ID)
    if (home) return home
  }
  const byId = all.find((chat) => chat.id === q)
  if (byId) return byId
  const named = all.filter((chat) => !chat.parentId && chat.name.toLowerCase() === q.toLowerCase())
  const live = named.filter((chat) => !chat.archived)
  if (live.length === 1 || (live.length === 0 && named.length === 1)) return (live[0] ?? named[0])!
  if (named.length > 1) throw new CliError(`More than one space is called "${q}": ${named.map((c) => c.id).join(', ')}. Use an id.`)
  const prefixed = q.length >= 4 ? all.filter((chat) => chat.id.startsWith(q)) : []
  if (prefixed.length === 1) return prefixed[0]!
  if (prefixed.length > 1) throw new CliError(`"${q}" starts more than one chat's id: ${prefixed.map((c) => c.id).join(', ')}.`)
  throw new CliError(`No chat called or with the id "${q}". Run kothar list.`)
}

const write = (io: Io, value: unknown) => io.stdout(JSON.stringify(value, null, 2) + '\n')

const pendingRequests = (chat: ChatState) => {
  const resolved = new Set(
    chat.entries.flatMap((entry) =>
      entry.type === 'permission.resolved' || entry.type === 'question.resolved' ? [entry.requestId] : [],
    ),
  )
  return chat.entries.filter(
    (entry): entry is Extract<ChatEntry, { type: 'permission.requested' | 'question.asked' }> =>
      (entry.type === 'permission.requested' || entry.type === 'question.asked') && !resolved.has(entry.requestId),
  )
}

const modelOf = (chat: ChatState) => `${chat.run?.engine ?? chat.engine}${chat.run?.model ?? chat.model ? ` / ${chat.run?.model ?? chat.model}` : ''}`

function list({ connection, values, io }: Args) {
  const chats = [...connection.chats.values()].filter((chat) => values.all || !chat.archived)
  if (values.json) {
    write(
      io,
      chats.map(({ id, name, parentId, status, archived, engine, folders }) => ({
        id,
        name,
        status,
        engine,
        folders,
        ...(parentId && { parentId }),
        ...(archived && { archived }),
      })),
    )
    return EXIT.ok
  }
  const children = new Map<string, ChatState[]>()
  for (const chat of chats) if (chat.parentId) children.set(chat.parentId, [...(children.get(chat.parentId) ?? []), chat])
  const rows: string[][] = []
  const add = (chat: ChatState, depth: number) => {
    rows.push([chat.id, chat.status + (chat.archived ? ' (archived)' : ''), `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${chat.name}`])
    for (const child of children.get(chat.id) ?? []) add(child, depth + 1)
  }
  const tops = chats.filter((chat) => !chat.parentId || !connection.chats.has(chat.parentId))
  // Home first, then spaces as the sidebar has them: pinned, then by order, newest first.
  tops.sort((a, b) =>
    a.id === HOME_ID ? -1 : b.id === HOME_ID ? 1 : Number(!!b.pinned) - Number(!!a.pinned) || (a.order ?? -1) - (b.order ?? -1) || b.createdAt.localeCompare(a.createdAt),
  )
  for (const chat of tops) add(chat, 0)
  if (!rows.length) return io.stdout('No spaces yet. Make one with kothar new <folder>.\n'), EXIT.ok
  const widths = [0, 1].map((i) => Math.max(...rows.map((row) => row[i]!.length)))
  for (const row of rows) io.stdout(`${row[0]!.padEnd(widths[0]!)}  ${row[1]!.padEnd(widths[1]!)}  ${row[2]}\n`)
  return EXIT.ok
}

// Waits for a message from the core that `pick` turns into a result, or for an error reply. Returns the stop.
function waitFor<T>(
  connection: Connection,
  pick: (message: CoreMessage) => T | undefined,
  timeoutMs = 15_000,
  what = 'the core',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new CliError(`Timed out waiting for ${what}.`))
    }, timeoutMs)
    const stop = connection.listen((message) => {
      if (message.type === 'error') {
        stop()
        clearTimeout(timer)
        return reject(new CliError(message.message))
      }
      const result = pick(message)
      if (result === undefined) return
      stop()
      clearTimeout(timer)
      resolve(result)
    })
  })
}

async function create({ connection, values, positionals, io }: Args) {
  const given = resolve(io.cwd ?? process.cwd(), positionals[0]!)
  if (!existsSync(given) || !statSync(given).isDirectory()) throw new CliError(`No folder at ${given}.`, EXIT.usage)
  // The core keeps folders by their real path (/tmp is /private/tmp on macOS), so that's the one to match.
  const folder = realpathSync(given)
  const name = typeof values.name === 'string' && values.name.trim() ? values.name.trim() : basename(folder)
  const engine = typeof values.engine === 'string' ? values.engine : undefined
  // chat.create has no reply of its own: the new space is the one broadcast with this name and folder.
  const added = waitFor(connection, (message) =>
    message.type === 'chat.added' && !message.chat.parentId && message.chat.name === name && message.chat.folders.includes(folder)
      ? message.chat
      : undefined,
  )
  connection.send({ type: 'chat.create', name, folders: [folder], ...(engine && { engine }) })
  const chat = await added
  if (values.json) write(io, { id: chat.id, name: chat.name, engine: chat.engine, folders: chat.folders })
  else io.stdout(`${chat.id}\n`)
  return EXIT.ok
}

function status({ connection, values, positionals, io }: Args) {
  const chat = findChat(connection.chats.values(), positionals[0]!)
  const pending = pendingRequests(chat)
  const waits = chat.waits ?? []
  if (values.json) {
    write(io, {
      id: chat.id,
      name: chat.name,
      status: chat.status,
      engine: chat.run?.engine ?? chat.engine,
      model: chat.run?.model ?? chat.model,
      folders: chat.folders,
      queued: chat.queue.length,
      pending: pending.map((entry) => ({ requestId: entry.requestId, ...describe(entry) })),
      waits: waits.map((wait) => ({ extension: wait.extension, text: wait.text })),
      ...(chat.parentId && { parentId: chat.parentId }),
      ...(chat.archived && { archived: true }),
    })
    return EXIT.ok
  }
  const lines = [
    `${chat.name} (${chat.id})`,
    `status:  ${chat.status}${chat.archived ? ', archived' : ''}`,
    `engine:  ${modelOf(chat)}`,
    ...(chat.parentId ? [`lead:    ${chat.parentId}`] : []),
    ...(chat.folders.length ? [`folders: ${chat.folders.join(', ')}`] : []),
    ...(chat.queue.length ? [`queued:  ${chat.queue.length} message${chat.queue.length === 1 ? '' : 's'}`] : []),
    ...pending.map((entry) => `waiting: ${describe(entry).summary} (request ${entry.requestId})`),
    ...waits.map((wait) => `waiting: ${wait.text} (${wait.extension})`),
  ]
  io.stdout(lines.join('\n') + '\n')
  return EXIT.ok
}

const describe = (entry: Extract<ChatEntry, { type: 'permission.requested' | 'question.asked' }>) =>
  entry.type === 'permission.requested'
    ? { kind: 'permission', summary: `${entry.name}: ${entry.command ?? entry.path ?? entry.summary}` }
    : { kind: 'question', summary: entry.questions.map((q) => q.question).join(' / ') }

// What read prints for an entry, or nothing for one it skips.
function render(entry: ChatEntry, tools: boolean): string | undefined {
  switch (entry.type) {
    case 'user.message':
      return `you: ${entry.text}`
    case 'text.completed':
      return `agent: ${entry.text}`
    case 'worker.report':
      return `worker "${entry.name}"${entry.error ? ` (${entry.error})` : ''}: ${entry.text}`
    case 'turn.completed':
    case 'session.ended':
      return entry.error ? `error: ${entry.error}` : undefined
    case 'tool.started':
      return tools ? `tool: ${entry.name} ${entry.summary}` : undefined
    case 'permission.requested':
    case 'question.asked':
      return tools ? `asked: ${describe(entry).summary}` : undefined
    default:
      return undefined
  }
}

async function read({ connection, values, positionals, io }: Args) {
  const chat = findChat(connection.chats.values(), positionals[0]!)
  const last = values.last === undefined ? 10 : Number(values.last)
  if (!Number.isInteger(last) || last < 1) throw new CliError('--last takes a whole number above 0.', EXIT.usage)
  const tools = values.tools === true
  const shown = (entries: ChatEntry[]) => entries.filter((entry) => render(entry, tools) !== undefined)
  // The snapshot has the latest page of the log; older pages come from chat.history.
  let entries = chat.entries
  let from = chat.from ?? 0
  while (shown(entries).length < last && from > 0) {
    const before = from
    const page = await waitFor(connection, (message) =>
      message.type === 'chat.history' && message.chatId === chat.id && message.before === before ? message : undefined,
    )
    connection.send({ type: 'chat.history', chatId: chat.id, before })
    const { entries: older, from: start } = await page
    if (start >= before) break
    entries = [...older, ...entries]
    from = start
  }
  const picked = shown(entries).slice(-last)
  if (values.json) write(io, picked)
  else for (const entry of picked) io.stdout(render(entry, tools)! + '\n')
  return EXIT.ok
}

async function stop({ connection, values, positionals, io }: Args) {
  const chat = findChat(connection.chats.values(), positionals[0]!)
  if (chat.status === 'idle') return io.stdout(`${chat.name} isn't running.\n`), EXIT.ok
  const stopped = waitFor(
    connection,
    (message) => (message.type === 'chat.status' && message.chatId === chat.id && message.status === 'idle' ? true : undefined),
    30_000,
    'the turn to stop',
  )
  connection.send({ type: 'chat.interrupt', chatId: chat.id, ...(values.force && { force: true }) })
  await stopped
  io.stdout(`Stopped ${chat.name}.\n`)
  return EXIT.ok
}

function respond({ connection, positionals, io }: Args, allow: boolean) {
  const chat = findChat(connection.chats.values(), positionals[0]!)
  const pending = pendingRequests(chat).filter((entry) => entry.type === 'permission.requested')
  const requestId = positionals[1]
  const request = requestId ? pending.find((entry) => entry.requestId === requestId) : pending.length === 1 ? pending[0] : undefined
  if (!request) {
    if (!pending.length) throw new CliError(`${chat.name} has no permission request waiting.`)
    if (requestId) throw new CliError(`No permission request ${requestId} waiting in ${chat.name}.`)
    throw new CliError(
      `${chat.name} has ${pending.length} requests waiting; name one:\n` +
        pending.map((entry) => `  ${entry.requestId}  ${describe(entry).summary}`).join('\n'),
      EXIT.usage,
    )
  }
  connection.send({ type: 'permission.respond', chatId: chat.id, requestId: request.requestId, allow })
  io.stdout(`${allow ? 'Approved' : 'Denied'}: ${describe(request).summary}\n`)
  return EXIT.ok
}

async function send({ connection, values, positionals, io }: Args) {
  const chat = findChat(connection.chats.values(), positionals[0]!)
  const text = positionals.slice(1).join(' ')
  if (!text.trim()) throw new CliError('The message is empty.', EXIT.usage)
  const timeout = values.timeout === undefined ? undefined : Number(values.timeout)
  if (timeout !== undefined && !(timeout > 0)) throw new CliError('--timeout takes seconds above 0.', EXIT.usage)
  const quiet = values.quiet === true
  const note = (line: string) => quiet || io.stderr(line + '\n')

  if (!values.wait) {
    // The core answers a refused send with an error; give it a moment to say so.
    const refused = waitFor(connection, () => undefined, 300).catch((error: CliError) =>
      error.message.startsWith('Timed out') ? undefined : error,
    )
    connection.send({ type: 'chat.send', chatId: chat.id, text })
    const error = await refused
    if (error) throw error
    note(`Sent to ${chat.name}${chat.status === 'idle' ? '' : ' (queued behind its running turn)'}.`)
    return EXIT.ok
  }

  return new Promise<number>((done) => {
    // Our turn starts when the core logs our message (it may wait in the queue first). Until then, others' turns
    // stream here too, and are ignored.
    let started = false
    let streamed = ''
    let error: string | undefined
    const timer = timeout && setTimeout(() => finish(EXIT.timedOut, `Timed out after ${timeout}s; the turn goes on.`), timeout * 1000)
    const finish = (code: number, message?: string) => {
      if (timer) clearTimeout(timer)
      stopListening()
      if (streamed) io.stdout('\n')
      if (message) io.stderr(message + '\n')
      done(code)
    }
    // The core logs a request before its rules decide on it, and may answer it at once; only what's left once the chat
    // is waiting is the user's to answer.
    const approved = new Set<string>()
    const waiting = () => {
      const pending = pendingRequests(connection.chats.get(chat.id) ?? chat)
      const question = pending.find((entry) => entry.type === 'question.asked')
      if (question) return finish(EXIT.needsYou, `Waiting for an answer: ${describe(question).summary}\nAnswer in the app. The turn waits.`)
      for (const request of pending) {
        if (!values.approve) {
          return finish(
            EXIT.needsYou,
            `Waiting for permission: ${describe(request).summary}\n` +
              `Answer in the app, or run: kothar approve ${chat.id} ${request.requestId} (or deny). The turn waits.`,
          )
        }
        if (approved.has(request.requestId)) continue
        approved.add(request.requestId)
        note(`Approved: ${describe(request).summary}`)
        connection.send({ type: 'permission.respond', chatId: chat.id, requestId: request.requestId, allow: true })
      }
    }
    const stopListening = connection.listen((message) => {
      if (message.type === 'error') return finish(EXIT.failed, message.message)
      if (!('chatId' in message) || message.chatId !== chat.id) return
      if (message.type === 'chat.entry' && message.entry.type === 'user.message' && message.entry.text.trim() === text.trim()) {
        started = true
        return
      }
      if (!started) return
      switch (message.type) {
        case 'chat.delta':
          streamed += message.text
          return io.stdout(message.text)
        case 'chat.waits':
          if (message.waits.length)
            return finish(EXIT.needsYou, message.waits.map((wait) => `Waiting on you: ${wait.text} (${wait.extension}, answer in the app)`).join('\n'))
          return
        case 'chat.status':
          if (message.status === 'idle') return finish(error ? EXIT.failed : EXIT.ok, error && `Failed: ${error}`)
          if (message.status === 'waiting') return waiting()
          return
        case 'chat.entry':
          break
        default:
          return
      }
      const entry = message.entry
      switch (entry.type) {
        case 'text.completed':
          // An engine that doesn't stream sends only the finished text.
          if (!streamed) io.stdout(entry.text)
          io.stdout('\n')
          streamed = ''
          return
        case 'tool.started':
          return note(`· ${entry.name} ${entry.summary}`)
        case 'turn.completed':
        case 'session.ended':
          if (entry.error) error = entry.error
          return
        case 'limit.reached':
          error = entry.message
          return
      }
    })
    connection.send({ type: 'chat.send', chatId: chat.id, text })
  })
}
