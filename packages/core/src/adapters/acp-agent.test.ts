import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { localMachine } from '../machine.ts'
import type { AcpAgent, EngineEvent } from '../shared.ts'
import { acpToolOf, argsFor, checkAcpAgent, createAcpAgent, DEFAULT_MODEL, fromServer } from './acp-agent.ts'
import { fakeMachine } from './test-machine.ts'

const SCRIPT = fileURLToPath(new URL('fixtures/acp/fake-agent.mjs', import.meta.url))
const USER = { home: '/Users/me', env: {} }

const agentWith = (env: Record<string, string> = {}): AcpAgent => ({
  id: 'acp-fake',
  name: 'Fake',
  command: process.execPath,
  args: [SCRIPT],
  env,
})

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kothar-acp-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Waits until the events hold one of the type.
async function until(events: EngineEvent[], type: EngineEvent['type'], count = 1) {
  for (let i = 0; i < 500; i++) {
    if (events.filter((e) => e.type === type).length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`no ${type} in ${JSON.stringify(events.map((e) => e.type))}`)
}

describe('ACP agent adapter, against a fake ACP agent', () => {
  it('detects the models and thinking levels a new session offers, grouped options included', async () => {
    const status = await createAcpAgent(agentWith(), USER).detect(localMachine)
    expect(status).toMatchObject({
      installed: true,
      signedIn: true,
      models: ['fake/small', 'fake/large'],
      defaultModel: 'fake/small',
      thinking: ['low', 'medium', 'high'],
    })
  })

  it('reads the older models state too', async () => {
    const status = await createAcpAgent(agentWith({ FAKE_ACP_LEGACY: '1' }), USER).detect(localMachine)
    expect(status).toMatchObject({ signedIn: true, models: ['fake/small', 'fake/large'] })
    expect(status.thinking).toBeUndefined()
  })

  it('says an agent that wants a sign-in first is installed but not signed in, with its ways to sign in', async () => {
    const status = await createAcpAgent(agentWith({ FAKE_ACP_AUTH: '1' }), USER).detect(localMachine)
    expect(status).toMatchObject({ installed: true, signedIn: false })
    expect(status.detail).toContain('Log in with Fake')
  })

  it("says a command that isn't installed isn't", async () => {
    const agent = { ...agentWith(), command: 'kothar-no-such-agent' }
    expect(await createAcpAgent(agent, USER).detect(localMachine)).toMatchObject({ installed: false, signedIn: false })
  })

  it("says a program that doesn't speak ACP didn't answer as one", async () => {
    const agent = { ...agentWith(), command: '/bin/echo', args: ['hello'] }
    const status = await createAcpAgent(agent, USER).detect(localMachine)
    expect(status).toMatchObject({ installed: true, signedIn: false })
    expect(status.detail).toMatch(/Didn't answer as an ACP agent/)
  })

  it('runs a turn: instructions ahead of the first prompt, the model picked, a command asked about and allowed', async () => {
    const cwd = tempDir()
    const logFile = join(cwd, 'log.jsonl')
    const events: EngineEvent[] = []
    const session = createAcpAgent(agentWith({ FAKE_ACP_LOG: logFile }), USER).start(
      localMachine,
      { cwd, instructions: 'Be kind.', model: 'fake/large', thinking: 'high' },
      (e) => events.push(e),
    )
    session.prompt('please run ls')
    await until(events, 'permission.requested')
    const asked = events.find((e) => e.type === 'permission.requested')
    expect(asked).toMatchObject({ kind: 'shell', command: 'ls -la', name: 'Run ls' })
    expect(events.find((e) => e.type === 'tool.started')).toMatchObject({ kind: 'shell', summary: 'ls -la' })
    session.respond((asked as { requestId: string }).requestId, true)
    await until(events, 'turn.completed')
    expect(events.find((e) => e.type === 'tool.completed')).toMatchObject({ output: 'file.txt', isError: false })
    expect(events.find((e) => e.type === 'text.completed')).toMatchObject({ text: 'fake/large heard: please run ls' })
    expect(events.find((e) => e.type === 'turn.completed')).not.toHaveProperty('error')

    // A second turn in the same session gets no instructions again.
    session.prompt('hi again')
    await until(events, 'turn.completed', 2)
    session.close()
    const sent = readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const prompts = sent.filter((m) => m.method === 'session/prompt').map((m) => m.params.prompt[0].text)
    expect(prompts[0]).toBe('<instructions>\nBe kind.\n</instructions>\n\nplease run ls')
    expect(prompts[1]).toBe('hi again')
    expect(sent.find((m) => m.method === 'session/set_config_option' && m.params.configId === 'effort')?.params.value).toBe('high')
  })

  it('sets the model the older way on agents with the older models state', async () => {
    const cwd = tempDir()
    const logFile = join(cwd, 'log.jsonl')
    const events: EngineEvent[] = []
    const agent = agentWith({ FAKE_ACP_LEGACY: '1', FAKE_ACP_LOG: logFile })
    const session = createAcpAgent(agent, USER).start(localMachine, { cwd, instructions: '', model: 'fake/large' }, (e) => events.push(e))
    session.prompt('hello')
    await until(events, 'turn.completed')
    session.close()
    expect(events.find((e) => e.type === 'text.completed')).toMatchObject({ text: 'fake/large heard: hello' })
    const sent = readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(sent.find((m) => m.method === 'session/set_model')?.params).toEqual({ sessionId: 'fake-session', modelId: 'fake/large' })
  })

  it('denies a request as the user did', async () => {
    const events: EngineEvent[] = []
    const session = createAcpAgent(agentWith(), USER).start(localMachine, { cwd: tempDir(), instructions: '' }, (e) => events.push(e))
    session.prompt('run ls')
    await until(events, 'permission.requested')
    const asked = events.find((e) => e.type === 'permission.requested') as { requestId: string }
    session.respond(asked.requestId, false)
    await until(events, 'turn.completed')
    session.close()
    expect(events.find((e) => e.type === 'tool.completed')).toMatchObject({ output: 'denied', isError: true })
  })

  it("leaves out Kothar's HTTP MCP server unless the agent takes HTTP, and passes extensions' over stdio", async () => {
    for (const http of [false, true]) {
      const cwd = tempDir()
      const logFile = join(cwd, 'log.jsonl')
      const events: EngineEvent[] = []
      const env: Record<string, string> = { FAKE_ACP_LOG: logFile, ...(http && { FAKE_ACP_HTTP: '1' }) }
      const session = createAcpAgent(agentWith(env), USER).start(
        localMachine,
        {
          cwd,
          instructions: '',
          kotharMcp: { url: 'http://127.0.0.1:1/mcp', token: 'secret' },
          mcpServers: [{ name: 'notes', command: 'node', args: ['server.js'], env: { A: '1' } }],
        },
        (e) => events.push(e),
      )
      session.prompt('hello')
      await until(events, 'turn.completed')
      session.close()
      const sent = readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      const servers = sent.find((m) => m.method === 'session/new').params.mcpServers
      const stdio = { name: 'notes', command: '/usr/bin/env', args: ['node', 'server.js'], env: [{ name: 'A', value: '1' }] }
      if (http) {
        expect(servers).toEqual([
          { type: 'http', name: 'kothar', url: 'http://127.0.0.1:1/mcp', headers: [{ name: 'Authorization', value: 'Bearer secret' }] },
          stdio,
        ])
      } else expect(servers).toEqual([stdio])
    }
  })

  it('runs through the Machine, sandboxed with the folders the user listed writable, {cwd} in its arguments', () => {
    const fake = fakeMachine()
    const agent = { ...agentWith({ KEY: 'v' }), args: ['acp', '--dir', '{cwd}'], writable: ['~/.fake', '/opt/cache'] }
    createAcpAgent(agent, USER).start(
      fake.machine,
      { cwd: '/work/p', instructions: '', sandbox: { writable: ['/work/p'] } },
      () => {},
    )
    expect(fake.spawned[0]).toMatchObject({
      command: process.execPath,
      args: ['acp', '--dir', '/work/p'],
      cwd: '/work/p',
      env: { KEY: 'v' },
      sandbox: { writable: ['/work/p', '/Users/me/.fake', '/opt/cache'] },
    })
  })

  it("asks the agent for no model when it offers none (Kothar's default)", async () => {
    const cwd = tempDir()
    const logFile = join(cwd, 'log.jsonl')
    const events: EngineEvent[] = []
    const session = createAcpAgent(agentWith({ FAKE_ACP_LOG: logFile }), USER).start(
      localMachine,
      { cwd, instructions: '', model: DEFAULT_MODEL },
      (e) => events.push(e),
    )
    session.prompt('hello')
    await until(events, 'turn.completed')
    session.close()
    expect(events.find((e) => e.type === 'turn.completed')).not.toHaveProperty('error')
    const sent = readFileSync(logFile, 'utf8')
    expect(sent).not.toContain('set_config_option')
  })
})

describe('ACP tool calls', () => {
  const tool = acpToolOf(['kothar', 'notes'])
  it('classes calls by ACP kind, with the path or command from the input or locations', () => {
    expect(tool({ id: '1', title: 'Edit a.ts', kind: 'edit', rawInput: { file_path: '/p/a.ts' }, locations: [] })).toMatchObject({
      kind: 'edit',
      path: '/p/a.ts',
      summary: '/p/a.ts',
    })
    expect(tool({ id: '2', title: 'Read', kind: 'read', locations: ['/p/b.ts'] })).toMatchObject({ kind: 'read', path: '/p/b.ts' })
    expect(tool({ id: '3', title: 'Shell', kind: 'execute', rawInput: { command: 'npm test' }, locations: [] })).toMatchObject({
      kind: 'shell',
      command: 'npm test',
    })
    expect(tool({ id: '4', title: 'Fetch', kind: 'fetch', rawInput: { url: 'https://x.dev' }, locations: [] })).toMatchObject({
      kind: 'fetch',
      summary: 'https://x.dev',
    })
  })
  it("knows an MCP server's tools by the agents' ways of naming them", () => {
    for (const name of ['mcp__kothar__zoom', 'kothar_zoom', 'notes/search', 'zoom (kothar MCP Server)']) {
      expect(fromServer(name, ['kothar', 'notes'])).toBe(true)
      expect(tool({ id: '5', title: name, kind: 'other', locations: [] }).kind).toBe('mcp')
    }
    expect(fromServer('Read file', ['kothar'])).toBe(false)
  })
})

describe('Adding an ACP agent', () => {
  const home = '/Users/me'
  it('gives a new agent an id from its name, unique among engines', () => {
    expect(checkAcpAgent({ name: 'Gemini CLI', command: 'gemini', args: ['--experimental-acp'] }, [], home)).toEqual({
      id: 'acp-gemini-cli',
      name: 'Gemini CLI',
      command: 'gemini',
      args: ['--experimental-acp'],
      env: {},
    })
    expect(checkAcpAgent({ name: 'Gemini CLI', command: 'gemini' }, ['acp-gemini-cli'], home).id).toBe('acp-gemini-cli-2')
  })
  it('keeps an edited agent its id', () => {
    expect(checkAcpAgent({ id: 'acp-x', name: 'Renamed', command: 'x' }, ['acp-x'], home).id).toBe('acp-x')
  })
  it('refuses what it can\'t run', () => {
    expect(() => checkAcpAgent({ name: '', command: 'x' }, [], home)).toThrow(/name/)
    expect(() => checkAcpAgent({ name: 'X', command: '' }, [], home)).toThrow(/command/)
    expect(() => checkAcpAgent({ name: 'X', command: 'gemini --acp' }, [], home)).toThrow(/Arguments/)
    expect(() => checkAcpAgent({ name: 'X', command: 'x', env: { 'BAD-NAME': '1' } }, [], home)).toThrow(/environment/)
    expect(() => checkAcpAgent({ name: 'X', command: 'x', writable: ['relative'] }, [], home)).toThrow(/absolute/)
    expect(() => checkAcpAgent({ name: 'X', command: 'x', writable: ['~'] }, [], home)).toThrow(/too broad/)
  })
  it('puts the folder in for {cwd}', () => {
    expect(argsFor({ ...agentWith(), args: ['--cwd={cwd}'] }, '/p')).toEqual(['--cwd=/p'])
  })
})
