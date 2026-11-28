// Updates, ask-first: the packaged app asks GitHub Releases for a newer Kothar (electron-updater reads latest-mac.yml
// there) and, when there is one, offers it in the window. Nothing downloads or installs until the user clicks Update.
// main.ts wires this to electron-updater, the window and the app menu; everything here is plain logic over a small
// updater interface, so it's tested with a fake and never touches the network.
//
// The notice shows at most once per version. Checks (10 s after launch, then every 4 hours) are silent: one that finds
// a version already offered this session, or one the user turned down with Not now, changes nothing. Only a version
// newer than any offered so far pops up mid-session. A version left undecided is offered once more on the next launch.
// The menu's Check for Updates… always opens the notice, declined or not; Settings → General → Updates always offers it.
//
// Only the packaged, signed app updates: Squirrel.Mac refuses an update not signed like the running app, and an
// unpackaged run (npm run desktop) has no app-update.yml to read. main.ts doesn't start any of this when unpackaged.
import { readFileSync, writeFileSync } from 'node:fs'

/** What the UI shows. Mirrored in packages/ui/src/updates.ts. */
export type UpdateState =
  /** Nothing found. checked: a check has finished this session; error: the last one failed. */
  | { status: 'idle'; checked?: boolean; error?: string }
  | { status: 'checking' }
  /** Found; downloads only when the user clicks Update. */
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  /** Downloaded; installs on the next quit, or now with Restart. */
  | { status: 'ready'; version: string }

export type UpdateInfo = {
  current: string
  state: UpdateState
  /** Whether the in-app notice is up. */
  prompt: boolean
  /** The version the user said Not now to, if any. */
  declined?: string
}
export type UpdatePrefs = { declined?: string }

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
}

/** What the user is told after Check for Updates… in the menu finds nothing. Other checks never ask anything. */
export interface Asker {
  upToDate(current: string): void
  failed(message: string): void
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

/** -1, 0 or 1 comparing dotted versions numerically (1.10.0 > 1.9.0); a pre-release tag sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main = '', pre] = v.replace(/^v/, '').split('-', 2)
    return { parts: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre < y.pre ? -1 : 1
}

/** The saved preferences; a missing or broken file, or keys from older versions (autoDownload), are ignored. */
export function readPrefs(file: string): UpdatePrefs {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { declined?: unknown }
    return typeof saved.declined === 'string' && saved.declined ? { declined: saved.declined } : {}
  } catch {
    return {}
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
  /** Where the preferences are saved (in Electron's userData folder). */
  prefsFile: string
  /** Called with every change, to send to the window. */
  publish(info: UpdateInfo): void
  ask: Asker
  /** Quits the way Kothar always does (stopping engines first) and installs the downloaded update on the way out. */
  restart(): void
  log?(line: string): void
  timers?: Timers
}

export function createUpdates({ updater, current, prefsFile, publish, ask, restart: quitAndInstall, log = console.log, timers = realTimers }: Options) {
  let prefs = readPrefs(prefsFile)
  let state: UpdateState = { status: 'idle' }
  let prompt = false
  // The newest version the notice has offered this session; a check finding it (or an older one) stays silent.
  let offered: string | undefined
  // Set by Check for Updates…, so its result is shown: the notice even for a declined version, up to date, or an error.
  let manual = false
  const pending: unknown[] = []

  // Nothing downloads or installs without the user's Update. Update turns autoInstallOnAppQuit on (see download), so
  // a downloaded update the user hasn't restarted for installs on the next quit.
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false

  const info = (): UpdateInfo => ({ current, state, prompt, ...(prefs.declined && { declined: prefs.declined }) })
  const set = (next: UpdateState, nextPrompt = prompt) => {
    state = next
    prompt = nextPrompt
    publish(info())
  }
  const finishManual = () => {
    const was = manual
    manual = false
    return was
  }
  const newer = (version: string, than: string | undefined) => !than || compareVersions(version, than) > 0

  updater.on('checking-for-update', () => {
    if (state.status === 'idle') set({ status: 'checking' })
  })
  updater.on('update-not-available', () => {
    if (state.status === 'checking') set({ status: 'idle', checked: true })
    if (finishManual()) ask.upToDate(current)
  })
  updater.on('update-available', ({ version }) => {
    const byUser = finishManual()
    // Already downloading or downloaded: the notice (or Settings) already carries it.
    if (state.status === 'downloading' || state.status === 'ready') return
    const same = state.status === 'available' && state.version === version
    // Shown at most once per version: only a version newer than any offered this session and newer than the one
    // turned down pops up. Check for Updates… always shows it.
    const show = byUser || (newer(version, offered) && newer(version, prefs.declined))
    if (show) offered = offered && !newer(version, offered) ? offered : version
    if (same && (!show || prompt)) return
    if (!same) log(`[updates] Kothar ${version} is available (running ${current})`)
    set({ status: 'available', version }, show || (same && prompt))
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
    if (state.status === 'checking') set({ status: 'idle', checked: true, error: message(error) })
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

  /** byUser: Check for Updates… in the menu, which opens the notice for whatever it finds and answers up to date. */
  const check = (byUser = false) => {
    if (state.status === 'downloading' || state.status === 'ready') {
      // Already said yes: bring the notice back.
      if (byUser && !prompt) set(state, true)
      return
    }
    // A check already under way answers this one too.
    if (state.status === 'checking') {
      manual ||= byUser
      return
    }
    manual = byUser
    // An update already found stays offered while a newer one is looked for.
    quietly(() => updater.checkForUpdates())
  }

  /** Update, from the notice or Settings: downloads, then the notice offers to restart. */
  const download = () => {
    if (state.status !== 'available') return
    updater.autoInstallOnAppQuit = true
    set({ status: 'downloading', version: state.version, percent: 0 }, true)
    quietly(() => updater.downloadUpdate())
  }

  /** Not now: hides the notice and never offers this version by itself again. */
  const decline = () => {
    if (state.status !== 'available') return
    prefs = { declined: state.version }
    try {
      writePrefs(prefsFile, prefs)
    } catch (error) {
      log(`[updates] couldn't save the preference: ${message(error)}`)
    }
    set(state, false)
  }

  /** Restart later: hides the notice; the update installs on the next quit. */
  const later = () => {
    if (state.status === 'ready' && prompt) set(state, false)
  }

  const restart = () => {
    if (state.status !== 'ready') return
    log(`[updates] restarting into Kothar ${state.version}`)
    quitAndInstall()
  }

  return {
    info,
    check,
    download,
    decline,
    later,
    restart,
    /** Checks FIRST_CHECK_MS after launch, then every CHECK_EVERY_MS. */
    start() {
      pending.push(timers.setTimeout(() => check(), FIRST_CHECK_MS))
      pending.push(timers.setInterval(() => check(), CHECK_EVERY_MS))
    },
    stop() {
      pending.splice(0).forEach((timer) => timers.clear(timer))
    },
  }
}

export type Updates = ReturnType<typeof createUpdates>
