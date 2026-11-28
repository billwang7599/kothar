// A permission request waiting in the chat (or a worker's, in its space), and the verdict pill once it's answered.
import { DropdownMenu } from 'radix-ui'
import type { ClientMessage, ToolKind } from '@kothar/core/shared'
import { Button, CHAT_NOUN, Chevron, Hint } from '../controls.tsx'
import type { ChatView, Permission } from '../state.ts'
import { BODY } from './parts.tsx'

export const VERDICTS = { allowed: 'Allowed', denied: 'Denied', cancelled: 'Cancelled' }
export const PILL = 'shrink-0 rounded-full px-6 text-xs leading-[1.6]'
export const VERDICT_COLORS = { allowed: 'bg-green/10 text-green', denied: 'bg-red/10 text-red', cancelled: 'bg-raised text-muted' }
const AUTO_VERDICT_HINTS: Record<'allowed' | 'denied', Partial<Record<ToolKind, string>>> = {
  allowed: {
    edit: 'An edit inside the work folder or a folder set to Edit in place, so Kothar allowed it without asking',
    shell: 'A command in a sandboxed chat, so Kothar ran it without asking',
  },
  denied: {
    edit:
      'An edit outside the folders this chat may write, so Kothar denied it without asking. Each folder’s mode in ' +
      'the Context panel sets where agents may write.',
  },
}

export function Verdict({ permission: { outcome, auto, toolKind } }: { permission: Permission }) {
  if (outcome === 'pending') return null
  const hint = auto && outcome !== 'cancelled' ? AUTO_VERDICT_HINTS[outcome][toolKind] : undefined
  return (
    <Hint text={hint}>
      <span data-verdict className={`${PILL} ${VERDICT_COLORS[outcome]} ${hint ? 'cursor-help' : ''}`}>
        {auto && outcome === 'allowed' ? 'Allowed automatically' : VERDICTS[outcome]}
      </span>
    </Hint>
  )
}

export type PromptProps = {
  permission: Permission
  chat: ChatView
  connected: boolean
  send: (m: ClientMessage) => void
  // Set in a worker's own view: its requests are answered in this chat, its space, not here.
  space?: ChatView
  select?: (chatId: string) => void
  // Set in a space, on the requests of a worker below it.
  fromWorker?: boolean
}

export function PermissionPrompt({ permission, chat, connected, send, space, select, fromWorker }: PromptProps) {
  const respond = (allow: boolean, trustHost?: 'space' | 'global') =>
    send({ type: 'permission.respond', chatId: chat.id, requestId: permission.requestId, allow, ...(trustHost && { trustHost }) })
  return (
    <div
      className="flex flex-col gap-8 rounded-lg border border-l-3 border-permission-border border-l-amber bg-permission-bg px-14 py-12 shadow-raised"
      aria-label={fromWorker ? `Request from worker ${chat.name}` : undefined}
    >
      <div className="text-body">
        {permission.buttons ? (
          <>
            {fromWorker && (
              <>
                Worker <strong>{chat.name}</strong>:{' '}
              </>
            )}
            <strong>{permission.name}</strong>?
          </>
        ) : fromWorker ? (
          <>
            Worker <strong>{chat.name}</strong> wants to run <strong>{permission.name}</strong>
          </>
        ) : (
          <>
            Allow <strong>{permission.name}</strong>?
          </>
        )}
      </div>
      <pre className="rounded border bg-bg px-10 py-8">{permission.summary}</pre>
      <details className="group">
        <summary className="flex w-fit list-none items-center gap-6 text-sm text-muted hover:text-text">
          <Chevron />
          Full input
        </summary>
        <pre className={`${BODY} mt-6 rounded border bg-bg pl-10`}>{JSON.stringify(permission.input, null, 2)}</pre>
      </details>
      {space && chat.status === 'waiting' ? (
        <div className="flex items-center gap-8 text-sm text-muted" data-waiting-in={space.id}>
          <span className="flex-1">Waiting for approval in {space.name}</span>
          {select && (
            <Button size="small" onClick={() => select(space.id)}>
              Go to {space.name}
            </Button>
          )}
        </div>
      ) : chat.status === 'waiting' ? (
        <div className="flex flex-wrap gap-8">
          {permission.buttons ? (
            // A card that asks in its own words is about something that can't be undone (forget): the yes is red.
            <>
              <Button variant="danger" disabled={!connected} onClick={() => respond(true)}>
                {permission.buttons.allow}
              </Button>
              <Button disabled={!connected} onClick={() => respond(false)}>
                {permission.buttons.deny}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={!connected} onClick={() => respond(true)}>
                Approve
              </Button>
              <Button variant="danger" disabled={!connected} onClick={() => respond(false)}>
                Deny
              </Button>
            </>
          )}
          {permission.sshHost && !permission.buttons && (
            <AlwaysAllow host={permission.sshHost} disabled={!connected} trust={(scope) => respond(true, scope)} />
          )}
        </div>
      ) : (
        <div className="text-sm text-muted">{chat.status === 'stopping' ? 'Stopping…' : 'Pending'}</div>
      )}
    </div>
  )
}

const SCOPES = [
  { scope: 'space', label: `This ${CHAT_NOUN.one}` },
  { scope: 'global', label: `All ${CHAT_NOUN.many}` },
] as const

type AlwaysAllowProps = {
  host: { host: string; key?: string }
  disabled: boolean
  trust: (scope: 'space' | 'global') => void
}

// Approves the request and adds its SSH server (with its key) to Allowed SSH hosts, in this space or in Settings, so
// later commands to it run without asking.
function AlwaysAllow({ host, disabled, trust }: AlwaysAllowProps) {
  const what = host.key ? `${host.host} with the key ${host.key}` : host.host
  return (
    <DropdownMenu.Root modal={false}>
      <Hint
        text={`Approve, and add ${what} to Allowed SSH hosts, so ssh, scp and rsync to it run without asking. Remove it in the Permissions tab or Settings → Permissions.`}
      >
        <DropdownMenu.Trigger asChild>
          <Button disabled={disabled} className="flex min-w-0 items-center gap-6" data-always-allow={host.host}>
            <span className="truncate">Always allow {host.host}</span>
            {/* Pointing down: it opens a menu. */}
            <span className="inline-flex rotate-90">
              <Chevron />
            </span>
          </Button>
        </DropdownMenu.Trigger>
      </Hint>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className="z-20 flex min-w-120 flex-col rounded-lg border bg-panel p-4 shadow-floating outline-none">
          {SCOPES.map(({ scope, label }) => (
            <DropdownMenu.Item
              key={scope}
              onSelect={() => trust(scope)}
              className="flex h-26 items-center rounded-sm px-12 text-sm whitespace-nowrap outline-none data-highlighted:bg-raised"
            >
              {label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
