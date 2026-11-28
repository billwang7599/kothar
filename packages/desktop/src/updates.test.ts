import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, compareVersions, createUpdates, FIRST_CHECK_MS, readPrefs, type UpdateInfo, type Updater } from './updates.ts'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kothar-updates-'))
  dirs.push(dir)
  return join(dir, 'updates.json')
}

// A stand-in for electron-updater: tests emit its events by hand.
function fakeUpdater() {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event: string, listener: (arg?: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return updater
    },
    checkForUpdates: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => {}),
  }
  const emit = (event: string, arg?: unknown) => listeners.get(event)?.forEach((listener) => listener(arg))
  return { updater: updater as typeof updater & Updater, emit }
}

/** One launch of the app, on prefsFile (a fresh one unless given). */
function launch({ prefs, prefsFile = tempFile() }: { prefs?: object; prefsFile?: string } = {}) {
  if (prefs) writeFileSync(prefsFile, JSON.stringify(prefs))
  const { updater, emit } = fakeUpdater()
  const published: UpdateInfo[] = []
  const ask = { upToDate: vi.fn(), failed: vi.fn() }
  const restart = vi.fn()
  const updates = createUpdates({ updater, current: '0.1.0', prefsFile, publish: (info) => published.push(info), ask, restart, log: () => {} })
  /** A check (automatic unless byUser) that finds version, or nothing. */
  const found = (version: string | null, byUser = false) => {
    updates.check(byUser)
    emit('checking-for-update')
    if (version) emit('update-available', { version })
    else emit('update-not-available')
  }
  /** How many times the notice went from hidden to shown. */
  const prompts = () => published.filter((info, i) => info.prompt && !(published[i - 1]?.prompt ?? false)).length
  return { updates, updater, emit, published, ask, restart, prefsFile, found, prompts }
}

it('compares versions numerically', () => {
  expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
  expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
  expect(compareVersions('v0.2.0', '0.2.1')).toBe(-1)
  expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(-1)
})

it('reads the declined version, ignoring a missing or broken file and the old Update automatically key', () => {
  const file = tempFile()
  expect(readPrefs(file)).toEqual({})
  writeFileSync(file, 'not json')
  expect(readPrefs(file)).toEqual({})
  writeFileSync(file, JSON.stringify({ autoDownload: false }))
  expect(readPrefs(file)).toEqual({})
  writeFileSync(file, JSON.stringify({ autoDownload: true, declined: '0.2.0' }))
  expect(readPrefs(file)).toEqual({ declined: '0.2.0' })
})

it('never downloads or installs by itself', () => {
  const { updates, updater, found } = launch({ prefs: { autoDownload: true } })
  expect(updater.autoDownload).toBe(false)
  expect(updater.autoInstallOnAppQuit).toBe(false)
  found('0.2.0')
  expect(updates.info()).toEqual({ current: '0.1.0', prompt: true, state: { status: 'available', version: '0.2.0' } })
  expect(updater.downloadUpdate).not.toHaveBeenCalled()
  expect(updater.autoInstallOnAppQuit).toBe(false)
})

it('Update downloads with progress, then Restart quits through Kothar’s own quit', () => {
  const { updates, updater, emit, found, restart } = launch()
  found('0.2.0')
  updates.restart()
  expect(restart).not.toHaveBeenCalled()
  updates.download()
  expect(updater.downloadUpdate).toHaveBeenCalledOnce()
  // Agreed to: a downloaded update installs on the next quit too.
  expect(updater.autoInstallOnAppQuit).toBe(true)
  expect(updates.info()).toMatchObject({ prompt: true, state: { status: 'downloading', version: '0.2.0', percent: 0 } })
  emit('download-progress', { percent: 41.6 })
  expect(updates.info().state).toEqual({ status: 'downloading', version: '0.2.0', percent: 42 })
  emit('update-downloaded', { version: '0.2.0' })
  expect(updates.info()).toMatchObject({ prompt: true, state: { status: 'ready', version: '0.2.0' } })
  updates.restart()
  expect(restart).toHaveBeenCalledOnce()
})

it('Restart later hides the notice; the menu brings it back', () => {
  const { updates, emit, found } = launch()
  found('0.2.0')
  updates.download()
  emit('update-downloaded', { version: '0.2.0' })
  updates.later()
  expect(updates.info()).toMatchObject({ prompt: false, state: { status: 'ready' } })
  // A later automatic check stays silent.
  updates.check()
  expect(updates.info().prompt).toBe(false)
  updates.check(true)
  expect(updates.info().prompt).toBe(true)
})

it('repeated checks finding the same version never show a second prompt', () => {
  const { updates, updater, found, published, prompts } = launch()
  found('0.2.0')
  expect(prompts()).toBe(1)
  const sent = published.length
  // The notice is left up, undecided: every later check is silent, with no new state sent (no re-animation).
  for (let i = 0; i < 5; i++) found('0.2.0')
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(6)
  expect(prompts()).toBe(1)
  expect(published.length).toBe(sent)
  expect(updates.info()).toMatchObject({ prompt: true, state: { status: 'available', version: '0.2.0' } })
})

it('Not now: never offered again by itself, on later checks or launches, but Settings and the menu still offer it', () => {
  const first = launch()
  first.found('0.2.0')
  first.updates.decline()
  expect(first.updates.info()).toMatchObject({ prompt: false, declined: '0.2.0', state: { status: 'available', version: '0.2.0' } })
  expect(JSON.parse(readFileSync(first.prefsFile, 'utf8'))).toEqual({ declined: '0.2.0' })
  first.found('0.2.0')
  first.found('0.2.0')
  expect(first.prompts()).toBe(1)
  expect(first.updater.downloadUpdate).not.toHaveBeenCalled()

  const second = launch({ prefsFile: first.prefsFile })
  second.found('0.2.0')
  second.found('0.2.0')
  expect(second.prompts()).toBe(0)
  // Settings: the found update is there, with Update.
  expect(second.updates.info()).toMatchObject({ prompt: false, declined: '0.2.0', state: { status: 'available', version: '0.2.0' } })
  // The menu's Check for Updates… opens the notice even for the declined version.
  second.found('0.2.0', true)
  expect(second.updates.info().prompt).toBe(true)
  // Settings' Update works for it too.
  second.updates.download()
  expect(second.updater.downloadUpdate).toHaveBeenCalledOnce()
})

it('a version newer than the declined one prompts again', () => {
  const { updates, found, prompts } = launch({ prefs: { declined: '0.2.0' } })
  found('0.2.0')
  expect(prompts()).toBe(0)
  found('0.3.0')
  expect(prompts()).toBe(1)
  expect(updates.info()).toMatchObject({ prompt: true, state: { status: 'available', version: '0.3.0' } })
})

it('an undecided version is asked about once more on the next launch, and only then', () => {
  const first = launch()
  first.found('0.2.0')
  first.found('0.2.0')
  expect(first.prompts()).toBe(1)
  const second = launch({ prefsFile: first.prefsFile })
  second.found('0.2.0')
  second.found('0.2.0')
  expect(second.prompts()).toBe(1)
})

it('mid-session, only a version newer than any shown pops up', () => {
  const { updates, found, prompts } = launch()
  found('0.2.0')
  found('0.3.0')
  expect(prompts()).toBe(1) // the notice was already up; it now names 0.3.0
  expect(updates.info()).toMatchObject({ prompt: true, state: { version: '0.3.0' } })
  updates.decline()
  found('0.3.0')
  expect(updates.info().prompt).toBe(false)
  found('0.4.0')
  expect(prompts()).toBe(2)
})

it('stays quiet about automatic checks that fail or find nothing, and Settings shows the result', () => {
  const { updates, emit, ask, found } = launch()
  expect(updates.info().state).toEqual({ status: 'idle' })
  updates.check()
  emit('checking-for-update')
  emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
  expect(updates.info().state).toEqual({ status: 'idle', checked: true, error: 'net::ERR_INTERNET_DISCONNECTED' })
  found(null)
  expect(updates.info().state).toEqual({ status: 'idle', checked: true })
  expect(ask.failed).not.toHaveBeenCalled()
  expect(ask.upToDate).not.toHaveBeenCalled()
})

it('answers Check for Updates… with up to date, or the error', () => {
  const { updates, emit, ask, found } = launch()
  found(null, true)
  expect(ask.upToDate).toHaveBeenCalledWith('0.1.0')
  updates.check(true)
  emit('checking-for-update')
  emit('error', new Error('HttpError: 404'))
  expect(ask.failed).toHaveBeenCalledWith('HttpError: 404')
})

it('a menu check during an automatic one gets that check’s answer', () => {
  const { updates, updater, emit, ask } = launch()
  updates.check()
  emit('checking-for-update')
  updates.check(true)
  expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  emit('update-not-available')
  expect(ask.upToDate).toHaveBeenCalledOnce()
})

it('a failed download goes back to offering the update', () => {
  const { updates, emit, found } = launch()
  found('0.2.0')
  updates.download()
  emit('error', new Error('sha512 checksum mismatch'))
  expect(updates.info()).toMatchObject({ prompt: true, state: { status: 'available', version: '0.2.0' } })
})

it('checks soon after launch, then every few hours', () => {
  vi.useFakeTimers()
  try {
    const { updates, updater, emit } = launch()
    updates.start()
    vi.advanceTimersByTime(FIRST_CHECK_MS - 1)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    emit('update-not-available')
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    updates.stop()
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
