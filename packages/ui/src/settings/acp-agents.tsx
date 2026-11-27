// Settings → Engines: adding, editing and removing an ACP agent (any agent that speaks the Agent Client Protocol), which
// then sits in the engine list like a built-in engine. The core checks and saves it (acp-agents.ts).
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { AcpAgent, ClientMessage } from '@kothar/core/shared'
import { Button, confirm, Hint } from '../controls.tsx'

export const ACP_ABOUT =
  'Any agent that speaks the Agent Client Protocol (agentclientprotocol.com) can run here, such as Gemini CLI ' +
  '(gemini --experimental-acp) or Claude Code through claude-code-acp. Kothar starts it in each chat\'s folder, ' +
  'sandboxed, with its own config and logins.'

// One line of arguments, split like a shell does at spaces, with "…" or '…' keeping spaces in one.
export function splitArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: string | undefined
  let started = false
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) args.push(current)
  return args
}

export const joinArgs = (args: string[]) => args.map((arg) => (/[\s"']/.test(arg) || !arg ? `"${arg}"` : arg)).join(' ')

// KEY=value lines; a line without = is left out.
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1)
  }
  return env
}

const envText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

const FIELD = 'min-w-0 flex-1 font-mono text-sm'

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-start gap-x-12 gap-y-4">
      <label htmlFor={id} className="w-140 shrink-0 pt-4 text-sm">
        {hint ? (
          <Hint text={hint}>
            <span className="underline decoration-dotted underline-offset-4">{label}</span>
          </Hint>
        ) : (
          label
        )}
      </label>
      {children(id)}
    </div>
  )
}

type FormProps = {
  // The agent being edited; none to add one.
  agent?: AcpAgent
  connected: boolean
  send: (message: ClientMessage) => void
  done: () => void
}

export function AcpAgentForm({ agent, connected, send, done }: FormProps) {
  const [name, setName] = useState(agent?.name ?? '')
  const [command, setCommand] = useState(agent?.command ?? '')
  const [args, setArgs] = useState(joinArgs(agent?.args ?? []))
  const [env, setEnv] = useState(envText(agent?.env ?? {}))
  const [writable, setWritable] = useState((agent?.writable ?? []).join('\n'))
  const ready = connected && name.trim() !== '' && command.trim() !== ''
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    const lines = writable.split('\n').map((line) => line.trim()).filter(Boolean)
    send({
      type: 'acpAgent.save',
      agent: {
        ...(agent && { id: agent.id }),
        name: name.trim(),
        command: command.trim(),
        args: splitArgs(args),
        env: parseEnv(env),
        ...(lines.length && { writable: lines }),
      },
    })
    done()
  }
  return (
    <form
      className="flex flex-col gap-8 rounded border bg-bg p-12"
      aria-label={agent ? `Edit ${agent.name}` : 'Add ACP agent'}
      onSubmit={submit}
    >
      <Field label="Name">
        {(id) => (
          <input id={id} className="min-w-0 flex-1 text-sm" placeholder="Gemini CLI" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field label="Command" hint="The program that starts the agent: a name on your PATH, or a full path.">
        {(id) => (
          <input id={id} className={FIELD} placeholder="gemini" value={command} spellCheck={false} autoCapitalize="off" onChange={(e) => setCommand(e.target.value)} />
        )}
      </Field>
      <Field
        label="Arguments"
        hint={'What makes it speak ACP on stdio. Quote an argument with spaces. {cwd} becomes the chat\'s folder, for agents that take it as an argument.'}
      >
        {(id) => (
          <input id={id} className={FIELD} placeholder="--experimental-acp" value={args} spellCheck={false} autoCapitalize="off" onChange={(e) => setArgs(e.target.value)} />
        )}
      </Field>
      <Field label="Environment" hint="One KEY=value a line, added to the agent's environment, such as an API key.">
        {(id) => (
          <textarea id={id} className={`${FIELD} min-h-56`} placeholder="GEMINI_API_KEY=…" value={env} spellCheck={false} autoCapitalize="off" onChange={(e) => setEnv(e.target.value)} />
        )}
      </Field>
      <Field
        label="Writable folders"
        hint="One a line. Folders the agent may write besides the chat's folder while sandboxed, such as its own config or cache folder (~/.gemini)."
      >
        {(id) => (
          <textarea id={id} className={`${FIELD} min-h-40`} placeholder="~/.gemini" value={writable} spellCheck={false} autoCapitalize="off" onChange={(e) => setWritable(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end gap-6">
        <Button type="button" size="small" variant="ghost" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" size="small" disabled={!ready}>
          {agent ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  )
}

// Edit and Remove on an added agent's engine row.
export function AcpAgentActions({ agent, connected, send, edit }: { agent: AcpAgent; connected: boolean; send: FormProps['send']; edit: () => void }) {
  const remove = async () => {
    const ok = await confirm({
      text: `Remove ${agent.name}?`,
      body: 'Its chats keep their history and run on the next model in your Chat list that can.',
      ok: 'Remove',
      danger: true,
    })
    if (ok) send({ type: 'acpAgent.remove', engine: agent.id })
  }
  return (
    <>
      <Button size="small" variant="ghost" disabled={!connected} onClick={edit}>
        Edit
      </Button>
      <Button size="small" variant="ghost" disabled={!connected} onClick={() => void remove()}>
        Remove
      </Button>
    </>
  )
}

// The Add ACP agent button under the engine list, and its form while open.
export function AddAcpAgent({ connected, send }: Omit<FormProps, 'agent' | 'done'>) {
  const [open, setOpen] = useState(false)
  if (open) return <AcpAgentForm connected={connected} send={send} done={() => setOpen(false)} />
  return (
    <div className="flex">
      <Hint text={ACP_ABOUT}>
        <Button size="small" disabled={!connected} onClick={() => setOpen(true)}>
          Add ACP agent
        </Button>
      </Hint>
    </div>
  )
}
