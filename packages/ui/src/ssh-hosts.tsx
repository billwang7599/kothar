// Allowed SSH hosts: the servers ssh, scp, sftp and rsync may reach without asking, each with the one key it may use.
// The same list editor sits in a chat's Permissions section and in Settings → Work folder.
import { useState, type FormEvent } from 'react'
import type { SshHost } from '@kothar/core/shared'
import { Button } from './controls.tsx'

export const SSH_HOSTS_LABEL = 'Allowed SSH hosts'
export const SSH_HOSTS_ABOUT =
  'ssh, scp, sftp and rsync run without asking when every server they reach is listed here, even while network ' +
  'commands ask, and may read the key listed with it (no other file in ~/.ssh). Write a host as host.example.com, ' +
  'user@host.example.com, or *.example.com for its subdomains. Without a key, no -i key is allowed for it. Only while ' +
  'Run commands without asking is on and the chat is sandboxed. A space\'s list adds to the one in Settings.'

type SshHostsProps = {
  // This place's own list: the one Add and × change.
  hosts: SshHost[]
  disabled: boolean
  onChange: (hosts: SshHost[]) => void
  // In a chat: the hosts it also trusts from above (its space, Settings), each with where it's set. They're listed
  // read only, since a chat's list adds to them and can't take one away; they're changed where they're set.
  inherited?: { entry: SshHost; from: string }[]
  // Shown under the label where there's no How this works to hold it (Settings).
  about?: string
}

const sameHost = (a: SshHost, b: SshHost) => a.host === b.host && a.key === b.key

function HostText({ entry }: { entry: SshHost }) {
  return (
    <span className="min-w-0 flex-1 wrap-anywhere">
      <span className="font-mono text-sm">{entry.host}</span>
      {entry.key && <span className="block font-mono text-xs text-muted">{entry.key}</span>}
    </span>
  )
}

export function SshHostsEditor({ hosts, disabled, onChange, inherited = [], about }: SshHostsProps) {
  const [host, setHost] = useState('')
  const [key, setKey] = useState('')
  const add = (event: FormEvent) => {
    event.preventDefault()
    const entry = { host: host.trim(), ...(key.trim() && { key: key.trim() }) }
    if (!entry.host) return
    onChange([...hosts, entry])
    setHost('')
    setKey('')
  }
  // A host set both above and here shows once, as this place's own, so × is there for it.
  const above = inherited.filter((item, i) => !hosts.some((own) => sameHost(own, item.entry)) && inherited.findIndex((o) => sameHost(o.entry, item.entry)) === i)
  return (
    <div className="flex flex-col gap-6" aria-label={SSH_HOSTS_LABEL} role="group">
      <span>{SSH_HOSTS_LABEL}</span>
      {about && <p className="text-sm text-muted">{about}</p>}
      {above.length > 0 || hosts.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {above.map(({ entry, from }) => (
            <li
              key={`above ${entry.host} ${entry.key ?? ''}`}
              className="flex items-center gap-8 rounded border border-dashed px-8 py-4 text-muted"
              data-inherited=""
            >
              <HostText entry={entry} />
              <span className="shrink-0 text-xs text-faint">From {from}</span>
            </li>
          ))}
          {hosts.map((entry, i) => (
            <li key={`${entry.host} ${entry.key ?? ''}`} className="flex items-center gap-8 rounded border px-8 py-4">
              <HostText entry={entry} />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${entry.host}`}
                disabled={disabled}
                onClick={() => onChange(hosts.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">None.</p>
      )}
      <form className="flex flex-wrap items-center gap-6" onSubmit={add}>
        <input
          className="min-w-120 flex-1 font-mono text-sm"
          aria-label="SSH host"
          placeholder="user@host.example.com"
          value={host}
          spellCheck={false}
          autoCapitalize="off"
          disabled={disabled}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          className="min-w-120 flex-1 font-mono text-sm"
          aria-label="SSH key (optional)"
          placeholder="~/.ssh/id_ed25519 (optional)"
          value={key}
          spellCheck={false}
          autoCapitalize="off"
          disabled={disabled}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button type="submit" size="small" disabled={disabled || !host.trim()}>
          Add
        </Button>
      </form>
    </div>
  )
}
