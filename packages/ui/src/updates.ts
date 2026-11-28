// The desktop app's updates, as the window sees them: the notice at the top of the chat pane and Settings → General →
// Updates. The updater itself runs in the desktop shell (packages/desktop/src/updates.ts), which decides when the notice
// shows (at most once per version, never for one the user turned down) and reaches the window through the preload's
// window.kothar.updates, which only the packaged app has: in a browser tab or an unpackaged desktop run there is no
// notice and no Updates section. Nothing downloads or installs until the user clicks Update.
import { useSyncExternalStore } from 'react'

// Mirrors UpdateState and UpdateInfo in packages/desktop/src/updates.ts.
export type UpdateState =
  | { status: 'idle'; checked?: boolean; error?: string }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
export type UpdateInfo = { current: string; state: UpdateState; prompt: boolean; declined?: string }

export type UpdatesBridge = {
  info(): Promise<UpdateInfo>
  onState(listener: (info: UpdateInfo) => void): () => void
  check(): void
  /** Update: download, then offer to restart. */
  download(): void
  /** Not now: hide the notice; this version isn't offered by itself again. */
  decline(): void
  /** Restart later: hide the notice; the update installs on the next quit. */
  later(): void
  restart(): void
}

export const releaseNotesUrl = (version: string) => `https://github.com/billwang7599/kothar/releases/tag/v${version}`

const chats = (n: number) => `${n} running ${n === 1 ? 'chat' : 'chats'}`

/** What the notice says and offers, or null for no notice. running: chats not idle, which a restart stops. */
export type UpdateNotice = {
  text: string
  version: string
  actions: 'offer' | 'progress' | 'restart'
  /** Under the text, before Restart: what restarting now does to running chats. */
  warning?: string
}

export function updateNotice(info: UpdateInfo | undefined, running = 0): UpdateNotice | null {
  if (!info?.prompt) return null
  const { state } = info
  switch (state.status) {
    case 'available':
      return { text: `Kothar ${state.version} is available.`, version: state.version, actions: 'offer' }
    case 'downloading':
      return { text: `Downloading Kothar ${state.version}… ${state.percent}%`, version: state.version, actions: 'progress' }
    case 'ready':
      return {
        text: `Kothar ${state.version} is ready. Restart to finish.`,
        version: state.version,
        actions: 'restart',
        ...(running > 0 && { warning: `Restarting stops ${chats(running)}.` }),
      }
    default:
      return null
  }
}

/** The Settings row's status line. */
export function updateStatus(info: UpdateInfo): string {
  const { state } = info
  switch (state.status) {
    case 'checking':
      return 'Checking…'
    case 'available':
      return `Kothar ${state.version} is available`
    case 'downloading':
      return `Downloading… ${state.percent}%`
    case 'ready':
      return 'Ready, restart to finish'
    default:
      if (state.error) return `Couldn’t check: ${state.error}`
      return state.checked ? 'Up to date' : 'Not checked yet'
  }
}

// One store for the window: the bridge's latest info, fetched once and then pushed by the shell.
let latest: UpdateInfo | undefined
let started = false
const listeners = new Set<() => void>()
const bridge = (): UpdatesBridge | undefined => (typeof window === 'undefined' ? undefined : window.kothar?.updates)

function subscribe(listener: () => void) {
  listeners.add(listener)
  const updates = bridge()
  if (updates && !started) {
    started = true
    const take = (info: UpdateInfo) => {
      latest = info
      listeners.forEach((l) => l())
    }
    updates.onState(take)
    void updates.info().then((info) => latest ?? take(info))
  }
  return () => listeners.delete(listener)
}

/** The updater's state, or undefined where there's no updater (a browser tab, an unpackaged run). */
export const useUpdates = () => useSyncExternalStore(subscribe, () => latest, () => undefined)
export const updatesBridge = bridge
