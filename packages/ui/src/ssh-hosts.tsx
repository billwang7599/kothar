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
  'Run commands without asking is on and the chat is sandboxed.'

type SshHostsProps = {
  hosts: SshHost[]
  disabled: boolean
  onChange: (hosts: SshHost[]) => void
  // Set where the list can come from above (a chat): the place it comes from, and how to go back to it.
  inherited?: { from: string; own: boolean; reset: () => void }
  // Shown under the label where there's no How this works to hold it (Settings).
  about?: string
}

export function SshHostsEditor({ hosts, disabled, onChange, inherited, about }: SshHostsProps) {
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
  return (
    <div className="flex flex-col gap-6" aria-label={SSH_HOSTS_LABEL} role="group">
      <div className="flex items-center justify-between gap-8">
        <span>{SSH_HOSTS_LABEL}</span>
        {inherited?.own && (
          <Button
            size="small"
            variant="ghost"
            aria-label={`Use the list from ${inherited.from}`}
            disabled={disabled}
            onClick={inherited.reset}
          >
            Reset
          </Button>
        )}
      </div>
      {about && <p className="text-sm text-muted">{about}</p>}
      {inherited && !inherited.own && hosts.length > 0 && <p className="text-sm text-muted">From {inherited.from}</p>}
      {hosts.length ? (
        <ul className="flex flex-col gap-4">
          {hosts.map((entry, i) => (
            <li key={`${entry.host} ${entry.key ?? ''}`} className="flex items-center gap-8 rounded border px-8 py-4">
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="font-mono text-sm">{entry.host}</span>
                {entry.key && <span className="block font-mono text-xs text-muted">{entry.key}</span>}
              </span>
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
