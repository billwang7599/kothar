// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChatInfo, ClientMessage, EngineAccounts, EngineInfo } from '@kothar/core/shared'
import { dismissGetStarted, getStartedDismissed, GetStartedDialog, readiness, setUpDone } from './get-started.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement

beforeEach(() => {
  localStorage.clear()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const engine = (id: string, change: Partial<EngineInfo> = {}): EngineInfo => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  enabled: false,
  installed: false,
  signedIn: false,
  ...change,
})
const missing = engine('alpha', { install: 'npm install -g alpha' })
const signedOut = engine('beta', { installed: true })
const off = engine('gamma', { installed: true, signedIn: true })
const ready = engine('delta', { installed: true, signedIn: true, enabled: true })
const betaAccounts: EngineAccounts = { engine: 'beta', active: 'default', accounts: [] } as unknown as EngineAccounts
const space = { id: 's1', name: 'Space', folders: [], files: [], engine: 'fake', archived: false } as unknown as ChatInfo
const home = { ...space, id: 'main', extension: 'home' } as ChatInfo

type Render = { engines: EngineInfo[]; chats?: ChatInfo[]; accounts?: EngineAccounts[] }

function show({ engines, chats = [], accounts = [betaAccounts] }: Render) {
  const sent: ClientMessage[] = []
  const actions = { close: vi.fn(), openSettings: vi.fn(), newSpace: vi.fn(), openMarketplace: vi.fn() }
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider>
            <GetStartedDialog
              open
              engines={engines}
              accounts={accounts}
              chats={chats}
              connected
              send={(m) => sent.push(m)}
              {...actions}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
  return { sent, ...actions }
}

const line = (name: string) => document.querySelector<HTMLElement>(`li[aria-label="${name}"]`)!
const button = (text: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === text)!
const step = (title: string) => document.querySelector(`li[aria-label^="${title}"]`)!
const click = (b: HTMLElement) => act(() => b.click())

test('shows each engine as not installed, not signed in, turned off or ready, with what to do next', () => {
  const t = show({ engines: [missing, signedOut, off, ready] })
  expect(line('Alpha').textContent).toContain('Not installed')
  expect(line('Alpha').querySelector('code')?.textContent).toBe('npm install -g alpha')
  expect(line('Alpha').querySelector('button[aria-label="Copy the command that installs Alpha"]')).not.toBeNull()
  expect(line('Beta').textContent).toContain('Not signed in')
  expect(line('Gamma').textContent).toContain('Ready, turned off')
  expect(line('Delta').textContent).toContain('Ready')

  // Sign in turns the engine on (Accounts lists only engines that are on) and opens its accounts in Settings.
  click(button('Sign in…', line('Beta')))
  expect(t.sent).toContainEqual({ type: 'engine.setEnabled', engine: 'beta', enabled: true })
  expect(t.openSettings).toHaveBeenCalledWith('accounts', 'accounts-beta')
  click(button('Turn on', line('Gamma')))
  expect(t.sent).toContainEqual({ type: 'engine.setEnabled', engine: 'gamma', enabled: true })
})

test("an engine without accounts or an install command shows what detection said instead", () => {
  show({ engines: [engine('acp-x', { name: 'X', detail: 'x not found' })], accounts: [] })
  expect(line('X').textContent).toContain('x not found')
  expect(line('X').querySelector('code')).toBeNull()
})

test('step 1 turns green only with an engine that is ready, and step 2 with a space', () => {
  show({ engines: [missing, signedOut, off], chats: [home] })
  expect(step('Set up an engine').getAttribute('aria-label')).toBe('Set up an engine')
  expect(step('Make your first space').getAttribute('aria-label')).toBe('Make your first space')
  expect(button('Close')).toBeDefined()

  show({ engines: [missing, ready], chats: [home, space] })
  expect(step('Set up an engine').getAttribute('aria-label')).toBe('Set up an engine, done')
  expect(step('Make your first space').getAttribute('aria-label')).toBe('Make your first space, done')
  expect(button('Done')).toBeDefined()
})

test('Check again asks the core to detect engines and waits for the answer', () => {
  const t = show({ engines: [missing] })
  click(button('Check again'))
  expect(t.sent).toContainEqual({ type: 'engines.detect' })
  expect(button('Checking…').disabled).toBe(true)
  show({ engines: [{ ...missing, installed: true }] })
  expect(button('Check again').disabled).toBe(false)
})

test('opens the New space flow, the Marketplace and Add ACP agent', () => {
  const t = show({ engines: [ready] })
  click(button('New space…'))
  expect(t.newSpace).toHaveBeenCalled()
  click(button('Open the Marketplace…'))
  expect(t.openMarketplace).toHaveBeenCalled()
  click(button('Add an ACP agent…'))
  expect(t.openSettings).toHaveBeenCalledWith('engines', 'add-acp-agent')
  click(button('Close'))
  expect(t.close).toHaveBeenCalled()
})

test('readiness follows the active account, and setup is done with a ready engine and a space', () => {
  const accounts = {
    engine: 'delta',
    active: 'work',
    accounts: [{ id: 'work', name: 'Work', kind: 'login', signedIn: false }],
  } as EngineAccounts
  expect(readiness(ready, accounts)).toBe('signedOut')
  expect(readiness(ready)).toBe('ready')
  expect(setUpDone([ready], [], [home])).toBe(false)
  expect(setUpDone([ready], [], [home, space])).toBe(true)
  expect(setUpDone([off], [], [space])).toBe(false)
})

test('remembers that it was closed', () => {
  expect(getStartedDismissed()).toBe(false)
  dismissGetStarted()
  expect(getStartedDismissed()).toBe(true)
})
