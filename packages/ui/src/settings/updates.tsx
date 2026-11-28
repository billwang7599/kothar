// Settings → General → Updates, in the packaged desktop app only (updates.ts). The preference lives in the desktop
// shell, which reads it before the window opens, not in this window's localStorage.
import { Button, Switch } from '../controls.tsx'
import { updateStatus, updatesBridge, useUpdates } from '../updates.ts'
import { Section, SettingRow } from './rows.tsx'
import { ANCHORS, settingAnchor } from './search.ts'

export const UPDATE_AUTOMATICALLY_HINT =
  'Downloads new versions in the background and installs them when Kothar quits, or when you click Restart. When ' +
  'it’s off, Kothar still checks and tells you, but downloads only when you click Download.'

export function UpdatesSection() {
  const info = useUpdates()
  const updates = updatesBridge()
  if (!info || !updates) return null
  const busy = info.state.status !== 'idle'
  return (
    <Section id={ANCHORS.updates} title="Updates">
      <SettingRow
        id={settingAnchor('update-automatically')}
        name="Update automatically"
        hint={UPDATE_AUTOMATICALLY_HINT}
        description={updateStatus(info)}
      >
        {info.state.status === 'ready' ? (
          <Button size="small" variant="primary" onClick={() => updates.restart()}>
            Restart to update
          </Button>
        ) : info.state.status === 'available' ? (
          <Button size="small" onClick={() => updates.download()}>
            Download
          </Button>
        ) : (
          <Button size="small" disabled={busy} onClick={() => updates.check()}>
            Check now
          </Button>
        )}
        <Switch label="Update automatically" checked={info.autoDownload} onChange={(on) => updates.setAutoDownload(on)} />
      </SettingRow>
    </Section>
  )
}
