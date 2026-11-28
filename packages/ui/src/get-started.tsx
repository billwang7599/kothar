// Get started: a short checklist that opens once the work folder is chosen, until every step is done or the user closes
// it (remembered in localStorage, like the window's other preferences). Settings → Engines and the Get started
// shortcut open it again. Engine status comes from the adapters' own detection (EngineInfo), never from engine names.
// Two optional steps follow: the built-in extensions, each with its switch (the same call as Settings → Built-in
// extensions), and the Marketplace, which opens only once its switch is on.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Dialog } from 'radix-ui'
import type { ChatInfo, ClientMessage, EngineAccounts, EngineInfo, ExtensionInfo } from '@kothar/core/shared'
import { Button, CHAT_NOUN, Chevron, CopyButton, Hint, MOTION, Switch, useReturnFocus } from './controls.tsx'
import { engineName } from './state.ts'

const DISMISSED_KEY = 'kothar.getStarted.dismissed'
// How long Check again waits for the core before it lets the user press it again.
const CHECK_TIMEOUT_MS = 15_000

export const getStartedDismissed = () => localStorage.getItem(DISMISSED_KEY) === 'true'
export const dismissGetStarted = () => localStorage.setItem(DISMISSED_KEY, 'true')

export type EngineReadiness = 'missing' | 'signedOut' | 'off' | 'ready'

/** Where an engine stands: installed, signed in (as its active account) and turned on. */
export function readiness(engine: EngineInfo, accounts?: EngineAccounts): EngineReadiness {
  if (!engine.installed) return 'missing'
  const active = accounts?.accounts.find((a) => a.id === accounts.active)
  if (!(active?.signedIn ?? engine.signedIn)) return 'signedOut'
  return engine.enabled ? 'ready' : 'off'
}

/** A top-level chat the user made: not Home or another extension's chat, and not a worker. */
export const hasSpace = (chats: Pick<ChatInfo, 'parentId' | 'extension'>[]) =>
  chats.some((c) => !c.parentId && !c.extension)

/** Every step needed is done: an engine that's ready, and a space. Extensions and the Marketplace are optional. */
export const setUpDone = (engines: EngineInfo[], accounts: EngineAccounts[], chats: ChatInfo[]) =>
  engines.some((e) => readiness(e, accounts.find((a) => a.engine === e.id)) === 'ready') && hasSpace(chats)

const STATUS: Record<EngineReadiness, { text: string; tone: string }> = {
  missing: { text: 'Not installed', tone: 'text-amber' },
  signedOut: { text: 'Not signed in', tone: 'text-amber' },
  off: { text: 'Ready, turned off', tone: 'text-muted' },
  ready: { text: 'Ready', tone: 'text-green' },
}

type Props = {
  open: boolean
  close: () => void
  engines: EngineInfo[]
  accounts: EngineAccounts[]
  chats: ChatInfo[]
  connected: boolean
  send: (m: ClientMessage) => void
  /** Settings at a page, scrolled to the anchor (an engine's accounts). */
  openSettings: (page: string, anchor?: string) => void
  newSpace: () => void
  openMarketplace: () => void
  /** Every extension the core knows; the built-in ones that have a switch are listed. */
  extensions: ExtensionInfo[]
  /** The Marketplace's switch. */
  marketplace: boolean
}

/** The extensions that ship with Kothar and have a switch: not community ones, and not always-on ones (Home). */
export const coreExtensions = (extensions: ExtensionInfo[]) => extensions.filter((e) => !e.community && !e.alwaysOn)

/** An extension's first sentence, for its one line; the rest goes in a tooltip. */
export const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? text

export function GetStartedDialog({ open, close, engines, accounts, chats, connected, send, extensions, marketplace, ...actions }: Props) {
  const focus = useReturnFocus()
  const accountsOf = (engine: EngineInfo) => accounts.find((a) => a.engine === engine.id)
  const engineReady = engines.some((e) => readiness(e, accountsOf(e)) === 'ready')
  const spaceMade = hasSpace(chats)
  const done = engineReady && spaceMade

  // Check again: pressed until the engines come back from the core, or a while passes.
  const [checking, setChecking] = useState(false)
  const [checkedEngines, setCheckedEngines] = useState(engines)
  if (engines !== checkedEngines) {
    setCheckedEngines(engines)
    setChecking(false)
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const checkAgain = () => {
    setChecking(true)
    send({ type: 'engines.detect' })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setChecking(false), CHECK_TIMEOUT_MS)
  }
  // Signing in happens in Settings → Accounts, which lists an engine's accounts only while it's on.
  const signIn = (engine: EngineInfo) => {
    if (!engine.enabled) send({ type: 'engine.setEnabled', engine: engine.id, enabled: true })
    actions.openSettings('accounts', `accounts-${engine.id}`)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(open) => open || close()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <m.div className="fixed inset-0 bg-backdrop" {...MOTION.fade} />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                // The dialog itself takes focus, so no step's button looks picked when it opens.
                focus.remember()
                e.preventDefault()
                ;(e.currentTarget as HTMLElement).focus()
              }}
              onCloseAutoFocus={focus.restore}
            >
              <m.div
                tabIndex={-1}
                className="fixed inset-0 outline-none m-auto flex h-fit max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] flex-col gap-16 scroll-inset overflow-y-auto rounded-xl border bg-panel pt-14 pr-2 pb-16 pl-16 text-text shadow-overlay"
                {...MOTION.pop}
              >
                <Dialog.Title className="display text-[16px] leading-[1.2]">Get started</Dialog.Title>
                <ol className="flex flex-col gap-16 pr-14">
                  <Step
                    n={1}
                    done={engineReady}
                    title="Set up an engine"
                    hint="Kothar runs coding agents you install and sign in to yourself. One is enough to start."
                  >
                    <ul className="flex flex-col rounded-lg border bg-bg px-12" aria-label="Engines">
                      {engines.map((engine) => (
                        <EngineLine
                          key={engine.id}
                          engine={engine}
                          state={readiness(engine, accountsOf(engine))}
                          canSignIn={!!accountsOf(engine)}
                          connected={connected}
                          signIn={() => signIn(engine)}
                          turnOn={() => send({ type: 'engine.setEnabled', engine: engine.id, enabled: true })}
                        />
                      ))}
                      {!engines.length && <li className="py-10 text-sm text-muted">No engines yet.</li>}
                    </ul>
                    <div className="flex flex-wrap items-center gap-8">
                      <Button size="small" disabled={!connected || checking} onClick={checkAgain}>
                        {checking ? 'Checking…' : 'Check again'}
                      </Button>
                      <Hint text="Any agent that speaks the Agent Client Protocol (ACP) can run in Kothar.">
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => actions.openSettings('engines', 'add-acp-agent')}
                        >
                          Add an ACP agent…
                        </Button>
                      </Hint>
                    </div>
                  </Step>
                  <Step
                    n={2}
                    done={spaceMade}
                    title={`Make your first ${CHAT_NOUN.one}`}
                    hint={`A ${CHAT_NOUN.one} is a project folder with its own agent, context and history.`}
                  >
                    <div>
                      <Button size="small" disabled={!connected} onClick={actions.newSpace}>
                        New {CHAT_NOUN.one}…
                      </Button>
                    </div>
                  </Step>
                  <Step
                    n={3}
                    title="Core extensions"
                    hint="Extensions that ship with Kothar. Turn on what you want; each one with settings has a page in Settings."
                    optional
                  >
                    <CoreExtensions
                      extensions={coreExtensions(extensions)}
                      connected={connected}
                      send={send}
                      openSettings={actions.openSettings}
                    />
                  </Step>
                  <Step
                    n={4}
                    title="Marketplace"
                    hint="Themes and community extensions made by other people. Community extensions also need their own switch in Settings → Community hub."
                    optional
                  >
                    <div className="flex flex-wrap items-center gap-x-16 gap-y-8">
                      <label className="flex items-center gap-8">
                        <Switch
                          label="Enable the Marketplace"
                          checked={marketplace}
                          disabled={!connected}
                          onChange={(enabled) => send({ type: 'marketplace.setEnabled', enabled })}
                        />
                        <span>Enable the Marketplace</span>
                      </label>
                      {marketplace ? (
                        <Button size="small" onClick={actions.openMarketplace}>
                          Open the Marketplace…
                        </Button>
                      ) : (
                        <Hint text="Enable the Marketplace first.">
                          {/* A disabled button gets no pointer events, so its wrapper shows the tooltip. */}
                          <span tabIndex={0} className="inline-flex rounded">
                            <Button size="small" disabled>
                              Open the Marketplace…
                            </Button>
                          </span>
                        </Hint>
                      )}
                    </div>
                  </Step>
                </ol>
                <div className="flex justify-end gap-8 pr-14">
                  <Hint text="Settings → Engines opens Get started again.">
                    <Dialog.Close asChild>
                      <Button variant={done ? 'primary' : 'default'}>{done ? 'Done' : 'Close'}</Button>
                    </Dialog.Close>
                  </Hint>
                </div>
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

type StepProps = { n: number; title: string; hint?: string; done?: boolean; optional?: boolean; children: ReactNode }

function Step({ n, title, hint, done = false, optional = false, children }: StepProps) {
  const heading = <span className="font-semibold">{title}</span>
  return (
    <li className="flex gap-10" aria-label={`${title}${done ? ', done' : ''}`}>
      <span
        aria-hidden="true"
        className={`grid size-22 shrink-0 place-items-center rounded-full border text-sm ${done ? 'border-green bg-green text-on-accent' : 'text-muted'}`}
      >
        {done ? '✓' : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-8 pt-1">
        <div className="flex items-baseline gap-8">
          {hint ? <Hint text={hint}>{heading}</Hint> : heading}
          {optional && <span className="text-sm text-muted">Optional</span>}
          {done && <span className="text-sm text-green">Done</span>}
        </div>
        {children}
      </div>
    </li>
  )
}

type EngineLineProps = {
  engine: EngineInfo
  state: EngineReadiness
  canSignIn: boolean
  connected: boolean
  signIn: () => void
  turnOn: () => void
}

function EngineLine({ engine, state, canSignIn, connected, signIn, turnOn }: EngineLineProps) {
  const name = engineName(engine)
  const status = STATUS[state]
  // The adapter's install command; without one (an ACP agent), what detection said, such as "x not found".
  const install = state === 'missing' ? engine.install : undefined
  const note = state === 'missing' && !install ? engine.detail : state === 'signedOut' && !canSignIn ? engine.detail : undefined
  return (
    <li className="flex flex-col gap-6 py-10 not-first:border-t" aria-label={name}>
      <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
        <span className="min-w-0 flex-1 wrap-anywhere">
          {name}
          <span className={`ml-8 text-sm ${status.tone}`}>{status.text}</span>
        </span>
        {state === 'signedOut' && canSignIn && (
          <Button size="small" disabled={!connected} onClick={signIn}>
            Sign in…
          </Button>
        )}
        {state === 'off' && (
          <Button size="small" disabled={!connected} onClick={turnOn}>
            Turn on
          </Button>
        )}
      </div>
      {install && (
        <div className="flex items-center gap-6 rounded border bg-panel py-2 pr-2 pl-8">
          <code className="min-w-0 flex-1 truncate font-mono text-sm" title={install}>
            {install}
          </code>
          <CopyButton text={install} label={`Copy the command that installs ${name}`} className="opacity-100!" />
        </div>
      )}
      {note && <span className="text-sm text-muted wrap-anywhere">{note}</span>}
    </li>
  )
}

type CoreExtensionsProps = {
  extensions: ExtensionInfo[]
  connected: boolean
  send: (m: ClientMessage) => void
  openSettings: (page: string, anchor?: string) => void
}

// The built-in extensions, folded under how many are on: the list is long, and the step is optional.
function CoreExtensions({ extensions, connected, send, openSettings }: CoreExtensionsProps) {
  const [open, setOpen] = useState(false)
  if (!extensions.length) return <p className="text-sm text-muted">No built-in extensions.</p>
  const on = extensions.filter((e) => e.enabled).length
  return (
    <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-6 text-sm text-muted hover:text-text">
        <Chevron />
        {on} of {extensions.length} on
      </summary>
      <ul className="mt-8 flex flex-col rounded-lg border bg-bg px-12" aria-label="Core extensions">
        {extensions.map((extension) => (
          <ExtensionLine
            key={extension.id}
            extension={extension}
            connected={connected}
            toggle={(enabled) => send({ type: 'extension.setEnabled', extensionId: extension.id, enabled })}
            openPage={() => openSettings(`extension:${extension.id}`)}
          />
        ))}
      </ul>
    </details>
  )
}

type ExtensionLineProps = { extension: ExtensionInfo; connected: boolean; toggle: (enabled: boolean) => void; openPage: () => void }

function ExtensionLine({ extension, connected, toggle, openPage }: ExtensionLineProps) {
  const { name, description, enabled, setup, blocked, loadError } = extension
  const short = firstSentence(description)
  const line = <span className="block truncate text-sm text-muted">{short}</span>
  // Its setup while it's on: what's missing (Set up… opens its page, where Install is), or the install running.
  const status = !enabled || !setup || setup.status === 'ready' ? undefined : setup.status
  return (
    <li className="flex items-center gap-12 py-8 not-first:border-t" aria-label={name}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-baseline gap-x-8">
          <span>{name}</span>
          {status === 'missing' && <span className="text-sm text-amber">Needs setup</span>}
          {status === 'installing' && <span className="text-sm text-muted">Installing…</span>}
          {status === 'checking' && <span className="text-sm text-muted">Checking…</span>}
        </span>
        {/* A narrow window cuts even the first sentence short, so the whole description is always in the tooltip. */}
        {short && <Hint text={description}>{line}</Hint>}
        {blocked && !enabled && <span className="text-sm text-muted wrap-anywhere">{blocked}</span>}
        {loadError && <span className="text-sm text-red wrap-anywhere">Couldn't load: {loadError}</span>}
      </div>
      {status === 'missing' && (
        <Button size="small" onClick={openPage}>
          Set up…
        </Button>
      )}
      <Switch
        label={name}
        size="small"
        checked={enabled}
        disabled={!connected || loadError !== undefined || (!enabled && blocked !== undefined)}
        onChange={toggle}
      />
    </li>
  )
}
