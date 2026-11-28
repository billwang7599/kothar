// Settings → Engines: Get started, each engine's switch and status with the ACP agents the user added (Edit, Remove,
// Add ACP agent), the accounts of the engines that are on, the model lists, then (under Advanced) each engine's
// built-in tools.
import { useState } from 'react'
import type { EngineInfo } from '@kothar/core/shared'
import { Button, CHAT_NOUN, GROUP, Switch } from '../controls.tsx'
import { engineProblem } from '../state.ts'
import { EngineAccountsSection } from './accounts.tsx'
import { AcpAgentActions, AcpAgentForm, AddAcpAgent } from './acp-agents.tsx'
import { ENGINE_TOOLS_OFF, EngineToolsMaster, EngineToolsSections } from './engine-tools.tsx'
import { ModelListsSection } from './models.tsx'
import { Advanced, Section, SettingRow } from './rows.tsx'
import { ANCHORS, settingAnchor } from './search.ts'
import type { PageProps } from './types.ts'

const ACCOUNTS_HINT =
  'Each engine runs as its Active account: one saved here, or whoever the engine itself is signed in as. Accounts ' +
  'show while their engine is on.'
const MODELS_HINT =
  'Each list runs its first model that can run, on any engine; if that engine is off or stops offering it, the next ' +
  `one runs. A ${CHAT_NOUN.one}'s own pick in its message box comes first.`

// Only engines, connected and send are needed; the rest show once given.
type Props = Pick<PageProps, 'engines' | 'connected' | 'send'> & Partial<PageProps>

export function EnginesPage({ engines, accounts = [], engineTools, modelLists = { chat: [], workers: [] }, extensions, connected, send, openGetStarted }: Props) {
  // The added agent whose form is open.
  const [editing, setEditing] = useState<string>()
  const anyOn = engines.some((e) => e.enabled)
  const shownAccounts = engines.flatMap((e) => (e.enabled ? accounts.filter((a) => a.engine === e.id) : []))
  return (
    <>
      {openGetStarted && (
        <div className={GROUP}>
          <SettingRow id={ANCHORS.getStarted} name="Get started" description="Install and sign in to an engine, then make your first space.">
            <Button onClick={openGetStarted}>Open…</Button>
          </SettingRow>
        </div>
      )}
      {engineTools && !engineTools.enabled && <p className="pt-12 text-sm text-amber">{ENGINE_TOOLS_OFF} Turn them back on under Advanced.</p>}
      <Section id={ANCHORS.engines} title="Engines" hint="Kothar only starts the engines you turn on here." plain>
        <div className={GROUP}>
          {engines.map((engine) => (
            <EngineRow
              key={engine.id}
              engine={engine}
              connected={connected}
              send={send}
              editing={editing === engine.id}
              setEditing={(on) => setEditing(on ? engine.id : undefined)}
            />
          ))}
        </div>
        <div className="pt-8">
          <AddAcpAgent connected={connected} send={send} />
        </div>
      </Section>
      <Section id={ANCHORS.accounts} title="Accounts" hint={ACCOUNTS_HINT} plain>
        {shownAccounts.length ? (
          shownAccounts.map((a) => <EngineAccountsSection key={a.engine} accounts={a} connected={connected} send={send} />)
        ) : (
          <p className="text-sm text-muted">Turn on an engine to manage its accounts.</p>
        )}
      </Section>
      <Section id={ANCHORS.models} title="Models" hint={MODELS_HINT} plain>
        {anyOn ? (
          <ModelListsSection engines={engines} lists={modelLists} extensions={extensions} connected={connected} send={send} />
        ) : (
          <p className="text-sm text-muted">Turn on an engine to pick models.</p>
        )}
      </Section>
      {engineTools && (
        <Advanced page="engines" note={engineTools.enabled ? undefined : 'Engine tools off'}>
          <div id={ANCHORS.engineTools} className="flex scroll-mt-12 flex-col">
            <EngineToolsMaster settings={engineTools} connected={connected} send={send} />
            <EngineToolsSections settings={engineTools} engines={engines} connected={connected} send={send} />
          </div>
        </Advanced>
      )}
    </>
  )
}

type RowProps = {
  engine: EngineInfo
  connected: boolean
  send: PageProps['send']
  editing: boolean
  setEditing: (on: boolean) => void
}

function EngineRow({ engine, connected, send, editing, setEditing }: RowProps) {
  const problem = engineProblem(engine)
  const { acp } = engine
  return (
    <SettingRow
      id={settingAnchor('engine', engine.id)}
      name={
        acp ? (
          <span>
            {acp.name} <span className="font-mono text-sm text-muted">{engine.id}</span>
          </span>
        ) : (
          <span className="font-mono">{engine.id}</span>
        )
      }
      description={
        <span className={`block first-letter:uppercase ${problem ? 'text-amber' : 'text-green'}`}>
          {problem ?? 'Ready'}
          {engine.detail && ` · ${engine.detail}`}
        </span>
      }
      below={acp && editing ? <AcpAgentForm agent={acp} connected={connected} send={send} done={() => setEditing(false)} /> : undefined}
    >
      {acp && <AcpAgentActions agent={acp} connected={connected} send={send} edit={() => setEditing(true)} />}
      <Switch
        label={`${engine.id} on`}
        checked={engine.enabled}
        disabled={!connected}
        onChange={(enabled) => send({ type: 'engine.setEnabled', engine: engine.id, enabled })}
      />
    </SettingRow>
  )
}
