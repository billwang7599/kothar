import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeAdapter, type FakeStep } from '@kothar/core/fake'
import { CLI_FILE, newCliToken, writeCliAccess } from '@kothar/core/cli-access'
import { sandboxingMachine } from '@kothar/core/test-machine'
// The core's own modules, which it doesn't export: tests only.
import { openCore } from '../../core/src/core.ts'
import { startServer } from '../../core/src/server.ts'
import { afterEach, expect, it } from 'vitest'
import { EXIT, run } from './commands.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const reply = (text: string): FakeStep[] => [
  ...text.split(/(?<= )/).map((word): FakeStep => ({ type: 'text.delta', text: word })),
  { type: 'text.completed', text },
]

// A core on the fake engine with the CLI's file in its garage. script: what the next turn plays.
async function start() {
  const garage = mkdtempSync(join(tmpdir(), 'kothar-cli-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-cli-')))
  const turn: { script: FakeStep[] } = { script: reply('Hello there.') }
  const core = openCore({
    garage,
    adapters: [createFakeAdapter(() => turn.script, 0)],
    defaultEngine: 'fake',
    machine: sandboxingMachine,
  })
  core.handle({ type: 'workFolder.set', path: join(garage, 'work') }, () => {})
  core.handle({ type: 'engine.setEnabled', engine: 'fake', enabled: true }, () => {})
  await core.refreshEngines()
  const cliToken = newCliToken()
  const server = await startServer({ core, port: 0, uiOrigin: 'http://localhost:4318', token: 'ui-token', cliToken })
  const remove = writeCliAccess(garage, { port: server.port, token: cliToken, pid: process.pid })
  cleanups.push(async () => {
    remove()
    await server.close()
    await core.close()
    rmSync(garage, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })
  return { garage, project, turn, core }
}

async function kothar(garage: string, ...argv: string[]) {
  let out = ''
  let err = ''
  const code = await run(argv, {
    env: { KOTHAR_GARAGE: garage },
    stdout: (text) => void (out += text),
    stderr: (text) => void (err += text),
  })
  return { code, out, err }
}

it('keeps its file readable only by the user, and says so when Kothar is not running', async () => {
  const { garage } = await start()
  expect(statSync(join(garage, CLI_FILE)).mode & 0o777).toBe(0o600)
  const empty = mkdtempSync(join(tmpdir(), 'kothar-cli-'))
  cleanups.push(() => rmSync(empty, { recursive: true, force: true }))
  const { code, err } = await kothar(empty, 'list')
  expect(code).toBe(EXIT.failed)
  expect(err).toContain("Kothar isn't running")
})

it('makes a space, sends to it and waits for the reply, then lists and reads it', async () => {
  const { garage, project } = await start()
  const made = await kothar(garage, 'new', project, '--name', 'Demo')
  expect(made.code).toBe(EXIT.ok)
  const id = made.out.trim()

  const sent = await kothar(garage, 'send', 'demo', 'hi', 'there', '--wait')
  expect(sent).toMatchObject({ code: EXIT.ok, out: 'Hello there.\n' })

  const listed = await kothar(garage, 'list')
  expect(listed.out).toMatch(new RegExp(`^${id}\\s+idle\\s+Demo$`, 'm'))
  const json = JSON.parse((await kothar(garage, 'list', '--json')).out)
  expect(json).toContainEqual(expect.objectContaining({ id, name: 'Demo', status: 'idle', folders: [project] }))

  expect((await kothar(garage, 'read', id.slice(0, 6))).out).toBe('you: hi there\nagent: Hello there.\n')
  expect((await kothar(garage, 'read', id, '--last', '1')).out).toBe('agent: Hello there.\n')
  expect((await kothar(garage, 'status', id)).out).toContain('status:  idle')
})

it('fails with the turn when it fails', async () => {
  const { garage, project, turn } = await start()
  const id = (await kothar(garage, 'new', project)).out.trim()
  turn.script = [...reply('Trying.'), { type: 'turn.completed', error: 'boom' }]
  const { code, err } = await kothar(garage, 'send', id, 'go', '--wait')
  expect(code).toBe(EXIT.failed)
  expect(err).toContain('boom')
})

const permission: FakeStep = {
  type: 'permission',
  toolId: 't1',
  name: 'Bash',
  kind: 'shell',
  summary: 'git push',
  command: 'git push',
  input: { command: 'git push' },
  output: 'done',
}

it('stops at a permission request with its own exit code, and approve answers it', async () => {
  const { garage, project, turn } = await start()
  const id = (await kothar(garage, 'new', project)).out.trim()
  turn.script = [{ type: 'tool.started', toolId: 't1', name: 'Bash', kind: 'shell', summary: 'git push', input: {} }, permission, ...reply('Cleaned.')]
  const waited = await kothar(garage, 'send', id, 'clean', '--wait')
  expect(waited.code).toBe(EXIT.needsYou)
  expect(waited.err).toContain('Waiting for permission: Bash: git push')
  expect((await kothar(garage, 'status', id)).out).toContain('waiting: Bash: git push')

  const approved = await kothar(garage, 'approve', id)
  expect(approved).toMatchObject({ code: EXIT.ok, out: 'Approved: Bash: git push\n' })
  for (let i = 0; i < 100 && !(await kothar(garage, 'read', id)).out.includes('Cleaned.'); i++) await new Promise((r) => setTimeout(r, 20))
  expect((await kothar(garage, 'read', id)).out).toContain('agent: Cleaned.')
  expect((await kothar(garage, 'approve', id)).err).toContain('no permission request waiting')
})

it('approves every request during the wait with --approve', async () => {
  const { garage, project, turn } = await start()
  const id = (await kothar(garage, 'new', project)).out.trim()
  turn.script = [permission, ...reply('Cleaned.')]
  const { code, out, err } = await kothar(garage, 'send', id, 'clean', '--wait', '--approve')
  expect(code).toBe(EXIT.ok)
  expect(out).toBe('Cleaned.\n')
  expect(err).toContain('Approved: Bash: git push')
})

it('explains bad usage and unknown chats', async () => {
  const { garage } = await start()
  expect((await kothar(garage, 'nope')).code).toBe(EXIT.usage)
  expect((await kothar(garage, 'send', 'x')).code).toBe(EXIT.usage)
  expect((await kothar(garage, 'list', '--bogus')).code).toBe(EXIT.usage)
  const missing = await kothar(garage, 'status', 'nowhere')
  expect(missing.code).toBe(EXIT.failed)
  expect(missing.err).toContain('No chat called or with the id "nowhere"')
})

it("removes its file on close, but not a newer core's", async () => {
  const garage = mkdtempSync(join(tmpdir(), 'kothar-cli-'))
  cleanups.push(() => rmSync(garage, { recursive: true, force: true }))
  const older = writeCliAccess(garage, { port: 1, token: 'a', pid: 1 })
  writeCliAccess(garage, { port: 2, token: 'b', pid: 2 })()
  expect(existsSync(join(garage, CLI_FILE))).toBe(false)
  writeCliAccess(garage, { port: 3, token: 'c', pid: 3 })
  older()
  expect(existsSync(join(garage, CLI_FILE))).toBe(true)
})
