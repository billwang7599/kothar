import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAdapter } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import { openCore, type Core } from './core.ts'
import type { CoreMessage } from './shared.ts'
import { until } from './test-wait.ts'

const SCRIPT = fileURLToPath(new URL('adapters/fixtures/acp/fake-agent.mjs', import.meta.url))
const AGENT = { name: 'Fake ACP', command: process.execPath, args: [SCRIPT], env: {} }

let dirs: string[] = []
let cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.map((core) => core.close(true)))
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
  cores = []
})

function open(garage = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-acp-agents-')))) {
  if (!dirs.includes(garage)) dirs.push(garage)
  const core = openCore({ garage, adapters: [createFakeAdapter([], 0)], defaultEngine: 'fake', machine: sandboxingMachine, extensions: [] })
  cores.push(core)
  const heard: CoreMessage[] = []
  core.onMessage((message) => heard.push(message))
  return { core, garage, heard }
}

const saved = (garage: string) => JSON.parse(readFileSync(join(garage, 'settings.json'), 'utf8'))

describe('ACP agents in Settings → Engines', () => {
  it('adds an agent as an engine, off, detected, saved in settings.json, and back after a restart', async () => {
    const { core, garage, heard } = open()
    await core.handle({ type: 'acpAgent.save', agent: AGENT }, () => {})
    const engine = core.engines().find((e) => e.id === 'acp-fake-acp')
    expect(engine).toMatchObject({ name: 'Fake ACP', enabled: false, installed: true, signedIn: true, acp: { ...AGENT, id: 'acp-fake-acp' } })
    expect(engine?.models?.map((m) => m.id)).toEqual(['fake/small', 'fake/large'])
    expect(heard.some((m) => m.type === 'engines.updated' && m.engines.some((e) => e.id === 'acp-fake-acp'))).toBe(true)
    expect(saved(garage).acpAgents).toEqual([{ ...AGENT, id: 'acp-fake-acp' }])

    await core.close(true)
    const again = open(garage)
    expect(again.core.engines().map((e) => e.id)).toEqual(['fake', 'acp-fake-acp'])
    await again.core.refreshEngines()
    await until(() => again.core.engines().find((e) => e.id === 'acp-fake-acp')?.installed === true)
  })

  it('can be turned on, edited under the same id, and removed with its switch', async () => {
    const { core, garage } = open()
    await core.handle({ type: 'acpAgent.save', agent: AGENT }, () => {})
    core.handle({ type: 'engine.setEnabled', engine: 'acp-fake-acp', enabled: true }, () => {})
    await core.handle({ type: 'acpAgent.save', agent: { ...AGENT, id: 'acp-fake-acp', name: 'Renamed', env: { FAKE_ACP_LEGACY: '1' } } }, () => {})
    expect(core.engines().find((e) => e.id === 'acp-fake-acp')).toMatchObject({ name: 'Renamed', enabled: true })
    expect(saved(garage).acpAgents).toHaveLength(1)

    core.handle({ type: 'acpAgent.remove', engine: 'acp-fake-acp' }, () => {})
    expect(core.engines().map((e) => e.id)).toEqual(['fake'])
    expect(saved(garage).acpAgents).toBeUndefined()
    expect(saved(garage).engines['acp-fake-acp']).toBeUndefined()
  })

  it("won't remove or edit a built-in engine, and refuses an agent it can't run", async () => {
    const { core } = open()
    expect(() => core.handle({ type: 'acpAgent.remove', engine: 'fake' }, () => {})).toThrow(/No added ACP agent/)
    await expect(core.handle({ type: 'acpAgent.save', agent: { ...AGENT, id: 'fake' } }, () => {})).rejects.toThrow(/No added ACP agent/)
    await expect(core.handle({ type: 'acpAgent.save', agent: { ...AGENT, command: '' } }, () => {})).rejects.toThrow(/command/)
  })
})
