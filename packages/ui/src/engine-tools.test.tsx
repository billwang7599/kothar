// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ClientMessage, EngineInfo, EngineToolRow, EngineToolsSettings } from '@kothar/core/shared'
import { SettingsDialog } from './settings.tsx'
import { ENGINE_TOOLS_OFF } from './settings/engine-tools.tsx'
import { engineToolAnchor, revealSetting, searchSettings, settingsIndex } from './settings/search.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const engine = (id: string, enabled = true): EngineInfo => ({ id, enabled, installed: true, signedIn: true })
const tool = (name: string, more: Partial<EngineToolRow> = {}): EngineToolRow => ({
  name,
  group: 'core',
  defaultOn: true,
  on: true,
  ...more,
})
const TOOLS: EngineToolRow[] = [
  tool('Bash', { capability: 'shell' }),
  tool('Agent', { capability: 'subagents', group: 'replaced', defaultOn: false, on: false, replacedBy: 'Workers' }),
  tool('CronCreate', { capability: 'scheduling', group: 'outside', defaultOn: false, on: false }),
  tool('Shiny', { isNew: true }),
]
const settingsOf = (more: Partial<EngineToolsSettings> = {}, tools = TOOLS, enabled = true): EngineToolsSettings => ({
  enabled: true,
  engines: [
    { engine: 'claude-code', name: 'Claude Code', enabled, tools },
    { engine: 'pi', name: 'pi', enabled: true, tools: [tool('bash')] },
  ],
  ...more,
})

function render(engineTools: EngineToolsSettings, engines = [engine('claude-code'), engine('pi', false)]) {
  const sent: ClientMessage[] = []
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider>
            <SettingsDialog
              open
              page="engines"
              openPage={() => {}}
              close={() => {}}
              engines={engines}
              engineTools={engineTools}
              accounts={[]}
              contextDefaults={{ agents: true, folders: true, files: true }}
              extensions={[]}
              modelLists={{ chat: [], planning: [], searching: [], workers: [] }}
              workFolder={{ defaultPath: '/w', canSandbox: true }}
              chooseWorkFolder={() => {}}
              connected
              send={(m) => sent.push(m)}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
  return sent
}

const page = () => document.querySelector('[role="dialog"]')!
const switchOf = (label: string) => page().querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)

test('lists the tools of each engine that is on, with its group, a switch each, and new ones marked', () => {
  render(settingsOf())
  expect(page().querySelector('section[aria-label="Claude Code tools"]')).not.toBeNull()
  expect(page().querySelector('section[aria-label="pi tools"]')).toBeNull()
  const text = page().textContent!
  expect(text).toContain('Replaced by Kothar')
  expect(text).toContain('Outside Kothar')
  expect(text).toContain('Workers instead')
  expect(text).toContain('New')
  expect(switchOf('Bash on')!.getAttribute('aria-checked')).toBe('true')
  expect(switchOf('Agent on')!.getAttribute('aria-checked')).toBe('false')
})

test('switches any tool, a core one too, saving a choice only when it differs from the default', () => {
  const sent = render(settingsOf())
  act(() => switchOf('Bash on')!.click())
  act(() => switchOf('CronCreate on')!.click())
  expect(sent).toEqual([
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'Bash', on: false },
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'CronCreate', on: true },
  ])
  const back = render(settingsOf({}, [tool('Bash', { capability: 'shell', on: false, saved: true })]))
  act(() => switchOf('Bash on')!.click())
  expect(back).toEqual([{ type: 'engineTools.setTool', engine: 'claude-code', tool: 'Bash' }])
})

test('warns when a core kind of work has no tool left, and offers Reset once something was changed', () => {
  const sent = render(settingsOf({}, [tool('Bash', { capability: 'shell', on: false, saved: true }), tool('Read', { capability: 'read' })]))
  expect(page().textContent).toContain("Claude Code can't run commands any more, and Kothar has no tool of its own for that yet.")
  expect(page().textContent).not.toContain("can't read files any more")
  const reset = [...page().querySelectorAll('button')].find((b) => b.textContent === 'Reset to defaults')!
  act(() => reset.click())
  expect(sent).toEqual([{ type: 'engineTools.reset', engine: 'claude-code' }])
  render(settingsOf())
  expect([...page().querySelectorAll('button')].some((b) => b.textContent === 'Reset to defaults')).toBe(false)
})

test("the Engine tools master switch turns every engine's tools off: per-tool switches show off and can't change", () => {
  const sent = render(settingsOf({ enabled: false }))
  expect(page().textContent).toContain(ENGINE_TOOLS_OFF)
  expect(switchOf('Bash on')!.getAttribute('aria-checked')).toBe('false')
  expect(switchOf('Bash on')!.disabled).toBe(true)
  expect(switchOf('All Claude Code tools')!.disabled).toBe(true)
  act(() => switchOf('Engine tools')!.click())
  expect(sent).toEqual([{ type: 'engineTools.setEnabled', enabled: true }])
})

test("an engine's own master switch turns all its tools off, with a warning, keeping the rows greyed out", () => {
  const sent = render(settingsOf({}, TOOLS, false))
  expect(page().textContent).toContain("All off: Claude Code can't run commands, edit or read files itself.")
  expect(switchOf('Bash on')!.disabled).toBe(true)
  expect(page().textContent).not.toContain(ENGINE_TOOLS_OFF)
  act(() => switchOf('All Claude Code tools')!.click())
  expect(sent).toEqual([{ type: 'engineTools.setEnabled', engine: 'claude-code', enabled: true }])
})

const fold = (label: string) => page().querySelector<HTMLDetailsElement>(`details[aria-label="${label}"]`)!
const buttonOf = (label: string) => page().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const frames = () => act(async () => await new Promise((done) => setTimeout(done, 60)))
const MANY: EngineToolRow[] = [
  tool('Bash', { capability: 'shell' }),
  tool('Edit', { capability: 'edit' }),
  tool('Read', { capability: 'read', on: false, saved: true }),
  tool('Agent', { capability: 'subagents', group: 'replaced', defaultOn: false, on: false, replacedBy: 'Workers' }),
  tool('CronCreate', { capability: 'scheduling', group: 'outside', defaultOn: false, on: false }),
]

function typeFilter(text: string) {
  const input = page().querySelector<HTMLInputElement>('input[aria-label="Filter tools"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const show = (label: 'All' | 'On' | 'Off') =>
  act(() => [...page().querySelectorAll<HTMLButtonElement>('[aria-label="Show tools"] button')].find((b) => b.textContent === label)!.click())

test('a folded engine still says how many tools are on and, in amber, how many the user turned off', () => {
  render(settingsOf({}, MANY))
  const engine = fold('Claude Code')
  expect(engine.open).toBe(false)
  const summary = engine.querySelector('summary')!
  expect(summary.textContent).toContain('2 of 5 on')
  expect(summary.querySelector('.text-amber')!.textContent).toBe('1 turned off')
  expect(fold('Claude Code Core').querySelector('summary')!.textContent).toContain('2 of 3 on')
  // Off by default isn't flagged: only what's on by default and was turned off.
  expect(fold('Claude Code Outside Kothar').querySelector('summary .text-amber')).toBeNull()
  render(settingsOf({}, MANY, false))
  expect(fold('Claude Code').querySelector('summary')!.textContent).toContain('0 of 5 onAll off')
})

test('engines fold closed at first and groups open, and both remember being toggled', async () => {
  render(settingsOf({}, MANY))
  expect(fold('Claude Code').open).toBe(false)
  expect(fold('Claude Code Core').open).toBe(true)
  act(() => fold('Claude Code').querySelector('summary')!.click())
  act(() => fold('Claude Code Core').querySelector('summary')!.click())
  await frames()
  expect(localStorage.getItem('kothar.settings.engineTools.claude-code')).toBe('true')
  expect(localStorage.getItem('kothar.settings.engineTools.claude-code.core')).toBe('false')
  act(() => root.unmount())
  root = createRoot(container)
  render(settingsOf({}, MANY))
  expect(fold('Claude Code').open).toBe(true)
  expect(fold('Claude Code Core').open).toBe(false)
})

test("the engine's master switch in its header doesn't fold it", () => {
  const sent = render(settingsOf({}, MANY))
  act(() => switchOf('All Claude Code tools')!.click())
  expect(fold('Claude Code').open).toBe(false)
  expect(sent).toEqual([{ type: 'engineTools.setEnabled', engine: 'claude-code', enabled: false }])
})

test('All on and All off change every tool of the engine that differs, saving only what differs from the default', () => {
  const sent = render(settingsOf({}, MANY))
  act(() => buttonOf('Claude Code: all on')!.click())
  expect(sent).toEqual([
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'Read' },
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'Agent', on: true },
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'CronCreate', on: true },
  ])
  sent.length = 0
  act(() => buttonOf('Claude Code: all off')!.click())
  expect(sent).toEqual([
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'Bash', on: false },
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'Edit', on: false },
  ])
})

test('a group has its own All on and All off, for its tools only', () => {
  const sent = render(settingsOf({}, MANY))
  act(() => buttonOf('Turn on 3 Claude Code Core tools')!.click())
  expect(sent).toEqual([{ type: 'engineTools.setTool', engine: 'claude-code', tool: 'Read' }])
  expect(buttonOf('Turn off 2 Claude Code Outside Kothar tools')).toBeNull()
  expect(buttonOf('Turn off 1 Claude Code Outside Kothar tools')!.disabled).toBe(true)
})

test('with a filter, the bulk buttons say they act on what is shown, and only touch that', () => {
  const sent = render(settingsOf({}, MANY))
  typeFilter('re')
  // Read (by its name and kind) and CronCreate match; the engine and their groups open to show them.
  expect(fold('Claude Code').open).toBe(true)
  expect(switchOf('Read on')).not.toBeNull()
  expect(switchOf('CronCreate on')).not.toBeNull()
  expect(switchOf('Bash on')).toBeNull()
  expect(page().querySelector('details[aria-label="Claude Code Replaced by Kothar"]')).toBeNull()
  const on = [...page().querySelectorAll('button')].find((b) => b.textContent === 'Turn on 2 shown')!
  act(() => on.click())
  expect(sent).toEqual([
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'Read' },
    { type: 'engineTools.setTool', engine: 'claude-code', tool: 'CronCreate', on: true },
  ])
  expect([...page().querySelectorAll('button')].find((b) => b.textContent === 'Turn off 2 shown')!.disabled).toBe(true)
  // Cleared, the engine goes back to folded, as it was.
  typeFilter('')
  expect(fold('Claude Code').open).toBe(false)
  expect([...page().querySelectorAll('button')].some((b) => b.textContent === 'All on')).toBe(true)
})

test('All, On and Off show every tool, just the ones on, or just the ones off', () => {
  render(settingsOf({}, MANY))
  show('Off')
  expect(['Read', 'Agent', 'CronCreate'].every((n) => switchOf(`${n} on`))).toBe(true)
  expect(switchOf('Bash on')).toBeNull()
  expect([...page().querySelectorAll('button')].some((b) => b.textContent === 'Turn on 3 shown')).toBe(true)
  show('On')
  expect(switchOf('Bash on')).not.toBeNull()
  expect(switchOf('Read on')).toBeNull()
  typeFilter('nothing like this')
  expect(page().textContent).toContain('No tools match.')
  show('All')
  typeFilter('')
  expect(switchOf('CronCreate on')).not.toBeNull()
})

test('search finds a single tool, and going to it opens Advanced, its engine and its group without remembering', async () => {
  const settings = settingsOf({}, MANY)
  localStorage.setItem('kothar.settings.engineTools.claude-code.outside', 'false')
  render(settings)
  const index = settingsIndex({ engines: [engine('claude-code'), engine('pi', false)], extensions: [], engineTools: settings })
  const [hit] = searchSettings(index, 'croncreate')
  expect(hit!.anchor).toBe(engineToolAnchor('claude-code', 'CronCreate'))
  expect(hit!.section).toBe('Claude Code tools')
  expect(index.some((e) => e.label === 'bash')).toBe(false)
  // A tool is found by its group's name too.
  expect(searchSettings(index, 'replaced by kothar').map((e) => e.label)).toContain('Agent')
  revealSetting(hit!.anchor)
  await frames()
  expect(fold('Claude Code').open).toBe(true)
  expect(fold('Claude Code Outside Kothar').open).toBe(true)
  expect(localStorage.getItem('kothar.settings.engineTools.claude-code')).toBeNull()
  expect(localStorage.getItem('kothar.settings.engineTools.claude-code.outside')).toBe('false')
})
