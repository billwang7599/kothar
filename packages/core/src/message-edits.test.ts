import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Extension, MessagesRemoved } from '@kothar/extension-api'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAdapter, type FakeStep } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import { openCore } from './core.ts'
import { messagesOf } from './memory.ts'
import { entriesFrom, entriesToDelete } from './message-edits.ts'
import type { Adapter, ChatEntry, ClientMessage, CoreMessage } from './shared.ts'
import { until } from './test-wait.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString()

describe('what one Delete takes', () => {
  const log: ChatEntry[] = [
    { at: at(0), type: 'user.message', text: 'first' },
    { at: at(1), type: 'turn.started' },
    { at: at(2), type: 'extension.note', text: 'an artifact' },
    { at: at(3), type: 'tool.started', toolId: 't', name: 'Bash', kind: 'shell', summary: 'ls', input: {} },
    { at: at(4), type: 'tool.completed', toolId: 't', output: 'a b', isError: false },
    { at: at(5), type: 'text.completed', text: 'reply' },
    { at: at(6), type: 'turn.completed' },
    { at: at(7), type: 'user.message', text: 'second' },
  ]

  it("is the user's message alone", () => {
    expect(entriesToDelete(log, 7)).toEqual([7])
  })

  // Thinking isn't logged at all, only streamed, so there is none to delete.
  it("is a reply with the tool calls and notes around it, but not the turn's markers", () => {
    expect(entriesToDelete(log, 5)).toEqual([2, 3, 4, 5])
  })

  it('refuses entries that are not messages, and messages already gone', () => {
    expect(() => entriesToDelete(log, 3)).toThrow('Only messages and replies can be deleted')
    const gone = log.with(7, { at: at(7), type: 'entry.removed' })
    expect(() => entriesToDelete(gone, 7)).toThrow('already gone')
  })

  it('cuts from a message to the end for Edit and Undo, skipping what is gone', () => {
    expect(entriesFrom(log.with(6, { at: at(6), type: 'entry.removed' }), 5)).toEqual([5, 7])
  })
})

function open(garage: string, options: { steps?: (n: number) => FakeStep[]; delayMs?: number; extensions?: Extension[] } = {}) {
  const prompts: string[] = []
  const fake = createFakeAdapter(() => options.steps?.(prompts.length) ?? [{ type: 'text.completed', text: `reply ${prompts.length}` }], options.delayMs ?? 1)
  // The fake engine doesn't keep what it was sent; this one does.
  const adapter: Adapter = {
    ...fake,
    start(machine, sessionOptions, emit) {
      const session = fake.start(machine, sessionOptions, emit)
      return {
        ...session,
        prompt(text, ...rest) {
          prompts.push(text)
          return session.prompt(text, ...rest)
        },
      }
    },
  }
  const core = openCore({
    garage,
    adapters: [adapter],
    defaultEngine: 'fake',
    machine: sandboxingMachine,
    extensions: options.extensions ?? [],
  })
  const broadcasts: CoreMessage[] = []
  core.onMessage((m) => broadcasts.push(m))
  const replies: CoreMessage[] = []
  const handle = (m: ClientMessage) => core.handle(m, (answer) => replies.push(answer))
  handle({ type: 'engine.setEnabled', engine: 'fake', enabled: true })
  handle({ type: 'workFolder.set', path: join(garage, 'work') })
  handle({ type: 'chat.create', name: 'App' })
  const chatId = core.chats().find((c) => c.name === 'App')!.id
  const state = () => core.chats().find((c) => c.id === chatId)!
  const idle = () => until(() => state().status === 'idle', { timeoutMs: 5000, what: 'the chat to be idle' })
  let detected = false
  const send = async (text: string, attachments?: { name: string; mimeType: string; base64: string }[]) => {
    if (!detected) await core.refreshEngines()
    detected = true
    const before = prompts.length
    handle({ type: 'chat.send', chatId, text, ...(attachments && { attachments }) })
    await until(() => prompts.length > before, { timeoutMs: 5000, what: 'the prompt' })
    await idle()
  }
  const log = () => readFileSync(join(garage, 'chats', chatId, 'log.jsonl'), 'utf8')
  const entries = (): ChatEntry[] => log().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const entryOf = (find: (e: ChatEntry) => boolean) => entries().findIndex(find)
  return { core, chatId, prompts, broadcasts, replies, handle, send, idle, log, entries, entryOf, state }
}

const tempGarage = () => {
  const garage = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-edits-')))
  cleanups.push(() => rmSync(garage, { recursive: true, force: true }))
  return garage
}

const userAt = (text: string) => (e: ChatEntry) => e.type === 'user.message' && e.text === text
const upload = (name: string, text: string) => ({ name, mimeType: 'text/plain', base64: Buffer.from(text).toString('base64') })

describe('deleting a message', () => {
  it('takes it off the disk and out of what the next session sees, and keeps every other index', async () => {
    const t = open(tempGarage())
    cleanups.push(() => t.core.close(true))
    await t.send('my key is sk-SECRET-123')
    await t.send('hello')
    const length = t.entries().length
    const entry = t.entryOf(userAt('my key is sk-SECRET-123'))

    t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry })

    expect(t.log()).not.toContain('SECRET')
    expect(t.entries()).toHaveLength(length)
    expect(t.entries()[entry]).toEqual({ at: expect.any(String), type: 'entry.removed' })
    expect(t.entryOf(userAt('hello'))).toBeGreaterThan(entry)
    expect(t.broadcasts.findLast((m) => m.type === 'chat.log')).toMatchObject({ chatId: t.chatId, from: 0 })
    await t.send('next')
    expect(t.prompts.at(-1)).not.toContain('SECRET')
    expect(t.prompts.at(-1)).toContain('hello')
  })

  it("deletes the agent's reply with its tool calls and output, and leaves the turn finished", async () => {
    const t = open(tempGarage(), {
      steps: (n) =>
        n === 0
          ? [
              { type: 'tool.started', toolId: 'ls', name: 'Bash', kind: 'shell', summary: 'cat .env', input: { command: 'cat .env' } },
              { type: 'tool.completed', toolId: 'ls', output: 'TOKEN=tool-SECRET', isError: false },
              { type: 'text.completed', text: 'Your token is tool-SECRET' },
            ]
          : [{ type: 'text.completed', text: 'later' }],
    })
    cleanups.push(() => t.core.close(true))
    await t.send('what is in .env?')
    const reply = t.entryOf((e) => e.type === 'text.completed')

    t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry: reply })

    expect(t.log()).not.toContain('SECRET')
    expect(t.log()).toContain('what is in .env?')
    expect(t.entries().map((e) => e.type)).toEqual(['user.message', 'turn.started', 'entry.removed', 'entry.removed', 'entry.removed', 'turn.completed'])
    expect(messagesOf(t.entries()).map((m) => m.kind)).toEqual(['user'])
    await t.send('again')
    expect(t.prompts.at(-1)).not.toContain('SECRET')
  })

  it("deletes a message's attachments unless another message uses them", async () => {
    const t = open(tempGarage())
    cleanups.push(() => t.core.close(true))
    await t.send('see file', [upload('notes.txt', 'private')])
    const entry = t.entryOf(userAt('see file'))
    const [attachment] = (t.entries()[entry] as Extract<ChatEntry, { type: 'user.message' }>).attachments!
    expect(existsSync(attachment!.path)).toBe(true)

    t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry })

    expect(existsSync(attachment!.path)).toBe(false)
  })

  it("can't delete the turn that is running, but can delete an earlier one", async () => {
    const ask: FakeStep[] = [
      { type: 'question', questions: [{ header: 'Pick', question: 'Which?', options: [{ label: 'A', description: '' }], multiSelect: false }] },
    ]
    const t = open(tempGarage(), { steps: (n) => (n === 0 ? [{ type: 'text.completed', text: 'done' }] : ask) })
    cleanups.push(() => t.core.close(true))
    await t.send('earlier')
    t.handle({ type: 'chat.send', chatId: t.chatId, text: 'now' })
    await until(() => t.state().status === 'waiting', { timeoutMs: 5000, what: 'the question' })
    const now = t.entryOf(userAt('now'))

    expect(() => t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry: now })).toThrow('still running')
    expect(() => t.handle({ type: 'chat.editMessage', chatId: t.chatId, entry: now, text: 'x' })).toThrow('Stop the chat first')
    expect(() => t.handle({ type: 'chat.undoMessage', chatId: t.chatId, entry: now })).toThrow('Stop the chat first')
    t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry: t.entryOf(userAt('earlier')) })
    expect(t.log()).not.toContain('earlier')
    expect(t.log()).toContain('"now"')
  })

  it('tells extensions that are on what went, with the first memory id that moved', async () => {
    const heard: Omit<MessagesRemoved, 'chat'>[] = []
    const watcher: Extension = {
      id: 'watcher',
      name: 'Watcher',
      description: 'Hears deletions',
      enabledByDefault: true,
      onMessagesRemoved: ({ chat: _chat, ...removed }) => void heard.push(removed),
    }
    const t = open(tempGarage(), { extensions: [watcher] })
    cleanups.push(() => t.core.close(true))
    await t.send('one')
    await t.send('two')
    const entry = t.entryOf(userAt('two'))
    const firstMessage = messagesOf(t.entries()).findIndex((m) => m.text === 'two')
    const since = t.entries()[entry]!.at

    t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry })

    expect(heard).toEqual([{ entries: [entry], firstMessage, since }])
  })

  it('stays deleted after a restart', async () => {
    const garage = tempGarage()
    const t = open(garage)
    await t.send('forget me')
    await t.send('keep me')
    t.handle({ type: 'chat.deleteMessage', chatId: t.chatId, entry: t.entryOf(userAt('forget me')) })
    await t.core.close(true)

    const again = openCore({ garage, adapters: [createFakeAdapter(() => [])], defaultEngine: 'fake', machine: sandboxingMachine, extensions: [] })
    cleanups.push(() => again.close(true))
    const shown = again.chats().find((c) => c.id === t.chatId)!
    expect(JSON.stringify(shown.entries)).not.toContain('forget me')
    expect(JSON.stringify(shown.entries)).toContain('keep me')
    expect(shown.status).toBe('idle')
  })
})

describe('editing a message', () => {
  it('removes it and everything after it, then runs the new text with its attachments', async () => {
    const t = open(tempGarage())
    cleanups.push(() => t.core.close(true))
    await t.send('draft one', [upload('spec.txt', 'spec')])
    await t.send('later message')
    const entry = t.entryOf(userAt('draft one'))
    const [attachment] = (t.entries()[entry] as Extract<ChatEntry, { type: 'user.message' }>).attachments!
    const before = t.prompts.length

    t.handle({ type: 'chat.editMessage', chatId: t.chatId, entry, text: 'draft two' })
    await until(() => t.prompts.length > before, { timeoutMs: 5000 })
    await t.idle()

    expect(t.log()).not.toContain('draft one')
    expect(t.log()).not.toContain('later message')
    expect(t.log()).not.toContain('reply 0')
    const edited = t.entries().find(userAt('draft two')) as Extract<ChatEntry, { type: 'user.message' }>
    expect(edited.attachments).toEqual([attachment])
    expect(existsSync(attachment!.path)).toBe(true)
    expect(t.prompts.at(-1)).toContain('draft two')
    expect(t.prompts.at(-1)).not.toContain('later message')
    expect(messagesOf(t.entries()).map((m) => m.kind)).toEqual(['user', 'talk'])
  })

  it("only edits the user's own messages", async () => {
    const t = open(tempGarage())
    cleanups.push(() => t.core.close(true))
    await t.send('hi')
    const reply = t.entryOf((e) => e.type === 'text.completed')
    expect(() => t.handle({ type: 'chat.editMessage', chatId: t.chatId, entry: reply, text: 'x' })).toThrow('Only your own messages')
  })
})

describe('undoing a message', () => {
  it('removes it and everything after it, and gives its text and attachments back for the composer', async () => {
    const t = open(tempGarage())
    cleanups.push(() => t.core.close(true))
    await t.send('keep')
    await t.send('oops, wrong chat', [upload('a.txt', 'contents')])
    const entry = t.entryOf(userAt('oops, wrong chat'))
    const [attachment] = (t.entries()[entry] as Extract<ChatEntry, { type: 'user.message' }>).attachments!
    const prompts = t.prompts.length

    t.handle({ type: 'chat.undoMessage', chatId: t.chatId, entry })

    expect(t.replies.at(-1)).toEqual({
      type: 'chat.undone',
      chatId: t.chatId,
      text: 'oops, wrong chat',
      attachments: [upload('a.txt', 'contents')],
    })
    expect(t.log()).not.toContain('oops')
    expect(t.log()).toContain('"keep"')
    expect(existsSync(attachment!.path)).toBe(false)
    expect(t.prompts).toHaveLength(prompts)
    expect(t.state().status).toBe('idle')
  })
})
