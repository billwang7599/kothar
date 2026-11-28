// The desktop app's updater, as the window sees it: the banner at the top of the chat pane and the Update automatically
// switch in Settings → General. The updater itself runs in the desktop shell (packages/desktop/src/updates.ts) and
// reaches the window through the preload's window.kothar.updates, which only the packaged app has: in a browser tab or
// an unpackaged desktop run there is no banner and no switch.
import { useSyncExternalStore } from 'react'

// Mirrors UpdateState and UpdateInfo in packages/desktop/src/updates.ts.
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
export type UpdateInfo = { current: string; autoDownload: boolean; state: UpdateState }

export type UpdatesBridge = {
  info(): Promise<UpdateInfo>
  onState(listener: (info: UpdateInfo) => void): () => void
  check(): void
  download(): void
  restart(): void
  setAutoDownload(on: boolean): void
}

/** What the banner says, or null for no banner. A dismissed version stays hidden until a newer one comes, or until it's
 * downloaded (dismissing "available" doesn't hide "ready"). */
export type UpdateBanner = { text: string; action: 'download' | 'restart' | null; key: string }

export function updateBanner(state: UpdateState | undefined, dismissed: ReadonlySet<string>): UpdateBanner | null {
  if (!state) return null
  const banner: UpdateBanner | null =
    state.status === 'available'
      ? { text: `Kothar ${state.version} is available.`, action: 'download', key: `available:${state.version}` }
      : state.status === 'downloading'
        ? { text: `Downloading Kothar ${state.version}… ${state.percent}%`, action: null, key: `downloading:${state.version}` }
        : state.status === 'ready'
          ? { text: `Kothar ${state.version} is ready. Restart to update.`, action: 'restart', key: `ready:${state.version}` }
          : null
  if (!banner || dismissed.has(banner.key)) return null
  // Dismissing the offer also hides its download's progress; the download itself carries on.
  if (state.status === 'downloading' && dismissed.has(`available:${state.version}`)) return null
  return banner
}

/** The Settings row's status line. */
export function updateStatus(info: UpdateInfo): string {
  const { state, current } = info
  switch (state.status) {
    case 'checking':
      return `Kothar ${current}. Checking for updates…`
    case 'available':
      return `Kothar ${current}. Version ${state.version} is available.`
    case 'downloading':
      return `Kothar ${current}. Downloading ${state.version}…`
    case 'ready':
      return `Kothar ${current}. Version ${state.version} installs when you restart.`
    default:
      return `Kothar ${current}`
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
