// The ACP agents the user added in Settings → Engines (settings.json `acpAgents`). Each one is an engine like the
// built-in ones, run by the generic ACP adapter (adapters/acp-agent.ts); this module keeps them in the core's adapter
// list as the user adds, edits and removes them. An agent starts off, like every engine, until the user turns it on.
import type { Settings } from './chat-store.ts'
import { checkAcpAgent, createAcpAgent, isAcpAgentId } from './adapters/acp-agent.ts'
import type { AcpAgent, Adapter, CoreMessage, EngineInfo } from './shared.ts'

export type AcpAgentsDeps = {
  settings: Settings
  saveSettings: () => void
  // The core's adapter list, changed in place so every module holding it sees the agents.
  adapters: Adapter[]
  home: string
  // Whether a chat on the engine is running now.
  isBusy: (engine: string) => boolean
  // Detects one engine and tells the windows (engine.updated); also turns models over to the new list.
  detect: (adapter: Adapter) => Promise<void>
  // Forgets what was detected of a removed engine and moves chats' model lists off it.
  forget: (engine: string) => void
  engineInfos: () => EngineInfo[]
  broadcast: (message: CoreMessage) => void
  // Makes an adapter for an agent; tests pass their own.
  create?: (agent: AcpAgent) => Adapter
}

export function openAcpAgents(deps: AcpAgentsDeps) {
  const { settings, saveSettings, adapters, home, broadcast } = deps
  const create = deps.create ?? ((agent: AcpAgent) => createAcpAgent(agent))
  const saved = () => settings.acpAgents ?? []
  const builtIn = new Set(adapters.map((a) => a.id))
  // An agent saved by hand with a bad entry is left out, not a reason the core won't start.
  for (const raw of saved()) {
    try {
      const agent = checkAcpAgent(raw, [], home)
      if (!builtIn.has(agent.id) && isAcpAgentId(agent.id)) adapters.push(create(agent))
    } catch {}
  }
  const agentOf = (id: string) => saved().find((agent) => agent.id === id)

  const listChanged = () => broadcast({ type: 'engines.updated', engines: deps.engineInfos() })

  /** Adds an agent (no id) or replaces one (its id); detects it again. Returns the saved agent. */
  async function save(raw: unknown): Promise<AcpAgent> {
    const id = (raw as { id?: unknown } | undefined)?.id
    if (id !== undefined) {
      if (typeof id !== 'string' || !agentOf(id)) throw new Error(`No added ACP agent "${String(id)}"`)
      if (deps.isBusy(id)) throw new Error('Wait for its chats to finish before editing this agent')
    }
    const agent = checkAcpAgent(raw, adapters.map((a) => a.id), home)
    const adapter = create(agent)
    const at = adapters.findIndex((a) => a.id === agent.id)
    if (at === -1) adapters.push(adapter)
    else adapters[at] = adapter
    settings.acpAgents = at === -1 ? [...saved(), agent] : saved().map((a) => (a.id === agent.id ? agent : a))
    saveSettings()
    listChanged()
    await deps.detect(adapter)
    return agent
  }

  /** Removes an agent the user added. Chats that ran on it keep their history and move to another engine's models. */
  function remove(id: string) {
    if (!agentOf(id)) throw new Error(`No added ACP agent "${id}"`)
    if (deps.isBusy(id)) throw new Error('Wait for its chats to finish before removing this agent')
    const at = adapters.findIndex((a) => a.id === id)
    if (at !== -1) adapters.splice(at, 1)
    settings.acpAgents = saved().filter((a) => a.id !== id)
    if (!settings.acpAgents.length) delete settings.acpAgents
    const { [id]: _, ...engines } = settings.engines
    settings.engines = engines
    saveSettings()
    deps.forget(id)
    listChanged()
  }

  return { save, remove, agentOf }
}
