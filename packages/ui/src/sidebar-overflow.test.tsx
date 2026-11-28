// @vitest-environment jsdom
// The sidebar never scrolls sideways: rows give way inside the sidebar's width instead of pushing past it. jsdom has no
// layout, so these check the classes that make that so; the real widths were checked in a browser at 180 to 420 px.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { reloadCollapsed } from './collapsed-groups.ts'
import { ChatNav, engineMark } from './sidebar.tsx'
import type { ChatView } from './state.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement

beforeEach(() => {
  localStorage.clear()
  reloadCollapsed()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const LONG = 'A space with an extremely long name that should truncate nicely in a narrow sidebar'
const chat = (change: Partial<ChatView>): ChatView => ({
  id: 'c1',
  name: 'demo',
  folders: [],
  files: [],
  engine: 'fake',
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'idle',
  items: [],
  draft: '',
  queue: [],
  ...change,
})

// A space on one engine, a chain of workers under it (one on another engine), and a space on a third engine.
const CHATS = [
  chat({ id: 's', name: LONG, group: 'g1' }),
  chat({ id: 'w1', name: `${LONG} 1`, parentId: 's', worker: true }),
  chat({ id: 'w2', name: `${LONG} 2`, parentId: 'w1', worker: true, engine: 'claude-code' }),
  chat({ id: 'w3', name: `${LONG} 3`, parentId: 'w2', worker: true, engine: 'claude-code' }),
  chat({ id: 'w4', name: `${LONG} 4`, parentId: 'w3', worker: true, engine: 'claude-code' }),
  chat({ id: 'p', name: 'pi space', engine: 'pi' }),
]

function render() {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            <ChatNav
              chats={CHATS}
              selectedId="s"
              connected
              send={() => {}}
              select={() => {}}
              askName={() => {}}
              groups={[{ id: 'g1', name: `${LONG} group` }]}
              launchers={[{ key: 'notes', label: 'A launcher with a long label', open: () => {} }]}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

const row = (id: string) => container.querySelector<HTMLButtonElement>(`button[data-chat-id="${id}"]`)!
const classes = (el: Element | null) => [...(el?.classList ?? [])]

test('the sidebar clips sideways instead of scrolling, and its rows can shrink', () => {
  render()
  const nav = container.querySelector('nav')!
  expect(classes(nav)).toEqual(expect.arrayContaining(['overflow-x-hidden', 'overflow-y-auto', 'min-w-0']))
  for (const button of container.querySelectorAll('nav button[data-chat-id], nav button[data-group-id]')) {
    expect(classes(button)).toContain('min-w-0')
    expect(classes(button.parentElement)).toContain('min-w-0')
  }
})

test('names truncate but keep a few letters, and the engine label takes at most a third of the row', () => {
  render()
  for (const id of ['s', 'w1', 'w2', 'w3', 'w4']) {
    const name = row(id).querySelector('[data-unread], span.truncate')!
    expect(classes(name)).toEqual(expect.arrayContaining(['truncate', 'min-w-[2.5em]']))
  }
  const engine = row('w2').querySelector('[data-engine]')!
  expect(classes(engine)).toEqual(expect.arrayContaining(['truncate', 'min-w-0', 'max-w-[33%]']))
  expect(classes(engine)).not.toContain('shrink-0')
  // Inside a row's button, only the dot, icons and the two-letter engine mark keep their width.
  for (const el of container.querySelectorAll('nav button[data-chat-id] > *')) {
    if (classes(el).includes('shrink-0') && !el.hasAttribute('data-engine-mark')) expect(el.textContent).toBe('')
  }
})

test('a worker says so in its tooltip, not with a badge', () => {
  render()
  expect(row('w1').textContent).toBe(`${LONG} 1`)
  expect(row('w1').title).toContain('(worker)')
  expect(row('s').title).not.toContain('(worker)')
})

test("an engine label shows only where it differs from the parent's, and the tooltip names it", () => {
  render()
  const engineOf = (id: string) => row(id).querySelector('[data-engine]')?.textContent
  expect(engineOf('s')).toBe('fake')
  expect(engineOf('w1')).toBeUndefined()
  expect(engineOf('w2')).toBe('claude-code')
  expect(engineOf('w3')).toBeUndefined()
  expect(engineOf('p')).toBe('pi')
  expect(row('w2').title).toContain('claude-code')
})

test('in a narrow sidebar the engine label gives way to a two-letter mark, so names keep the room', () => {
  render()
  // The sidebar's list is the container the label and mark ask about.
  expect(classes(container.querySelector('nav'))).toContain('@container')
  const label = row('w2').querySelector('[data-engine]')!
  const mark = row('w2').querySelector('[data-engine-mark]')!
  expect(classes(label)).toEqual(expect.arrayContaining(['hidden', '@min-[216px]:inline']))
  expect(classes(mark)).toEqual(expect.arrayContaining(['@min-[216px]:hidden', 'font-mono', 'text-faint']))
  expect(mark.textContent).toBe('CC')
  // Screen readers get the name from the label and tooltip; the mark is only a visual cue.
  expect(mark.getAttribute('aria-hidden')).toBe('true')
  // It sits at the row's end, away from the round status dot at its start.
  expect(row('w2').firstElementChild?.hasAttribute('data-status')).toBe(true)
  expect(classes(mark)).not.toContain('rounded-full')
  expect(row('w1').querySelector('[data-engine-mark]')).toBeNull()
  expect(row('p').querySelector('[data-engine-mark]')?.textContent).toBe('PI')
})

test('engine marks: known engines by their usual letters, others by initials', () => {
  expect(['claude-code', 'codex', 'opencode', 'pi'].map(engineMark)).toEqual(['CC', 'CX', 'OC', 'PI'])
  expect(engineMark('fake')).toBe('FA')
  expect(engineMark('gemini-cli')).toBe('GC')
  expect(engineMark('acp:goose')).toBe('AG')
  expect(engineMark('x')).toBe('X')
})

test('every row names its engine in the tooltip, and workers end with "(worker)"', () => {
  render()
  expect(row('w1').title).toMatch(/ · fake \(worker\)$/)
  expect(row('w2').title).toMatch(/ · claude-code \(worker\)$/)
  expect(row('s').title).toMatch(/ · fake$/)
})

test('deep workers stop indenting after three levels', () => {
  render()
  const indent = (id: string) => classes(row(id)).find((c) => /^pl-\d+$/.test(c))
  // Inside a group: one step further in, then capped.
  expect(indent('w2')).toBe(indent('w3'))
  expect(indent('w3')).toBe(indent('w4'))
})

test('launcher labels truncate too', () => {
  render()
  const launcher = [...container.querySelectorAll('nav button')].find((b) => b.textContent === 'A launcher with a long label')!
  expect(classes(launcher.querySelector('span:last-child'))).toContain('truncate')
})

test('while labels show, every row keeps the same room for the fold and the ⋯, so engine labels end at one edge', () => {
  render()
  // A space with a fold and a ⋯, a worker with a fold only, a worker with neither, a space with a ⋯ only.
  for (const id of ['s', 'w1', 'w4', 'p']) {
    const fold = row(id).nextElementSibling!
    expect(classes(fold)).toContain('@min-[216px]:min-w-[33px]')
    const menu = fold.nextElementSibling!
    if (menu.hasAttribute('data-row-action')) expect(menu.querySelector('button[aria-label^="More for"]')).not.toBeNull()
    else expect(classes(menu)).toEqual(expect.arrayContaining(['hidden', '@min-[216px]:block', 'w-[26px]']))
  }
  // The ⋯'s own place is 24 px plus a 2 px margin: the spacer matches it.
  expect(classes(row('p').nextElementSibling!.nextElementSibling)).toEqual(expect.arrayContaining(['mr-2']))
})
