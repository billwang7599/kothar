// Settings → Agents: how agents work. Workers (part of Kothar, not an extension: whether agents may start them, how many
// one chat runs at once, extensions' workers too) and Setups; then, under Advanced, what a chat takes from the chats
// above it by default, and Kothar's own prompts with what chats that may start workers are told.
import { CONTEXT_SECTIONS, type ClientMessage, type PromptInfo, type WorkersSettings } from '@kothar/core/shared'
import { SECTIONS } from '../context-panel.tsx'
import { CHAT_NOUN, Switch } from '../controls.tsx'
import { SetupsPage } from '../setups-page.tsx'
import { ExtensionSettingRow, PromptRow } from './extensions.tsx'
import { Advanced, Section, SettingRow } from './rows.tsx'
import { ANCHORS, settingAnchor } from './search.ts'
import type { PageProps } from './types.ts'

export const WORKERS_INTRO =
  'A worker is a chat started below another for one task, which reports back when it ends. Agents start them with ' +
  'spawn_worker, and extensions start them for their own work, such as Deep Research’s searches.'

const LIMIT = {
  key: 'limit',
  label: 'Max running per chat',
  description: 'How many workers one chat runs at once, its agent’s and its extensions’ together. More wait for a slot. Leave empty for no limit.',
  type: 'number',
  default: 4,
  min: 1,
  integer: true,
  empty: { value: -1, placeholder: 'No limit' },
} as const

type Props = { workers?: WorkersSettings; connected: boolean; send: (m: ClientMessage) => void }

function WorkersSection({ workers, connected, send }: Props) {
  if (!workers) return null
  return (
    <Section id={ANCHORS.workers} title="Workers" hint={WORKERS_INTRO}>
      <SettingRow
        id={settingAnchor('workers', 'start')}
        name="Let agents start workers"
        hint="Off: chats get no spawn_worker tool and no instructions about it. Extensions can still start workers for their own work."
      >
        <Switch
          label="Let agents start workers"
          checked={workers.start}
          disabled={!connected}
          onChange={(start) => send({ type: 'workers.set', start })}
        />
      </SettingRow>
      <SettingRow
        id={settingAnchor('workers', 'worktree')}
        name="Own worktree per worker"
        hint="Each worker gets its own branch and worktree of each git folder, so workers never clash. Its changes wait in its report to be merged or discarded. Off: workers share the space’s checkout."
      >
        <Switch
          label="Own worktree per worker"
          checked={workers.ownCheckouts}
          disabled={!connected}
          onChange={(ownCheckouts) => send({ type: 'workers.set', ownCheckouts })}
        />
      </SettingRow>
      <ExtensionSettingRow
        id={settingAnchor('workers', 'limit')}
        setting={LIMIT}
        value={workers.limit}
        disabled={!connected}
        save={(limit) => {
          // 0 would let no worker run, so an extension's would wait forever: Let agents start workers is the switch.
          if (typeof limit === 'number' && limit !== 0) send({ type: 'workers.set', limit })
        }}
      />
    </Section>
  )
}

const SETUPS_HINT =
  `A setup is a saved model, thinking level, extensions and instructions for a kind of job. Pick one for a ${CHAT_NOUN.one} ` +
  'in its General tab; a lead can also start a worker with one by name. What a setup leaves out follows Settings.'

const CONTEXT_HINT =
  `What a ${CHAT_NOUN.one} uses from the global AGENTS.md and the chats above it, unless you switch it in its Context ` +
  'panel. Its own AGENTS.md, folders and files always start on.'

export const CORE_PROMPTS_INTRO =
  'Kothar’s own prompts, sent with every message of the chats they apply to. Your edit is sent instead of the default; ' +
  'the Inspector shows each where it’s sent.'

export function AgentsPage({ workers, setups = [], setupSave, engines, extensions, contextDefaults, corePrompts = [], connected, send }: PageProps) {
  return (
    <>
      <WorkersSection workers={workers} connected={connected} send={send} />
      <Section id={ANCHORS.setups} title="Setups" hint={SETUPS_HINT} plain>
        <SetupsPage setups={setups} engines={engines} extensions={extensions} connected={connected} send={send} saved={setupSave} />
      </Section>
      <Advanced page="agents">
        <Section id={ANCHORS.context} title="Context from above" hint={CONTEXT_HINT}>
          {CONTEXT_SECTIONS.map((section) => (
            <SettingRow
              key={section}
              id={settingAnchor('context', section)}
              name={SECTIONS[section].label}
              hint={SECTIONS[section].inherited}
            >
              <Switch
                label={`${SECTIONS[section].label} from above on by default`}
                checked={contextDefaults[section]}
                disabled={!connected}
                onChange={(enabled) => send({ type: 'context.setDefault', section, enabled })}
              />
            </SettingRow>
          ))}
        </Section>
        <Section id={ANCHORS.prompts} title="Prompts" hint={CORE_PROMPTS_INTRO} plain>
          {workers && (
            <PromptRow
              prompt={workers.instructions}
              anchor={`prompt-workers-${workers.instructions.id}`}
              disabled={!connected || !workers.start}
              save={(text) => send({ type: 'workers.prompt.set', ...(text !== undefined && { text }) })}
            />
          )}
          <CorePrompts prompts={corePrompts} connected={connected} send={send} />
        </Section>
      </Advanced>
    </>
  )
}

// Kothar's own prompts, such as the intro to "What you can use". Each has an id (prompt-kothar-<prompt>) that the
// Inspector's Edit links scroll to.
function CorePrompts({ prompts, connected, send }: { prompts: PromptInfo[]; connected: boolean; send: (m: ClientMessage) => void }) {
  return prompts.map((prompt) => (
    <div key={prompt.id}>
      {prompt.description && <p className="text-sm text-muted">{prompt.description}</p>}
      <PromptRow
        prompt={prompt}
        anchor={`prompt-kothar-${prompt.id}`}
        disabled={!connected}
        save={(text) => send({ type: 'corePrompt.set', id: prompt.id, ...(text !== undefined && { text }) })}
      />
    </div>
  ))
}
