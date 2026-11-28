// Auto-update: the packaged app asks GitHub Releases for a newer Kothar (electron-updater reads latest-mac.yml there),
// downloads it in the background and installs it when Kothar quits, or at once when the user clicks Restart to update.
// main.ts wires this to electron-updater, the window and the app menu; everything here is plain logic over a small
// updater interface, so it's tested with a fake and never touches the network.
//
// Only the packaged, signed app updates: Squirrel.Mac refuses an update not signed like the running app, and an
// unpackaged run (npm run desktop) has no app-update.yml to read. main.ts doesn't start any of this when unpackaged.
import { readFileSync, writeFileSync } from 'node:fs'

/** What the UI shows. Mirrored in packages/ui/src/updates.ts. */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  /** Found, but Update automatically is off: it downloads when the user clicks Download. */
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  /** Downloaded; installs on the next quit, or now with Restart to update. */
  | { status: 'ready'; version: string }

export type UpdateInfo = { current: string; autoDownload: boolean; state: UpdateState }
export type UpdatePrefs = { autoDownload: boolean }
export const DEFAULT_PREFS: UpdatePrefs = { autoDownload: true }

/** The first check waits this long after launch, so it never slows the start. */
export const FIRST_CHECK_MS = 10_000
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/** The part of electron-updater's AppUpdater this uses. */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

/** What the user is told after Check for Updates… in the menu. Automatic checks never ask anything. */
export interface Asker {
  upToDate(current: string): void
  failed(message: string): void
  /** An update is already downloaded: true to restart now. */
  restartNow(version: string): Promise<boolean>
}

type Timers = {
  setTimeout(run: () => void, ms: number): unknown
  setInterval(run: () => void, ms: number): unknown
  clear(timer: unknown): void
}
const realTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  setInterval: (run, ms) => setInterval(run, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

/** The saved preference; a missing or broken file means the default (on). */
export function readPrefs(file: string): UpdatePrefs {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { autoDownload?: unknown }
    return { autoDownload: typeof saved.autoDownload === 'boolean' ? saved.autoDownload : DEFAULT_PREFS.autoDownload }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(file: string, prefs: UpdatePrefs) {
  writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`)
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

type Options = {
  updater: Updater
  /** The running version (app.getVersion()). */
  current: string
  /** Where the preference is saved (in Electron's userData folder). */
  prefsFile: string
  /** Called with every change, to send to the window. */
  publish(info: UpdateInfo): void
  ask: Asker
  log?(line: string): void
  timers?: Timers
}

export function createUpdates({ updater, current, prefsFile, publish, ask, log = console.log, timers = realTimers }: Options) {
  let prefs = readPrefs(prefsFile)
  let state: UpdateState = { status: 'idle' }
  // Set by Check for Updates…, so its result (up to date, or an error) is shown instead of only logged.
  let manual = false
  const pending: unknown[] = []

  updater.autoDownload = prefs.autoDownload
  // A downloaded update installs whenever Kothar quits, even if the user never clicks Restart.
  updater.autoInstallOnAppQuit = true

  const info = (): UpdateInfo => ({ current, autoDownload: prefs.autoDownload, state })
  const set = (next: UpdateState) => {
    state = next
    publish(info())
  }
  const finishManual = () => {
    const was = manual
    manual = false
    return was
  }

  updater.on('checking-for-update', () => {
    if (state.status === 'idle') set({ status: 'checking' })
  })
  updater.on('update-not-available', () => {
    if (state.status === 'checking') set({ status: 'idle' })
    if (finishManual()) ask.upToDate(current)
  })
  updater.on('update-available', ({ version }) => {
    finishManual()
    log(`[updates] Kothar ${version} is available (running ${current})`)
    set(prefs.autoDownload ? { status: 'downloading', version, percent: 0 } : { status: 'available', version })
  })
  updater.on('download-progress', ({ percent }) => {
    if (state.status === 'downloading') set({ ...state, percent: Math.max(0, Math.min(100, Math.round(percent))) })
  })
  updater.on('update-downloaded', ({ version }) => {
    log(`[updates] Kothar ${version} is downloaded; it installs on the next quit`)
    set({ status: 'ready', version })
  })
  // Offline, GitHub down, a release without latest-mac.yml: logged, never a dialog, unless the user asked.
  updater.on('error', (error) => {
    log(`[updates] ${message(error)}`)
    if (state.status === 'checking') set({ status: 'idle' })
    // A failed download goes back to offering it.
    else if (state.status === 'downloading') set({ status: 'available', version: state.version })
    if (finishManual()) ask.failed(message(error))
  })

  // electron-updater both emits 'error' and rejects; the event already handled it.
  const quietly = (run: () => Promise<unknown>) => {
    try {
      run().catch(() => {})
    } catch (error) {
      log(`[updates] ${message(error)}`)
    }
  }

  const check = async (byUser = false) => {
    if (state.status === 'ready') {
      if (byUser && (await ask.restartNow(state.version))) restart()
      return
    }
    // A check already under way answers this one too.
    if (state.status === 'checking') {
      manual ||= byUser
      return
    }
    // A download in progress, or a found update waiting for Download: the banner already says so.
    if (state.status !== 'idle') return
    manual = byUser
    quietly(() => updater.checkForUpdates())
  }

  const download = () => {
    if (state.status !== 'available') return
    set({ status: 'downloading', version: state.version, percent: 0 })
    quietly(() => updater.downloadUpdate())
  }

  const restart = () => {
    if (state.status !== 'ready') return
    log(`[updates] restarting into Kothar ${state.version}`)
    updater.quitAndInstall()
  }

  const setAutoDownload = (on: boolean) => {
    prefs = { autoDownload: on }
    updater.autoDownload = on
    try {
      writePrefs(prefsFile, prefs)
    } catch (error) {
      log(`[updates] couldn't save the preference: ${message(error)}`)
    }
    publish(info())
    // Turned on with an update waiting: fetch it now.
    if (on && state.status === 'available') download()
  }

  return {
    info,
    check,
    download,
    restart,
    setAutoDownload,
    /** Checks FIRST_CHECK_MS after launch, then every CHECK_EVERY_MS. */
    start() {
      pending.push(timers.setTimeout(() => void check(), FIRST_CHECK_MS))
      pending.push(timers.setInterval(() => void check(), CHECK_EVERY_MS))
    },
    stop() {
      pending.splice(0).forEach((timer) => timers.clear(timer))
    },
  }
}

export type Updates = ReturnType<typeof createUpdates>
