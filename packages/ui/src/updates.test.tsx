// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { updateNotice, updateStatus, type UpdateInfo, type UpdatesBridge } from './updates.ts'

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

const info = (state: UpdateInfo['state'], prompt = true, declined?: string): UpdateInfo => ({
  current: '0.1.0',
  state,
  prompt,
  ...(declined && { declined }),
})

test('the notice offers a found update, shows the download, then asks to restart', () => {
  expect(updateNotice(undefined)).toBeNull()
  expect(updateNotice(info({ status: 'idle' }))).toBeNull()
  expect(updateNotice(info({ status: 'available', version: '0.2.0' }))).toEqual({
    text: 'Kothar 0.2.0 is available.',
    version: '0.2.0',
    actions: 'offer',
  })
  expect(updateNotice(info({ status: 'downloading', version: '0.2.0', percent: 40 }))?.text).toBe('Downloading Kothar 0.2.0… 40%')
  expect(updateNotice(info({ status: 'ready', version: '0.2.0' }))).toEqual({
    text: 'Kothar 0.2.0 is ready. Restart to finish.',
    version: '0.2.0',
    actions: 'restart',
  })
  expect(updateNotice(info({ status: 'ready', version: '0.2.0' }), 1)?.warning).toBe('Restarting stops 1 running chat.')
  expect(updateNotice(info({ status: 'ready', version: '0.2.0' }), 3)?.warning).toBe('Restarting stops 3 running chats.')
})

test('no notice when the shell says not to prompt (declined, or already answered)', () => {
  expect(updateNotice(info({ status: 'available', version: '0.2.0' }, false, '0.2.0'))).toBeNull()
  expect(updateNotice(info({ status: 'ready', version: '0.2.0' }, false))).toBeNull()
})

test('the Settings status line', () => {
  expect(updateStatus(info({ status: 'idle' }))).toBe('Not checked yet')
  expect(updateStatus(info({ status: 'idle', checked: true }))).toBe('Up to date')
  expect(updateStatus(info({ status: 'idle', checked: true, error: 'offline' }))).toBe('Couldn’t check: offline')
  expect(updateStatus(info({ status: 'checking' }))).toBe('Checking…')
  expect(updateStatus(info({ status: 'available', version: '0.2.0' }))).toBe('Kothar 0.2.0 is available')
  expect(updateStatus(info({ status: 'downloading', version: '0.2.0', percent: 7 }))).toBe('Downloading… 7%')
  expect(updateStatus(info({ status: 'ready', version: '0.2.0' }))).toBe('Ready, restart to finish')
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
    decline: vi.fn(),
    later: vi.fn(),
    restart: vi.fn(),
  }
  window.kothar = { updates: bridge } as unknown as NonNullable<Window['kothar']>
  return { bridge, push: (info: UpdateInfo) => act(() => push(info)) }
}

const buttonNamed = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined

test('the notice: Update and Not now, a release-notes link, then Restart or Restart later', async () => {
  const { bridge } = fakeBridge(info({ status: 'idle' }, false))
  const { UpdateNotice } = await import('./update-notice.tsx')
  const render = (shown: UpdateInfo, running = 0) => act(() => root.render(<UpdateNotice info={shown} running={running} />))
  render(info({ status: 'available', version: '0.2.0' }))
  expect(container.textContent).toContain('Kothar 0.2.0 is available.')
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://github.com/billwang7599/kothar/releases/tag/v0.2.0')
  act(() => buttonNamed('Not now')!.click())
  expect(bridge.decline).toHaveBeenCalledOnce()
  expect(bridge.download).not.toHaveBeenCalled()
  act(() => buttonNamed('Update')!.click())
  expect(bridge.download).toHaveBeenCalledOnce()
  render(info({ status: 'downloading', version: '0.2.0', percent: 12 }))
  expect(container.textContent).toContain('Downloading Kothar 0.2.0… 12%')
  expect(container.querySelectorAll('button')).toHaveLength(0)
  render(info({ status: 'ready', version: '0.2.0' }), 2)
  expect(container.textContent).toContain('Restarting stops 2 running chats.')
  act(() => buttonNamed('Restart later')!.click())
  expect(bridge.later).toHaveBeenCalledOnce()
  act(() => buttonNamed('Restart')!.click())
  expect(bridge.restart).toHaveBeenCalledOnce()
  render(info({ status: 'available', version: '0.2.0' }, false, '0.2.0'))
  expect(container.textContent).toBe('')
})

test('Settings → General → Updates: version, status, Check now, Update even when declined, Restart', async () => {
  const { bridge, push } = fakeBridge(info({ status: 'idle', checked: true }, false))
  const { UpdatesSection } = await import('./settings/updates.tsx')
  await act(async () =>
    root.render(
      <Tooltip.Provider>
        <UpdatesSection />
      </Tooltip.Provider>,
    ),
  )
  expect(container.textContent).toContain('Kothar 0.1.0')
  expect(container.textContent).toContain('Up to date')
  expect(container.querySelector('[role="switch"]')).toBeNull()
  act(() => buttonNamed('Check now')!.click())
  expect(bridge.check).toHaveBeenCalledOnce()

  push(info({ status: 'available', version: '0.2.0' }, false, '0.2.0'))
  expect(container.textContent).toContain('Kothar 0.2.0 is available')
  act(() => buttonNamed('Update')!.click())
  expect(bridge.download).toHaveBeenCalledOnce()
  push(info({ status: 'downloading', version: '0.2.0', percent: 50 }))
  expect(container.textContent).toContain('Downloading… 50%')
  push(info({ status: 'ready', version: '0.2.0' }, false))
  expect(container.textContent).toContain('Ready, restart to finish')
  act(() => buttonNamed('Restart')!.click())
  expect(bridge.restart).toHaveBeenCalledOnce()
})

test('without the desktop updater there is no Updates section, notice or search entry', async () => {
  const { UpdatesSection } = await import('./settings/updates.tsx')
  const { UpdateNotice } = await import('./update-notice.tsx')
  const { settingsIndex } = await import('./settings/search.ts')
  await act(async () =>
    root.render(
      <>
        <UpdatesSection />
        <UpdateNotice info={info({ status: 'available', version: '0.2.0' })} running={0} />
      </>,
    ),
  )
  expect(container.textContent).toBe('')
  const labels = (index: { label: string }[]) => index.map((e) => e.label)
  expect(labels(settingsIndex({ engines: [], extensions: [] }))).not.toContain('Updates')
  fakeBridge(info({ status: 'idle' }, false))
  expect(labels(settingsIndex({ engines: [], extensions: [] }))).toContain('Updates')
})
