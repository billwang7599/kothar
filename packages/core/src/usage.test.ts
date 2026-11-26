import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Extension, ExtensionChat, ExtensionHost, UsageReport } from '@kothar/extension-api'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAdapter, type FakeStep } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import { openCore, type Core } from './core.ts'
import { SUMMARY_MODELS } from './models.ts'
import type { Adapter, CoreMessage } from './shared.ts'
import { until as waitUntil } from './test-wait.ts'
import { addUsage, cleanUsage, emptyTotals, readUsage, totalsOf, usageByModel, usedText, USAGE_FILE } from './usage.ts'

const until = (check: () => boolean) => waitUntil(check, { tries: 200 })
const dirs: string[] = []
const cores: Core[] = []
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-usage-')))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close(true)))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('usage files', () => {
  it('keeps only numbers above 0, and nothing when nothing is left', () => {
    expect(cleanUsage({ inputTokens: 10.4, outputTokens: 0, cacheReadTokens: -3, costUsd: Number.NaN, model: 'm' })).toEqual({
      inputTokens: 10,
      model: 'm',
    })
    expect(cleanUsage({ inputTokens: 0, model: 'm' })).toBeUndefined()
    expect(cleanUsage(undefined)).toBeUndefined()
  })

  it('adds up turns and calls, and counts reports without a cost', () => {
    const totals = emptyTotals()
    addUsage(totals, { source: 'turn', inputTokens: 100, outputTokens: 20, costUsd: 0.5 })
    addUsage(totals, { source: 'turn', inputTokens: 50, cacheReadTokens: 1000 })
    addUsage(totals, { source: 'complete', outputTokens: 5, cacheWriteTokens: 7, costUsd: 0.25 })
    expect(totals).toEqual({
      inputTokens: 150,
      outputTokens: 25,
      cacheReadTokens: 1000,
      cacheWriteTokens: 7,
      costUsd: 0.75,
      turns: 2,
      calls: 1,
      unpriced: 1,
    })
  })

  it('reads a usage file, skipping a line a crash cut short, and splits a chat’s own reports from its workers’', () => {
    const dir = tempDir()
    const line = (record: object) => JSON.stringify(record) + '\n'
    writeFileSync(
      join(dir, USAGE_FILE),
      line({ at: 'a', engine: 'fake', source: 'turn', chatId: 'lead', inputTokens: 10 }) +
        line({ at: 'b', engine: 'fake', source: 'turn', chatId: 'w1', inputTokens: 5, costUsd: 0.1 }) +
        '{"at": "c", "engine"',
    )
    expect(readUsage(dir)).toHaveLength(2)
    const { own, carried } = totalsOf(dir, 'lead')
    expect(own).toMatchObject({ inputTokens: 10, turns: 1, unpriced: 1 })
    expect(carried).toMatchObject({ inputTokens: 5, costUsd: 0.1, turns: 1, unpriced: 0 })
    expect(totalsOf(join(dir, 'missing'), 'lead').own).toEqual(emptyTotals())
  })

  it('adds an engine’s reports up per model, for adapters', () => {
    const items: [string | undefined, { i: number; c?: number }][] = [
      ['a', { i: 1, c: 0.1 }],
      ['b', { i: 2 }],
      ['a', { i: 3, c: 0.2 }],
      ['a', { i: 0 }],
    ]
    expect(usageByModel(items, (x) => ({ inputTokens: x.i, costUsd: x.c }))).toEqual([
      { model: 'a', inputTokens: 4, costUsd: 0.1 + 0.2 },
      { model: 'b', inputTokens: 2 },
    ])
  })

  it('says what one-shot calls used, for their Activity line', () => {
    expect(usedText([])).toBe('')
    expect(usedText([{ inputTokens: 1200, outputTokens: 34, costUsd: 0.00213 }])).toBe(', 1.2k tokens, $0.0021')
    expect(usedText([{ outputTokens: 40 }])).toBe(', 40 tokens')
  })
})

const MAIN: ExtensionChat = { id: 'main', name: 'Main', instructions: '', seesAll: true }
const mainExtension: Extension = { id: 'main-extension', name: 'Main', description: '', enabledByDefault: true, chats: [MAIN] }
const turnUsage = { model: 'fake-small', inputTokens: 100, outputTokens: 20, cacheReadTokens: 400, costUsd: 0.01 }
const script: FakeStep[] = [
  { type: 'text.completed', text: 'Done' },
  { type: 'turn.usage', usage: turnUsage },
]

function setup(adapter: Adapter = createFakeAdapter(script, 0)) {
  const garage = tempDir()
  let host: ExtensionHost | undefined
  const reports: UsageReport[] = []
  const watcher: Extension = {
    id: 'budget',
    name: 'Budget',
    description: '',
    enabledByDefault: true,
    onStart: ({ host: given }) => void (host = given),
    onUsage: (report) => void reports.push(report),
  }
  const core = openCore({ garage, adapters: [adapter], defaultEngine: adapter.id, machine: sandboxingMachine, extensions: [mainExtension, watcher] })
  cores.push(core)
  core.handle({ type: 'engine.setEnabled', engine: adapter.id, enabled: true }, () => {})
  core.handle({ type: 'workFolder.set', path: join(garage, 'work') }, () => {})
  const messages: CoreMessage[] = []
  core.onMessage((m) => messages.push(m))
  const handle = (m: Parameters<Core['handle']>[0]) => core.handle(m, () => {})
  const host_ = () => {
    if (!host) throw new Error('the extension has not started')
    return host
  }
  return { core, garage, messages, handle, reports, host: host_ }
}

const statusOf = (core: Core, id: string) => core.chats().find((c) => c.id === id)?.status

describe('usage in the core', () => {
  it('saves what a turn used in the chat’s usage file, not its log, and tells the UI and extensions', async () => {
    const t = setup()
    await t.core.refreshEngines()
    t.handle({ type: 'chat.send', chatId: 'main', text: 'hi' })
    await until(() => statusOf(t.core, 'main') === 'idle' && t.reports.length === 1)
    const records = readUsage(join(t.garage, 'chats', 'main'))
    expect(records).toEqual([{ at: expect.any(String), chatId: 'main', engine: 'fake', source: 'turn', turn: expect.any(String), ...turnUsage }])
    expect(readFileSync(join(t.garage, 'chats', 'main', 'log.jsonl'), 'utf8')).not.toContain('turn.usage')
    const totals = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 400, cacheWriteTokens: 0, costUsd: 0.01, turns: 1, calls: 0, unpriced: 0 }
    expect(t.messages).toContainEqual({ type: 'chat.usage', chatId: 'main', usage: totals })
    expect(t.core.chats().find((c) => c.id === 'main')?.usage).toEqual(totals)
    expect(t.reports[0]).toMatchObject({ usage: records[0], chat: { id: 'main' } })
    expect(t.host().usage('main')).toEqual({ chat: totals, workers: emptyTotals(), space: totals })
    // An extension's chat storage can't touch it.
    expect(() => t.host().chatStorage('main').write(USAGE_FILE, 'x')).toThrow()

    // Read back from the file after a restart.
    await t.core.close(true)
    const again = openCore({
      garage: t.garage,
      adapters: [createFakeAdapter(script, 0)],
      defaultEngine: 'fake',
      machine: sandboxingMachine,
      extensions: [mainExtension],
    })
    cores.push(again)
    expect(again.chats().find((c) => c.id === 'main')?.usage).toEqual(totals)
  })

  it('records nothing for an engine that reports no usage', async () => {
    const t = setup(createFakeAdapter([{ type: 'text.completed', text: 'Done' }], 0))
    t.handle({ type: 'chat.send', chatId: 'main', text: 'hi' })
    await until(() => statusOf(t.core, 'main') === 'idle')
    expect(existsSync(join(t.garage, 'chats', 'main', USAGE_FILE))).toBe(false)
    expect(t.core.chats().find((c) => c.id === 'main')).not.toHaveProperty('usage')
    expect(t.messages.some((m) => m.type === 'chat.usage')).toBe(false)
  })

  it('counts one-shot calls for the chat that asked, by extension, and in the garage when no chat did', async () => {
    const plain = createFakeAdapter(script, 0, { completeUsage: { inputTokens: 300, outputTokens: 40, costUsd: 0.002 } })
    const t = setup({ ...plain, detect: async (machine) => ({ ...(await plain.detect(machine)), models: [SUMMARY_MODELS[0]!] }) })
    await t.core.refreshEngines()
    await t.host().complete({ system: 'S', prompt: 'P', timeoutMs: 1000, chatId: 'main' })
    await t.host().complete({ system: 'S', prompt: 'P', timeoutMs: 1000 })
    expect(readUsage(join(t.garage, 'chats', 'main'))).toEqual([
      expect.objectContaining({ source: 'complete', extension: 'budget', chatId: 'main', model: SUMMARY_MODELS[0], inputTokens: 300 }),
    ])
    expect(readUsage(t.garage)).toEqual([expect.objectContaining({ source: 'complete', extension: 'budget', outputTokens: 40 })])
    expect(readUsage(t.garage)[0]).not.toHaveProperty('chatId')
    expect(t.host().usage('main').chat).toMatchObject({ calls: 1, turns: 0, costUsd: 0.002 })
    expect(t.reports.map((r) => r.chat?.id)).toEqual(['main', undefined])
  })

  it('adds a space’s workers in, and keeps a worker’s usage in its space once it’s removed', async () => {
    const t = setup()
    await t.core.refreshEngines()
    t.handle({ type: 'chat.create', name: 'Space' })
    const space = t.core.chats().find((c) => c.name === 'Space')!.id
    t.handle({ type: 'chat.send', chatId: space, text: 'go' })
    await until(() => statusOf(t.core, space) === 'idle' && t.reports.length === 1)
    const worker = t.host().createChat({ parentId: space, name: 'Helper', quiet: true }).id
    t.host().send(worker, 'help')
    // Removed once it has reported.
    await until(() => !t.core.chats().some((c) => c.id === worker) && t.reports.length === 2)
    expect(t.reports[1]).toMatchObject({ usage: { chatId: worker }, chat: { id: worker } })
    const lead = readUsage(join(t.garage, 'chats', space))
    expect(lead.map((r) => r.chatId)).toEqual([space, worker])
    const usage = t.host().usage(space)
    expect(usage.chat).toMatchObject({ turns: 1, inputTokens: 100 })
    expect(usage.workers).toMatchObject({ turns: 1, inputTokens: 100 })
    expect(usage.space).toMatchObject({ turns: 2, inputTokens: 200, costUsd: 0.02 })
    expect(t.messages.findLast((m) => m.type === 'chat.usage' && m.chatId === space)).toMatchObject({ workers: { turns: 1 } })
    expect(t.core.chats().find((c) => c.id === space)).toMatchObject({ usage: { turns: 1 }, workersUsage: { turns: 1 } })
  })
})
