// A fake ACP agent for tests: JSON-RPC 2.0 over stdio, one message a line. No model behind it.
// FAKE_ACP_AUTH=1: session/new fails with auth_required. FAKE_ACP_LEGACY=1: models in the older `models` state.
// FAKE_ACP_HTTP=1: says it takes HTTP MCP servers. FAKE_ACP_LOG: a file each message it gets is appended to.
import { appendFileSync } from 'node:fs'

const out = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const log = (message) => process.env.FAKE_ACP_LOG && appendFileSync(process.env.FAKE_ACP_LOG, JSON.stringify(message) + '\n')
const MODELS = ['fake/small', 'fake/large']
let model = MODELS[0]
let pending = new Map()
let nextId = 1000
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    out({ id, method, params })
  })
const update = (sessionId, update) => out({ method: 'session/update', params: { sessionId, update } })

async function handle(msg) {
  log(msg)
  if (msg.method === undefined) {
    pending.get(msg.id)?.(msg.result)
    pending.delete(msg.id)
    return
  }
  const { id, method, params } = msg
  if (method === 'initialize') {
    return out({
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { mcpCapabilities: { http: process.env.FAKE_ACP_HTTP === '1' } },
        authMethods: [{ id: 'login', name: 'Log in with Fake' }],
      },
    })
  }
  if (method === 'session/new') {
    if (process.env.FAKE_ACP_AUTH === '1') return out({ id, error: { code: -32000, message: 'Authentication required' } })
    const result = { sessionId: 'fake-session' }
    if (process.env.FAKE_ACP_LEGACY === '1') {
      result.models = { currentModelId: model, availableModels: MODELS.map((modelId) => ({ modelId, name: modelId })) }
    } else {
      result.configOptions = [
        { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: [{ group: 'fake', name: 'Fake', options: MODELS.map((value) => ({ value, name: value })) }] },
        { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'medium', options: ['low', 'medium', 'high'].map((value) => ({ value, name: value })) },
      ]
    }
    return out({ id, result })
  }
  if (method === 'session/set_config_option' || method === 'session/set_model') {
    if (method === 'session/set_model') model = params.modelId
    else if (params.configId === 'model') model = params.value
    return out({ id, result: {} })
  }
  if (method === 'session/prompt') {
    const text = params.prompt.find((b) => b.type === 'text')?.text ?? ''
    const sessionId = params.sessionId
    if (text.includes('run ls')) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run ls', kind: 'execute', status: 'pending', rawInput: { command: ['ls', '-la'] } })
      const answer = await ask('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'Run ls', kind: 'execute', rawInput: { command: ['ls', '-la'] } },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })
      const allowed = answer?.outcome?.optionId === 'yes'
      update(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: allowed ? 'completed' : 'failed',
        content: [{ type: 'content', content: { type: 'text', text: allowed ? 'file.txt' : 'denied' } }],
      })
    }
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${model} heard: ${text.split('\n').at(-1)}` } })
    return out({ id, result: { stopReason: 'end_turn' } })
  }
  out({ id, error: { code: -32601, message: `Method not found: ${method}` } })
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    if (line.trim()) void handle(JSON.parse(line))
  }
})
process.stdin.on('end', () => process.exit(0))
