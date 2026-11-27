// Settings → Engines: each engine's switch and status, the ACP agents the user added (Edit, Remove, Add ACP agent),
// then each engine's built-in tools.
import { useState } from 'react'
import type { EngineInfo } from '@kothar/core/shared'
import { Button, GROUP, Switch } from '../controls.tsx'
import { engineProblem } from '../state.ts'
import { AcpAgentActions, AcpAgentForm, AddAcpAgent } from './acp-agents.tsx'
import { EngineToolsMaster, EngineToolsSections } from './engine-tools.tsx'
import { SettingRow } from './rows.tsx'
import type { PageProps } from './types.ts'

type Props = Pick<PageProps, 'engines' | 'engineTools' | 'connected' | 'send' | 'openGetStarted'>

export function EnginesPage({ engines, engineTools, connected, send, openGetStarted }: Props) {
  // The added agent whose form is open.
  const [editing, setEditing] = useState<string>()
  return (
    <>
      {openGetStarted && (
        <div className={`${GROUP} mb-16`}>
          <SettingRow name="Get started" description="Install and sign in to an engine, then make your first space.">
            <Button onClick={openGetStarted}>Open…</Button>
          </SettingRow>
        </div>
      )}
      <EngineToolsMaster settings={engineTools} connected={connected} send={send} />
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
      <AddAcpAgent connected={connected} send={send} />
      <EngineToolsSections settings={engineTools} engines={engines} connected={connected} send={send} />
    </>
  )
}

type RowProps = {
  engine: EngineInfo
  connected: boolean
  send: Props['send']
  editing: boolean
  setEditing: (on: boolean) => void
}

function EngineRow({ engine, connected, send, editing, setEditing }: RowProps) {
  const problem = engineProblem(engine)
  const { acp } = engine
  return (
    <SettingRow
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
