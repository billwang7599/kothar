// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { updateBanner, updateStatus, type UpdateInfo, type UpdatesBridge } from './updates.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  vi.resetModules()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.kothar
})

const none = new Set<string>()

test('the banner offers a found update, shows the download, then asks to restart', () => {
  expect(updateBanner(undefined, none)).toBeNull()
  expect(updateBanner({ status: 'idle' }, none)).toBeNull()
  expect(updateBanner({ status: 'checking' }, none)).toBeNull()
  expect(updateBanner({ status: 'available', version: '0.2.0' }, none)).toEqual({
    text: 'Kothar 0.2.0 is available.',
    action: 'download',
    key: 'available:0.2.0',
  })
  expect(updateBanner({ status: 'downloading', version: '0.2.0', percent: 40 }, none)).toEqual({
    text: 'Downloading Kothar 0.2.0… 40%',
    action: null,
    key: 'downloading:0.2.0',
  })
  expect(updateBanner({ status: 'ready', version: '0.2.0' }, none)).toEqual({
    text: 'Kothar 0.2.0 is ready. Restart to update.',
    action: 'restart',
    key: 'ready:0.2.0',
  })
})

test('a dismissed banner stays away for that version and step only', () => {
  const dismissed = new Set(['available:0.2.0'])
  expect(updateBanner({ status: 'available', version: '0.2.0' }, dismissed)).toBeNull()
  // Its download's progress stays hidden too, but the finished download asks again.
  expect(updateBanner({ status: 'downloading', version: '0.2.0', percent: 5 }, dismissed)).toBeNull()
  expect(updateBanner({ status: 'ready', version: '0.2.0' }, dismissed)?.action).toBe('restart')
  // A newer version is news.
  expect(updateBanner({ status: 'available', version: '0.3.0' }, dismissed)?.key).toBe('available:0.3.0')
})

test('the Settings line says which version runs and what is pending', () => {
  const info = (state: UpdateInfo['state']): UpdateInfo => ({ current: '0.1.0', autoDownload: true, state })
  expect(updateStatus(info({ status: 'idle' }))).toBe('Kothar 0.1.0')
  expect(updateStatus(info({ status: 'available', version: '0.2.0' }))).toBe('Kothar 0.1.0. Version 0.2.0 is available.')
  expect(updateStatus(info({ status: 'ready', version: '0.2.0' }))).toBe('Kothar 0.1.0. Version 0.2.0 installs when you restart.')
})

function fakeBridge(first: UpdateInfo) {
  let push: (info: UpdateInfo) => void = () => {}
  const bridge: UpdatesBridge = {
    info: vi.fn(async () => first),
    onState: vi.fn((listener) => {
      push = listener
      return () => {}
    }),
    check: vi.fn(),
    download: vi.fn(),
    restart: vi.fn(),
    setAutoDownload: vi.fn(),
  }
  window.kothar = { updates: bridge } as unknown as NonNullable<Window['kothar']>
  return { bridge, push: (info: UpdateInfo) => act(() => push(info)) }
}

const buttonNamed = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined

test('Settings → General → Updates: the switch, Check now, and Restart once an update is downloaded', async () => {
  const { bridge, push } = fakeBridge({ current: '0.1.0', autoDownload: true, state: { status: 'idle' } })
  const { UpdatesSection } = await import('./settings/updates.tsx')
  await act(async () =>
    root.render(
      <Tooltip.Provider>
        <UpdatesSection />
      </Tooltip.Provider>,
    ),
  )
  expect(container.textContent).toContain('Update automatically')
  expect(container.textContent).toContain('Kothar 0.1.0')
  const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  act(() => toggle.click())
  expect(bridge.setAutoDownload).toHaveBeenCalledWith(false)
  act(() => buttonNamed('Check now')!.click())
  expect(bridge.check).toHaveBeenCalledOnce()

  push({ current: '0.1.0', autoDownload: false, state: { status: 'available', version: '0.2.0' } })
  act(() => buttonNamed('Download')!.click())
  expect(bridge.download).toHaveBeenCalledOnce()
  push({ current: '0.1.0', autoDownload: false, state: { status: 'ready', version: '0.2.0' } })
  act(() => buttonNamed('Restart to update')!.click())
  expect(bridge.restart).toHaveBeenCalledOnce()
})

test('without the desktop updater there is no Updates section and no search entry for it', async () => {
  const { UpdatesSection } = await import('./settings/updates.tsx')
  const { settingsIndex } = await import('./settings/search.ts')
  await act(async () => root.render(<UpdatesSection />))
  expect(container.textContent).toBe('')
  const labels = (index: { label: string }[]) => index.map((e) => e.label)
  expect(labels(settingsIndex({ engines: [], extensions: [] }))).not.toContain('Update automatically')
  fakeBridge({ current: '0.1.0', autoDownload: true, state: { status: 'idle' } })
  expect(labels(settingsIndex({ engines: [], extensions: [] }))).toContain('Update automatically')
})
