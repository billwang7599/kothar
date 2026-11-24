// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { reloadCollapsed } from './collapsed-groups.ts'
import { ChatNav } from './sidebar.tsx'
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

const SPACE = chat({ id: 's', name: 'Space', group: 'g1' })
// Another engine, so rows show their engine label too.
const WORKER = chat({ id: 'w', name: 'Worker', parentId: 's', worker: true, engine: 'other' })

function render() {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            <ChatNav
              chats={[SPACE, WORKER]}
              selectedId=""
              connected
              send={() => {}}
              select={() => {}}
              askName={() => {}}
              groups={[{ id: 'g1', name: 'Work' }]}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

// A class that takes an element out of the layout, or puts it back, on hover, focus or an open menu: any of these
// would make the row's other parts move when the pointer comes in.
const DISPLAY = /(^|:)(hidden|block|flex|inline|inline-block|inline-flex|contents)$/
const shiftingClasses = (row: Element) =>
  [row, ...row.querySelectorAll('*')].flatMap((el) =>
    [...el.classList].filter((c) => c.includes(':') && DISPLAY.test(c) && /hover|focus|state=open/.test(c)),
  )

test('a space row with workers keeps its ⋯ laid out, so the workers chevron never moves on hover', () => {
  render()
  const row = container.querySelector('button[data-chat-id="s"]')!.parentElement!
  const fold = row.querySelector('[aria-label="Hide workers"]')!
  const more = row.querySelector('[data-row-action]')!
  expect(more.contains(row.querySelector('[aria-label="More for Space"]'))).toBe(true)
  // Laid out while the row isn't hovered: hidden by opacity only, and not clickable.
  expect(more.classList).not.toContain('hidden')
  expect(more.classList).toContain('opacity-0')
  expect(more.classList).toContain('pointer-events-none')
  // Still shown for the keyboard and while its menu is open.
  expect(more.classList).toContain('group-focus-within/row:opacity-100')
  expect(more.classList).toContain('has-data-[state=open]:opacity-100')
  // The ⋯ comes after the chevron, and nothing in the row changes its layout on hover.
  expect(fold.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(shiftingClasses(row)).toEqual([])
})

test('the engine label stays put on hover, and so does a group row’s ⋯', () => {
  render()
  const row = container.querySelector('button[data-chat-id="w"]')!.parentElement!
  expect(row.textContent).toContain('other')
  expect(shiftingClasses(row)).toEqual([])
  const group = container.querySelector('button[data-group-id="g1"]')!.parentElement!
  expect(group.querySelector('[data-row-action]')!.classList).not.toContain('hidden')
  expect(shiftingClasses(group)).toEqual([])
  // The New group button on the Spaces label too.
  expect(shiftingClasses(container.querySelector('#spaces-label')!.parentElement!)).toEqual([])
})
