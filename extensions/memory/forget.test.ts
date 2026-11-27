// The forget tool end to end: a held engine calls it over Kothar's MCP server, the user answers the card, and the
// log on disk, the chat's files and the next session's memory no longer hold what was forgotten.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatEntry } from '@kothar/extension-api'
import { afterEach, describe, expect, it } from 'vitest'
import { startCore } from '@kothar/core/main'
import type { Adapter, EngineEvent, SessionOptions } from '@kothar/core/shared'
import { sandboxingMachine } from '@kothar/core/test-machine'
import { createMemoryExtension } from './index.ts'

const SECRET = 'TallyVotes quiz notes for CS343'
const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function until(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

type Held = { options: SessionOptions; prompt?: string; emit: (event: EngineEvent) => void; end(reply?: string): void }

async function start(mode: 'tree' | 'rolling' = 'rolling') {
  const garage = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-forget-')))
  cleanups.push(() => rmSync(garage, { recursive: true, force: true }))
  const sessions: Held[] = []
  const held: Adapter = {
    id: 'held',
    kotharMcp: true,
    imageInput: true,
    detect: async () => ({ installed: true, signedIn: true, models: ['large'] }),
    async complete() {
      return 'rolled'
    },
    start(_machine, options, emit) {
      const session: Held = {
        options,
        emit,
        end(reply) {
          if (reply !== undefined) emit({ type: 'text.completed', text: reply })
          emit({ type: 'turn.completed' })
        },
      }
      sessions.push(session)
      return {
        prompt(text) {
          session.prompt = text
          emit({ type: 'turn.started' })
        },
        interrupt: () => emit({ type: 'turn.completed', error: 'Interrupted' }),
        respond() {},
        close() {},
      }
    },
  }
  const memory = createMemoryExtension({ debounceMs: 0 })
  const env = { KOTHAR_ENGINE: 'held', KOTHAR_GARAGE: garage, KOTHAR_PORT: '0', KOTHAR_WORK: join(garage, 'work') }
  const kothar = await startCore({ env, adapters: [held], extensions: [memory], machine: sandboxingMachine })
  cleanups.push(() => kothar.close(true))
  kothar.core.handle({ type: 'extension.setValue', extensionId: 'memory', key: 'mode', value: mode }, () => {})
  const handle = (message: Parameters<typeof kothar.core.handle>[0]) => kothar.core.handle(message, () => {})
  const space = (name: string) => {
    handle({ type: 'chat.create', name })
    return kothar.core.chats().find((c) => c.name === name)!.id
  }
  const send = (chatId: string, text: string, attachments?: { name: string; mimeType: string; base64: string }[]) => {
    handle({ type: 'chat.send', chatId, text, ...(attachments && { attachments }) })
    return sessions.at(-1)!
  }
  const entries = (chatId: string): ChatEntry[] => kothar.core.chats().find((c) => c.id === chatId)!.entries
  const logFile = (chatId: string) => readFileSync(join(garage, 'chats', chatId, 'log.jsonl'), 'utf8')
  const tool = async (session: Held, name: string, args: object) => {
    const response = await fetch(`http://127.0.0.1:${kothar.port}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.options.kotharMcp!.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const { result, error } = await response.json()
    if (error) return { isError: true, text: String(error.message) }
    return { isError: result.isError === true, text: result.content[0].text as string }
  }
  const card = (chatId: string) =>
    entries(chatId).findLast((e): e is Extract<ChatEntry, { type: 'permission.requested' }> => e.type === 'permission.requested')
  const answer = async (chatId: string, allow: boolean) => {
    await until(() => card(chatId) !== undefined && kothar.core.chats().find((c) => c.id === chatId)!.status === 'waiting')
    handle({ type: 'permission.respond', chatId, requestId: card(chatId)!.requestId, allow })
  }
  // A space where messages 0 to 3 are: the secret (with a picture), its reply, a message to keep and its reply. The
  // third turn runs, its agent about to call forget.
  const seeded = async () => {
    const chatId = space('School')
    send(chatId, SECRET, [{ name: 'quiz.png', mimeType: 'image/png', base64: PNG }]).end(`Saved the ${SECRET}.`)
    send(chatId, 'Keep this one').end('Kept')
    const running = send(chatId, 'forget the CS343 thing')
    running.emit({ type: 'tool.started', toolId: 'f1', name: 'mcp__kothar__forget', kind: 'mcp', summary: `forget: ${SECRET}`, input: { ids: [0, 1], reason: `the ${SECRET}` } })
    return { chatId, running }
  }
  return { kothar, garage, handle, space, send, entries, logFile, tool, card, answer, seeded }
}

describe('forget', () => {
  it('asks first, then removes the messages from the log on disk, their files and the next memory, leaving a trace', async () => {
    const t = await start()
    const { chatId, running } = await t.seeded()
    const picture = t.entries(chatId).find((e) => e.type === 'user.message' && e.attachments?.length)
    const path = picture?.type === 'user.message' ? picture.attachments![0]!.path : ''
    expect(existsSync(path)).toBe(true)

    const result = t.tool(running, 'forget', { ids: [0, 1], reason: 'the user asked' })
    await t.answer(chatId, true)
    const card = t.card(chatId)!
    expect(card).toMatchObject({ name: 'Forget 2 messages', buttons: { allow: 'Forget', deny: 'Cancel' } })
    expect((await result).text).toMatch(/^Forgot 2 messages\./)

    const log = t.logFile(chatId)
    expect(log).not.toContain('TallyVotes')
    expect(log).toContain('Keep this one')
    expect(existsSync(path)).toBe(false)
    expect(t.entries(chatId).filter((e) => e.type === 'entry.removed')).toHaveLength(2)
    expect(t.entries(chatId).at(-1)).toMatchObject({ type: 'extension.note', text: '2 messages forgotten' })
    // The card now keeps only its count, and the forget call only its ids.
    expect(t.card(chatId)).toMatchObject({ summary: 'Forget 2 messages' })
    expect(t.entries(chatId).find((e) => e.type === 'tool.started')).toMatchObject({ input: { ids: [0, 1] }, summary: 'forget 0, 1' })

    running.end('Done')
    const next = t.send(chatId, 'what do you remember?')
    expect(next.prompt).toContain('Keep this one')
    expect(next.prompt).not.toContain('TallyVotes')
  })

  it('leaves everything as it was when the user cancels', async () => {
    const t = await start()
    const { chatId, running } = await t.seeded()
    const result = t.tool(running, 'forget', { ids: ['0+2'] })
    await t.answer(chatId, false)
    expect(await result).toEqual({ isError: false, text: 'The user kept these messages.' })
    expect(t.logFile(chatId)).toContain(`Saved the ${SECRET}.`)
    expect(t.entries(chatId).some((e) => e.type === 'entry.removed' || e.type === 'extension.note')).toBe(false)
  })

  it('shows the card even with Allow all on, answered by the user alone', async () => {
    const t = await start()
    const chatId = t.space('School')
    t.handle({ type: 'chat.setPermission', chatId, name: 'allowAll', enabled: true })
    t.send(chatId, SECRET).end('ok')
    const running = t.send(chatId, 'forget it')
    const result = t.tool(running, 'forget', { ids: [0] })
    await until(() => t.card(chatId) !== undefined)
    expect(t.kothar.core.chats().find((c) => c.id === chatId)!.status).toBe('waiting')
    expect(t.entries(chatId).some((e) => e.type === 'permission.resolved')).toBe(false)
    await t.answer(chatId, true)
    expect((await result).text).toMatch(/^Forgot 1 message\./)
    expect(t.logFile(chatId)).not.toContain('TallyVotes')
  })

  it("refuses the turn that's running, ids out of range and ones already gone", async () => {
    const t = await start()
    const { chatId, running } = await t.seeded()
    expect(await t.tool(running, 'forget', { ids: [4] })).toMatchObject({ isError: true, text: expect.stringMatching(/turn that's running/) })
    expect(await t.tool(running, 'forget', { ids: [99] })).toMatchObject({ isError: true })
    expect(await t.tool(running, 'forget', { ids: ['x'] })).toMatchObject({ isError: true, text: expect.stringMatching(/isn't a message id/) })
    const first = t.tool(running, 'forget', { ids: [1] })
    await t.answer(chatId, true)
    await first
    // Ids still name what the agent was shown: message 1 is gone now, and 2 is still "Keep this one".
    expect(await t.tool(running, 'forget', { ids: [1] })).toMatchObject({ isError: true, text: expect.stringMatching(/already gone/) })
    const second = t.tool(running, 'forget', { ids: [2] })
    await until(() => t.card(chatId)?.name === 'Forget 1 message' && t.card(chatId)!.summary.includes('Keep this one'))
    await t.answer(chatId, false)
    await second
  })

  it('acts only on its own chat, whatever else it is passed', async () => {
    const t = await start()
    const other = t.space('Other')
    t.send(other, `other ${SECRET}`).end('ok')
    const { chatId, running } = await t.seeded()
    const before = t.logFile(other)
    const result = t.tool(running, 'forget', { ids: [0], chatId: other })
    await t.answer(chatId, true)
    await result
    expect(t.logFile(other)).toBe(before)
    expect(t.entries(other).some((e) => e.type === 'permission.requested')).toBe(false)
  })

  it('drops the summaries that covered the forgotten messages (Summary tree)', async () => {
    const t = await start('tree')
    const { chatId, running } = await t.seeded()
    const result = t.tool(running, 'forget', { ids: [0, 1] })
    await t.answer(chatId, true)
    await result
    running.end('Done')
    const file = join(t.garage, 'chats', chatId, 'summaries.jsonl')
    if (existsSync(file)) expect(readFileSync(file, 'utf8')).not.toContain('TallyVotes')
    const next = t.send(chatId, 'again')
    expect(next.prompt).not.toContain('TallyVotes')
  })
})
