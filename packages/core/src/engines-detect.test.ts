import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createFakeAdapter } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import { openCore } from './core.ts'
import type { CoreMessage, EngineStatus } from './shared.ts'
import { until } from './test-wait.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// Get started's Check again: the core runs every adapter's detect again and sends what it found, with the adapter's
// install command for an engine that isn't installed.
it('detects engines again on engines.detect, with each adapter’s install command', async () => {
  const garage = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-engines-detect-')))
  cleanups.push(() => rmSync(garage, { recursive: true, force: true }))
  let status: EngineStatus = { installed: false, signedIn: false }
  const fake = createFakeAdapter([], 0)
  const adapter = { ...fake, install: 'npm install -g fake-engine', detect: async () => status }
  const core = openCore({ garage, adapters: [adapter], defaultEngine: 'fake', machine: sandboxingMachine })
  cleanups.push(() => core.close(true))
  const heard: CoreMessage[] = []
  core.onMessage((message) => heard.push(message))
  await core.refreshEngines()
  expect(core.engines()[0]).toMatchObject({ id: 'fake', installed: false, install: 'npm install -g fake-engine' })

  status = { installed: true, signedIn: true }
  core.handle({ type: 'engines.detect' }, () => {})
  await until(() => heard.some((m) => m.type === 'engine.updated' && m.engine.installed))
  expect(core.engines()[0]).toMatchObject({ id: 'fake', installed: true, signedIn: true })
})
