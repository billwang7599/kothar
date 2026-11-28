// @vitest-environment jsdom
// Settings search, the Advanced parts of each page, and links to the pages that became sections of others.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ClientMessage, EngineInfo, ExtensionInfo, PromptInfo, WorkersSettings, WorkFolder } from '@kothar/core/shared'
import { MOVED_PAGES, pageOf, SettingsDialog, type SettingsPage } from './settings.tsx'
import { searchSettings, settingsIndex } from './settings/search.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
let scrolled: string[]

beforeEach(() => {
  localStorage.clear()
  scrolled = []
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this.id)
  })
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const workFolder: WorkFolder = { defaultPath: '/garage/work', path: '/garage/work', canSandbox: true, terminals: [{ id: 'terminal', name: 'Terminal' }] }
const engine: EngineInfo = { id: 'claude-code', name: 'Claude Code', enabled: true, installed: true, signedIn: true, models: [{ id: 'opus', label: 'Opus' }] }
const workers: WorkersSettings = {
  start: true,
  ownCheckouts: true,
  limit: 4,
  instructions: { id: 'instructions', label: 'When to start workers', where: 'instructions', default: 'Delegate.', text: 'Delegate.' },
}
const combine: PromptInfo = { id: 'combine', label: 'What you can use', where: 'instructions', default: 'Combine.', text: 'Combine.' }
const browser: ExtensionInfo = {
  id: 'browser',
  name: 'Browser',
  description: 'Browse the web.',
  enabled: true,
  settings: [{ key: 'headless', label: 'Hide the browser window', description: 'Runs without a window.', type: 'boolean', default: true }],
  values: { headless: true },
  prompts: [{ id: 'when', label: 'When to browse', where: 'instructions', default: 'Browse.', text: 'Browse.' }],
}
const props = {
  engines: [engine],
  accounts: [{ engine: 'claude-code', accounts: [], active: 'default', apiKeys: true }],
  contextDefaults: { agents: true, folders: true, files: true },
  extensions: [browser],
  modelLists: { chat: [{ engine: 'claude-code', model: 'opus' }], workers: [] },
  workers,
  corePrompts: [combine],
  engineTools: { enabled: true, engines: [] },
  workFolder,
  chooseWorkFolder: () => {},
  openGetStarted: () => {},
  connected: true,
}

const frames = () => act(async () => await new Promise((done) => setTimeout(done, 60)))

function render(page: SettingsPage, openPage: (page: SettingsPage) => void = () => {}, sent: ClientMessage[] = []) {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider>
            <SettingsDialog open page={page} openPage={openPage} close={() => {}} send={(m) => sent.push(m)} {...props} />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement
const tabs = () => [...dialog().querySelectorAll('[role="tab"]')].map((t) => t.textContent)
const activeTab = () => dialog().querySelector('[role="tab"][data-state="active"]')?.textContent
const advanced = () => dialog().querySelector<HTMLDetailsElement>('details[data-advanced]')
const typeSearch = (text: string) => {
  const input = dialog().querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

test('Settings has five pages of its own, then the extensions', () => {
  render('general')
  expect(tabs()).toEqual(['General', 'Engines', 'Agents', 'Permissions', 'Appearance', 'Built-in extensions', 'Community hub', 'Browser'])
})

test('search finds a setting by its name, its explanation or its section, the best match first', () => {
  const index = settingsIndex(props)
  const labels = (q: string) => searchSettings(index, q).map((e) => e.label)
  expect(labels('largest')[0]).toBe('Largest attachment')
  expect(labels('ssh')[0]).toBe('Allowed SSH hosts')
  // Words from its explanation find it too, and every word must match.
  expect(labels('upload limit')).toContain('Largest attachment')
  expect(labels('worktree branch')).toEqual(['Own worktree per worker'])
  expect(labels('Claude')).toEqual(expect.arrayContaining(['Claude Code', 'Claude Code accounts']))
  expect(labels('headless window')).toEqual(['Hide the browser window'])
  expect(labels('no such setting')).toEqual([])
  expect(labels('   ')).toEqual([])
})

test('every setting search finds is on its page, Advanced ones inside Advanced', async () => {
  const index = settingsIndex(props)
  const pages = [...new Set(index.map((e) => e.page))]
  for (const page of pages) {
    render(page as SettingsPage)
    for (const entry of index.filter((e) => e.page === page)) {
      const target = document.getElementById(entry.anchor)
      expect(target, `${entry.label} (#${entry.anchor}) on ${page}`).not.toBeNull()
      expect(!!target!.closest('details[data-advanced]'), `${entry.label} under Advanced`).toBe(!!entry.advanced)
    }
  }
})

test('picking a result opens its page and its Advanced, shows it, and Advanced doesn’t remember that', async () => {
  const openPage = vi.fn()
  render('general', openPage)
  typeSearch('attachment')
  const result = [...dialog().querySelectorAll('ul[aria-label="Matching settings"] button')][0]!
  expect(result.textContent).toContain('Largest attachment')
  expect(result.textContent).toContain('General › Work folder › Advanced')
  expect(advanced()!.open).toBe(false)
  act(() => (result as HTMLButtonElement).click())
  expect(openPage).toHaveBeenCalledWith('general')
  await frames()
  expect(advanced()!.open).toBe(true)
  expect(scrolled.at(-1)).toBe('setting-largest-attachment')
  expect(localStorage.getItem('kothar.settings.advanced.general')).toBeNull()
})

test('Enter goes to the first match, and Esc clears the search before it closes Settings', async () => {
  const openPage = vi.fn()
  render('general', openPage)
  const input = typeSearch('when to start')
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(openPage).toHaveBeenCalledWith('agents')
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(input.value).toBe('')
  expect(dialog()).not.toBeNull()
  expect(tabs()).toContain('General')
  typeSearch('zzz nothing')
  expect(dialog().textContent).toContain('No settings match.')
})

test('Advanced is closed at first and remembers being opened, per page', () => {
  render('general')
  expect(advanced()!.open).toBe(false)
  act(() => {
    advanced()!.open = true
    advanced()!.dispatchEvent(new Event('toggle'))
  })
  expect(localStorage.getItem('kothar.settings.advanced.general')).toBe('true')
  render('permissions')
  expect(advanced()!.open).toBe(false)
  act(() => root.render(<></>))
  render('general')
  expect(advanced()!.open).toBe(true)
})

test('a link to a page that moved lands on its section, opening Advanced if it’s in there', async () => {
  expect(Object.keys(MOVED_PAGES).sort()).toEqual(['accounts', 'context', 'models', 'prompts', 'setups', 'shortcuts', 'work', 'workers'])
  const titles: Record<string, string> = { general: 'General', engines: 'Engines', agents: 'Agents', appearance: 'Appearance' }
  for (const [old, to] of Object.entries(MOVED_PAGES)) {
    scrolled = []
    act(() => root.render(<></>))
    render(old as SettingsPage)
    expect(activeTab(), old).toBe(titles[to.page])
    await frames()
    if ('anchor' in to) {
      expect(scrolled, old).toContain(to.anchor)
      expect(document.getElementById(to.anchor)!.closest('details')?.open ?? true, old).toBe(true)
    }
  }
  // The pages that stayed are left as they are.
  expect(pageOf('engines')).toEqual({ page: 'engines' })
  expect(pageOf('extension:browser')).toEqual({ page: 'extension:browser' })
})

test('a link with an anchor (the Inspector’s Edit) shows that, not the moved page’s section', async () => {
  // kothar:settings/prompts#prompt-kothar-combine, as main.tsx passes it on.
  expect(pageOf('prompts#prompt-kothar-combine')).toEqual({ page: 'agents', anchor: 'prompt-kothar-combine' })
  render('prompts#prompt-kothar-combine')
  await frames()
  expect(activeTab()).toBe('Agents')
  expect(scrolled).toEqual(['prompt-kothar-combine'])
  expect(advanced()!.open).toBe(true)
  // The workers' prompt (the core links it as workers#prompt-workers-instructions), and an extension's prompt, under
  // its page's Advanced.
  for (const [link, anchor] of [
    ['workers#prompt-workers-instructions', 'prompt-workers-instructions'],
    ['extension:browser#prompt-browser-when', 'prompt-browser-when'],
    ['engines#add-acp-agent', 'add-acp-agent'],
    ['accounts#accounts-claude-code', 'accounts-claude-code'],
  ] as const) {
    scrolled = []
    act(() => root.render(<></>))
    render(link)
    await frames()
    expect(scrolled, link).toEqual([anchor])
  }
})
