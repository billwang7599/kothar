// Settings → General → Updates, in the packaged desktop app only (updates.ts): the running version, what the last check
// found, Check now, and Update for any version found, including one the user said Not now to in the notice.
import { Button } from '../controls.tsx'
import { updateStatus, updatesBridge, useUpdates } from '../updates.ts'
import { Section, SettingRow } from './rows.tsx'
import { ANCHORS, settingAnchor } from './search.ts'

export const UPDATES_HINT =
  'Kothar checks for a new version at launch and every few hours, and asks before it downloads anything. Updates ' +
  'install only when you click Update.'

export function UpdatesSection() {
  const info = useUpdates()
  const updates = updatesBridge()
  if (!info || !updates) return null
  const { state } = info
  return (
    <Section id={ANCHORS.updates} title="Updates">
      <SettingRow id={settingAnchor('updates')} name={`Kothar ${info.current}`} hint={UPDATES_HINT} description={updateStatus(info)}>
        {state.status === 'ready' ? (
          <Button size="small" variant="primary" onClick={() => updates.restart()}>
            Restart
          </Button>
        ) : state.status === 'available' ? (
          <Button size="small" variant="primary" onClick={() => updates.download()}>
            Update
          </Button>
        ) : (
          <Button size="small" disabled={state.status !== 'idle'} onClick={() => updates.check()}>
            Check now
          </Button>
        )}
      </SettingRow>
    </Section>
  )
}
