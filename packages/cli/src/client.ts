import { homedir } from 'node:os'
import { join } from 'node:path'
import { readCliAccess } from '@kothar/core/cli-access'
import type { ChatState, ClientMessage, CoreMessage } from '@kothar/core/shared'
import WebSocket from 'ws'

// A connection to a running core, as the kothar CLI sees it: the chats from the snapshot, kept up to date from what the
// core broadcasts. The core is found through <garage>/cli.json (cli-access.ts in the core).

// An error the CLI explains in its own words, with the exit code it ends with.
export class CliError extends Error {
  readonly code: number
  constructor(message: string, code = 1) {
    super(message)
    this.code = code
  }
}

// The garage as the core picks it: KOTHAR_GARAGE, else the app's folder under Application Support.
export const garageOf = (env: Record<string, string | undefined>, home = homedir()) =>
  env.KOTHAR_GARAGE || join(home, 'Library', 'Application Support', 'Kothar')

export type Connection = {
  chats: Map<string, ChatState>
  send: (message: ClientMessage) => void
  // Every message from the core after the snapshot, after the chats are updated from it. Returns the unsubscribe.
  listen: (listener: (message: CoreMessage) => void) => () => void
  close: () => void
}

export async function connect(garage: string): Promise<Connection> {
  const access = readCliAccess(garage)
  if (!access) throw new CliError(`Kothar isn't running (no ${join(garage, 'cli.json')}). Start the app first.`)
  // No Origin header: the core takes the CLI's token only from a socket without one.
  const socket = new WebSocket(`ws://127.0.0.1:${access.port}/?token=${encodeURIComponent(access.token)}`)
  const chats = new Map<string, ChatState>()
  const listeners = new Set<(message: CoreMessage) => void>()

  const apply = (message: CoreMessage) => {
    switch (message.type) {
      case 'chat.added':
        chats.set(message.chat.id, message.chat)
        break
      case 'chat.updated': {
        const old = chats.get(message.chat.id)
        // The update carries the chat's info alone, and replaces it: a cleared field is simply absent.
        if (old) chats.set(old.id, { ...message.chat, status: old.status, entries: old.entries, from: old.from, draft: old.draft, queue: old.queue, waits: old.waits })
        break
      }
      case 'chat.removed':
        chats.delete(message.chatId)
        break
      case 'chat.status': {
        const chat = chats.get(message.chatId)
        if (chat) chat.status = message.status
        break
      }
      case 'chat.queue': {
        const chat = chats.get(message.chatId)
        if (chat) chat.queue = message.queue
        break
      }
      case 'chat.waits': {
        const chat = chats.get(message.chatId)
        if (chat) chat.waits = message.waits
        break
      }
      case 'chat.entry': {
        const chat = chats.get(message.chatId)
        if (chat) chat.entries.push(message.entry)
        break
      }
      case 'chat.log': {
        const chat = chats.get(message.chatId)
        if (chat) Object.assign(chat, { entries: message.entries, from: message.from })
        break
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    socket.once('message', (data) => {
      const message = JSON.parse(String(data)) as CoreMessage
      if (message.type !== 'snapshot') return reject(new CliError('The core sent no snapshot.'))
      for (const chat of message.chats) chats.set(chat.id, chat)
      resolve()
    })
    socket.once('unexpected-response', (_request, response) =>
      reject(new CliError(`The core refused the connection (${response.statusCode}). Is it an older Kothar?`)),
    )
    socket.once('close', (code, reason) => reject(new CliError(`The core closed the connection: ${String(reason) || code}`)))
    socket.once('error', (error) =>
      reject(
        new CliError(
          (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
            ? `Kothar isn't running (nothing on port ${access.port}).`
            : error.message,
        ),
      ),
    )
  })
  socket.removeAllListeners()
  socket.on('error', () => {})
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as CoreMessage
    apply(message)
    for (const listener of listeners) listener(message)
  })
  socket.on('close', () => {
    for (const listener of listeners) listener({ type: 'error', message: 'The core closed the connection.' })
  })

  return {
    chats,
    send: (message) => socket.send(JSON.stringify(message)),
    listen: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => socket.close(),
  }
}
