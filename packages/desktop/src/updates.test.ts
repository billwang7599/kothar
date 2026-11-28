import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, createUpdates, FIRST_CHECK_MS, readPrefs, type UpdateInfo, type Updater } from './updates.ts'

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
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on(event: string, listener: (arg?: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return updater
    },
    checkForUpdates: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn(),
  }
  const emit = (event: string, arg?: unknown) => listeners.get(event)?.forEach((listener) => listener(arg))
  return { updater: updater as typeof updater & Updater, emit }
}

function setup(prefs?: object) {
  const prefsFile = tempFile()
  if (prefs) writeFileSync(prefsFile, JSON.stringify(prefs))
  const { updater, emit } = fakeUpdater()
  const published: UpdateInfo[] = []
  const ask = { upToDate: vi.fn(), failed: vi.fn(), restartNow: vi.fn(async () => true) }
  const updates = createUpdates({ updater, current: '0.1.0', prefsFile, publish: (info) => published.push(info), ask, log: () => {} })
  return { updates, updater, emit, published, ask, prefsFile }
}

it('reads the preference, defaulting to on for a missing or broken file', () => {
  const file = tempFile()
  expect(readPrefs(file)).toEqual({ autoDownload: true })
  writeFileSync(file, 'not json')
  expect(readPrefs(file)).toEqual({ autoDownload: true })
  writeFileSync(file, JSON.stringify({ autoDownload: 'no' }))
  expect(readPrefs(file)).toEqual({ autoDownload: true })
  writeFileSync(file, JSON.stringify({ autoDownload: false }))
  expect(readPrefs(file)).toEqual({ autoDownload: false })
})

it('downloads in the background by default and installs on quit', () => {
  const { updates, updater, emit } = setup()
  expect(updater.autoDownload).toBe(true)
  expect(updater.autoInstallOnAppQuit).toBe(true)
  void updates.check()
  expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  emit('checking-for-update')
  expect(updates.info().state).toEqual({ status: 'checking' })
  emit('update-available', { version: '0.2.0' })
  expect(updates.info().state).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
  emit('download-progress', { percent: 41.6 })
  expect(updates.info().state).toEqual({ status: 'downloading', version: '0.2.0', percent: 42 })
  emit('update-downloaded', { version: '0.2.0' })
  expect(updates.info().state).toEqual({ status: 'ready', version: '0.2.0' })
  updates.restart()
  expect(updater.quitAndInstall).toHaveBeenCalledOnce()
})

it('with Update automatically off, only offers the update until Download', () => {
  const { updates, updater, emit } = setup({ autoDownload: false })
  expect(updater.autoDownload).toBe(false)
  void updates.check()
  emit('checking-for-update')
  emit('update-available', { version: '0.2.0' })
  expect(updates.info()).toEqual({ current: '0.1.0', autoDownload: false, state: { status: 'available', version: '0.2.0' } })
  expect(updater.downloadUpdate).not.toHaveBeenCalled()
  updates.download()
  expect(updater.downloadUpdate).toHaveBeenCalledOnce()
  expect(updates.info().state).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
})

it('saves the switch, and turning it on fetches an update that is waiting', () => {
  const { updates, updater, emit, published, prefsFile } = setup({ autoDownload: false })
  void updates.check()
  emit('update-available', { version: '0.2.0' })
  updates.setAutoDownload(true)
  expect(JSON.parse(readFileSync(prefsFile, 'utf8'))).toEqual({ autoDownload: true })
  expect(updater.autoDownload).toBe(true)
  expect(updater.downloadUpdate).toHaveBeenCalledOnce()
  expect(published.at(-1)).toEqual({ current: '0.1.0', autoDownload: true, state: { status: 'downloading', version: '0.2.0', percent: 0 } })
})

it('stays quiet about automatic checks that fail or find nothing', () => {
  const { updates, emit, ask } = setup()
  void updates.check()
  emit('checking-for-update')
  emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
  expect(updates.info().state).toEqual({ status: 'idle' })
  void updates.check()
  emit('checking-for-update')
  emit('update-not-available')
  expect(updates.info().state).toEqual({ status: 'idle' })
  expect(ask.failed).not.toHaveBeenCalled()
  expect(ask.upToDate).not.toHaveBeenCalled()
})

it('answers Check for Updates… with up to date, or the error', () => {
  const { updates, emit, ask } = setup()
  void updates.check(true)
  emit('checking-for-update')
  emit('update-not-available')
  expect(ask.upToDate).toHaveBeenCalledWith('0.1.0')
  void updates.check(true)
  emit('checking-for-update')
  emit('error', new Error('HttpError: 404'))
  expect(ask.failed).toHaveBeenCalledWith('HttpError: 404')
})

it('a menu check during an automatic one gets that check’s answer', () => {
  const { updates, updater, emit, ask } = setup()
  void updates.check()
  emit('checking-for-update')
  void updates.check(true)
  expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  emit('update-not-available')
  expect(ask.upToDate).toHaveBeenCalledOnce()
})

it('a failed download goes back to offering the update', () => {
  const { updates, emit } = setup()
  void updates.check()
  emit('update-available', { version: '0.2.0' })
  emit('error', new Error('sha512 checksum mismatch'))
  expect(updates.info().state).toEqual({ status: 'available', version: '0.2.0' })
})

it('Check for Updates… with an update downloaded offers to restart', async () => {
  const { updates, updater, emit, ask } = setup()
  void updates.check()
  emit('update-available', { version: '0.2.0' })
  emit('update-downloaded', { version: '0.2.0' })
  await updates.check(true)
  expect(ask.restartNow).toHaveBeenCalledWith('0.2.0')
  expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  expect(updater.quitAndInstall).toHaveBeenCalledOnce()
})

it('restart does nothing until an update is downloaded', () => {
  const { updates, updater } = setup()
  updates.restart()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
})

it('checks soon after launch, then every few hours', () => {
  vi.useFakeTimers()
  try {
    const { updates, updater, emit } = setup()
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
