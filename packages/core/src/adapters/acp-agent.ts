import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { McpServer } from '@kothar/extension-api'
import type { AcpAgent, Adapter, EngineStatus, ToolKind } from '../shared.ts'
import { acpStdioServer, kindOfAcp, levelsOfEfforts, probeAcp, startAcpSession, type AcpMcpServer, type AcpToolCall } from './acp.ts'
import { processUserEnv, type UserEnv } from './user-env.ts'

// Any agent that speaks the Agent Client Protocol, added by the user in Settings → Engines (an AcpAgent: a command,
// its arguments and environment). The protocol half is acp.ts, shared with OpenCode; this file only knows what every
// ACP agent has in common, since Kothar knows nothing else about the agent:
// - Detection: the command is on the PATH, then a throwaway session says which models and thinking levels it offers
//   (ACP has no other way to list them). An agent that offers none runs with DEFAULT_MODEL, its own choice.
// - Instructions go ahead of the first prompt: ACP has no system prompt every agent takes.
// - Tools are named and classed from ACP's own fields (kind, rawInput, locations); permission requests become
//   Kothar's permission cards like any engine's.
// - MCP servers go in session/new: Kothar's own over HTTP if the agent says it takes HTTP, extensions' over stdio.
// - It runs through the Machine, sandboxed like every engine, with the folders the user listed writable too.
// The agent loads its own config, plugins and logins: Kothar can't start an unknown agent clean (design rule 8).

// The model a chat runs when the agent offers no choice: whatever the agent picks itself.
export const DEFAULT_MODEL = 'default'

const PROBE_TIMEOUT_MS = 20_000

// Where a call's path or command may sit in its input, across agents.
const PATH_FIELDS = ['path', 'file_path', 'filePath', 'filepath', 'file', 'abs_path', 'absolute_path']
const COMMAND_FIELDS = ['command', 'cmd']
const SUMMARY_FIELDS: Partial<Record<ToolKind, string[]>> = {
  search: ['pattern', 'query', 'regex'],
  fetch: ['url', 'query'],
}

const stringIn = (input: any, keys: string[] | undefined) =>
  keys?.map((key) => input?.[key]).find((value): value is string => typeof value === 'string' && value !== '')

const commandOf = (input: any) => {
  for (const key of COMMAND_FIELDS) {
    const value = input?.[key]
    if (typeof value === 'string' && value) return value
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(' ')
  }
  return undefined
}

// Agents name an MCP server's tools in their own ways: mcp__<server>__<tool>, <server>_<tool>, <server>/<tool>,
// <server>:<tool>, or "<tool> (<server> MCP Server)".
export function fromServer(name: string, servers: string[]) {
  const lower = name.toLowerCase()
  return servers.some((server) => {
    const s = server.toLowerCase()
    return (
      lower.startsWith(`mcp__${s}__`) ||
      [`${s}_`, `${s}/`, `${s}:`, `${s}.`].some((prefix) => lower.startsWith(prefix)) ||
      lower.includes(`(${s} mcp server)`)
    )
  })
}

export function acpToolOf(servers: string[]) {
  return (call: AcpToolCall) => {
    const name = call.firstTitle ?? call.title ?? 'tool'
    const kind: ToolKind = call.kind !== undefined && call.kind !== 'other' ? kindOfAcp(call.kind) : fromServer(name, servers) ? 'mcp' : kindOfAcp(call.kind)
    const input = call.rawInput ?? {}
    const command = kind === 'shell' ? commandOf(input) : undefined
    const named = stringIn(input, PATH_FIELDS) ?? call.locations[0]
    const path = kind === 'edit' || kind === 'read' || kind === 'search' ? named : undefined
    const picked = command ?? stringIn(input, SUMMARY_FIELDS[kind]) ?? path
    const summary = (picked ?? call.title ?? name).replace(/\s+/g, ' ').trim()
    return { name, kind, summary, ...(path !== undefined && { path }), ...(command !== undefined && { command }) }
  }
}

// The agent's arguments for a session in a folder: {cwd} is the folder.
export const argsFor = (agent: AcpAgent, cwd: string) => agent.args.map((arg) => arg.replaceAll('{cwd}', cwd))

const expand = (path: string, home: string) => path.replace(/^~(?=$|\/)/, home)

// ACP wants a stdio server's command as an absolute path.
const absolute = (server: McpServer): McpServer =>
  isAbsolute(server.command) ? server : { ...server, command: '/usr/bin/env', args: [server.command, ...(server.args ?? [])] }

export function createAcpAgent(agent: AcpAgent, user: UserEnv = processUserEnv()): Adapter {
  const env = agent.env
  return {
    id: agent.id,
    name: agent.name,
    imageInput: true,
    kotharMcp: true,

    async detect(machine): Promise<EngineStatus> {
      const found = await machine
        .run('/bin/sh', ['-c', 'command -v "$1"', 'sh', agent.command], { cwd: '/', env })
        .catch(() => null)
      if (found?.code !== 0) return { installed: false, signedIn: false, detail: `${agent.command} not found` }
      const cwd = tmpdir()
      const probe = await probeAcp(machine.spawn(agent.command, argsFor(agent, cwd), { cwd, env }), cwd, PROBE_TIMEOUT_MS)
      const models = probe.models.length ? probe.models : [DEFAULT_MODEL]
      const thinking = levelsOfEfforts(probe.efforts)
      const status: EngineStatus = {
        installed: true,
        signedIn: !probe.needsAuth && !probe.error,
        detail: agent.command,
        models,
        defaultModel: probe.current ?? models[0],
        ...(thinking.length && { thinking }),
      }
      if (probe.needsAuth) {
        const ways = probe.needsAuth.length ? ` (${probe.needsAuth.join(', ')})` : ''
        return { ...status, detail: `Sign in with ${agent.command} in a terminal first${ways}` }
      }
      if (probe.error) return { ...status, detail: `Didn't answer as an ACP agent: ${probe.error}` }
      return status
    },

    start(machine, options, emit) {
      const { cwd, instructions, kotharMcp, mcpServers = [], extraDirs = [], model, thinking, sandbox } = options
      const servers: AcpMcpServer[] = []
      if (kotharMcp) {
        // In session/new, on the agent's stdin, so the token stays out of `ps`.
        const headers = [{ name: 'Authorization', value: `Bearer ${kotharMcp.token}` }]
        servers.push({ type: 'http', name: 'kothar', url: kotharMcp.url, headers })
      }
      for (const server of mcpServers) servers.push(acpStdioServer(absolute(server)))
      const dirs = extraDirs.map((dir) => `\n- ${dir}`).join('')
      const text = [instructions, dirs && `You can also work in these folders:${dirs}`].filter(Boolean).join('\n\n')
      const writable = (agent.writable ?? []).map((path) => expand(path, user.home))
      const jailed = sandbox && { ...sandbox, writable: [...sandbox.writable, ...writable] }
      const proc = machine.spawn(agent.command, argsFor(agent, cwd), { cwd, env, ...(jailed && { sandbox: jailed }) })
      const names = [...(kotharMcp ? ['kothar'] : []), ...mcpServers.map((s) => s.name)]
      return startAcpSession(
        proc,
        {
          cwd,
          mcpServers: servers,
          ...(model && model !== DEFAULT_MODEL && { model }),
          ...(thinking && { thinking }),
          name: agent.name,
          ...(text && { instructions: text }),
          httpIfOffered: true,
        },
        { tool: acpToolOf(names) },
        emit,
      )
    },
  }
}

// --- Settings: the agents the user added (settings.json `acpAgents`). ---

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'agent'

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Checks what the form sent and gives the agent to save; a new one gets an id not in `taken`. */
export function checkAcpAgent(raw: unknown, taken: string[], home: string): AcpAgent {
  const input = (raw ?? {}) as Record<string, unknown>
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('Give the agent a name')
  const command = String(input.command ?? '').trim()
  if (!command) throw new Error('Give the command that starts the agent')
  if (/\s/.test(command) && !isAbsolute(command)) {
    throw new Error('The command is one program; put its arguments under Arguments')
  }
  const strings = (value: unknown, what: string) => {
    if (value === undefined) return []
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error(`${what} must be a list of text`)
    return value.map((v) => v.trim()).filter(Boolean)
  }
  const args = strings(input.args, 'Arguments')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries((input.env ?? {}) as Record<string, unknown>)) {
    if (!ENV_NAME.test(key)) throw new Error(`"${key}" isn't an environment variable name`)
    env[key] = String(value ?? '')
  }
  const writable = strings(input.writable, 'Writable folders').map((path) => {
    const full = expand(path, home)
    if (!isAbsolute(full)) throw new Error(`Writable folders must be absolute paths: ${path}`)
    if (full === home || full === '/') throw new Error(`${path} is too broad to make writable`)
    return path
  })
  let id = typeof input.id === 'string' && input.id ? input.id : undefined
  if (id === undefined) {
    const base = `acp-${slug(name)}`
    id = base
    for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  }
  return { id, name, command, args, env, ...(writable.length && { writable }) }
}

export const isAcpAgentId = (id: string) => id.startsWith('acp-')
