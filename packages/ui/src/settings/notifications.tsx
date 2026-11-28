// Settings → General → Notifications. They live in this window, not the garage.
import { useState } from 'react'
import { Button, CHAT_NOUN, Switch } from '../controls.tsx'
import {
  askNotificationLeave,
  notificationsAllowed,
  setNotificationPref,
  useNotificationPrefs,
  type NotifyKind,
} from '../notifications.ts'
import { Section, SettingRow } from './rows.tsx'
import { ANCHORS, settingAnchor } from './search.ts'

const NOTIFY_KINDS: { kind: NotifyKind; name: string; hint: string }[] = [
  { kind: 'needsYou', name: 'Needs you', hint: 'A permission request, a question, or an extension waiting on you' },
  { kind: 'finished', name: 'Finished', hint: `A ${CHAT_NOUN.one} or Home finished a turn. Workers report to their ${CHAT_NOUN.one} instead.` },
  { kind: 'errors', name: 'Errors', hint: 'A turn ended with an error, a worker\'s too' },
]

const NOTIFY_HINT = `Only while you aren't looking at that ${CHAT_NOUN.one}. With Kothar in front, only what needs you or failed in another ${CHAT_NOUN.one} shows. Several at once show as one; clicking it opens the ${CHAT_NOUN.one}.`

export function NotificationsSection() {
  const prefs = useNotificationPrefs()
  // In a browser tab (development), the browser asks before a page may notify.
  const [allowed, setAllowed] = useState(notificationsAllowed)
  const allow = async () => setAllowed((await askNotificationLeave()) === 'granted')
  return (
    <Section id={ANCHORS.notifications} title="Notifications" hint={NOTIFY_HINT}>
      <SettingRow id={settingAnchor('notifications')} name="Show notifications">
        {prefs.enabled && !allowed && (
          <Button size="small" onClick={() => void allow()}>
            Allow in this browser
          </Button>
        )}
        <Switch label="Show notifications" checked={prefs.enabled} onChange={(on) => setNotificationPref('enabled', on)} />
      </SettingRow>
      {NOTIFY_KINDS.map(({ kind, name, hint }) => (
        <SettingRow key={kind} id={settingAnchor('notify', kind)} name={name} hint={hint}>
          <Switch
            label={`Notify: ${name}`}
            checked={prefs[kind]}
            disabled={!prefs.enabled}
            onChange={(on) => setNotificationPref(kind, on)}
          />
        </SettingRow>
      ))}
    </Section>
  )
}
