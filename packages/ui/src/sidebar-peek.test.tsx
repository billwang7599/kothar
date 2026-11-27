// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SpaceGroup } from '@kothar/core/shared'
import { collapseGroup, reloadCollapsed } from './collapsed-groups.ts'
import { ChatNav } from './sidebar.tsx'
import type { ChatView } from './state.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
let selected: string[]

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  reloadCollapsed()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  selected = []
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
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

const WORK: SpaceGroup = { id: 'g1', name: 'Work' }
const EMPTY: SpaceGroup = { id: 'g2', name: 'Empty' }
const A = chat({ id: 'a', name: 'Alpha', order: 0, group: 'g1', status: 'running' })
const B = chat({ id: 'b', name: 'Beta', order: 1, group: 'g1', doneAt: '2026-02-01T00:00:00.000Z' })
const C = chat({ id: 'c', name: 'Gamma', order: 0 })
const CHATS = [A, B, C]

function render(chats: ChatView[] = CHATS, selectedId = 'c') {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            <ChatNav
              chats={chats}
              selectedId={selectedId}
              connected
              send={() => {}}
              select={(id) => selected.push(id)}
              askName={() => {}}
              groups={[WORK, EMPTY]}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

const groupRow = (name: string) =>
  container.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"] [data-group-id]`)!
const popup = () => document.querySelector<HTMLElement>('[data-group-peek]')
const pointer = (el: Element, type: 'pointerover' | 'pointerout', relatedTarget: Element | null = null) =>
  act(() => {
    // React's onPointerEnter/Leave come from pointerover/pointerout; Radix ignores touch, so this is a mouse.
    const event = new MouseEvent(type, { bubbles: true, relatedTarget })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    el.dispatchEvent(event)
  })
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const hover = (name: string) => {
  pointer(groupRow(name), 'pointerover')
  wait(250)
}

test('hovering a folded group pops out its spaces; an unfolded group shows none', () => {
  render()
  hover('Work')
  // Unfolded, its spaces are already in the sidebar.
  expect(popup()).toBeNull()

  pointer(groupRow('Work'), 'pointerout')
  wait(250)
  collapseGroup('g1', true)
  render()
  pointer(groupRow('Work'), 'pointerover')
  // A pointer passing over doesn't flash it open.
  wait(50)
  expect(popup()).toBeNull()
  wait(200)
  const peek = popup()!
  expect(peek.getAttribute('aria-label')).toBe('Work: its spaces')
  const rows = [...peek.querySelectorAll('[data-chat-id]')]
  expect(rows.map((r) => r.textContent)).toEqual(['Alpha', 'Beta'])
  // Same as sidebar rows: the status dot and unread in bold.
  expect(rows[0]!.querySelector('[data-status]')!.getAttribute('data-status')).toBe('running')
  expect(rows[1]!.querySelector('[data-unread]')).not.toBeNull()
  expect(rows[0]!.querySelector('[data-unread]')).toBeNull()
})

test('the pointer can move from the group into the popup and pick a space there', () => {
  collapseGroup('g1', true)
  render()
  hover('Work')
  const peek = popup()!
  // Across the gap: leaving the row and entering the popup within the close delay keeps it open.
  pointer(groupRow('Work'), 'pointerout', peek)
  wait(50)
  pointer(peek, 'pointerover')
  wait(500)
  expect(popup()).not.toBeNull()

  act(() => peek.querySelector<HTMLElement>('[data-chat-id="b"]')!.click())
  expect(selected).toEqual(['b'])
  wait(250)
  expect(popup()).toBeNull()
  // Picked from the popup, the group stays folded.
  render(CHATS, 'b')
  expect(groupRow('Work').getAttribute('aria-expanded')).toBe('false')
})

test('leaving the group without entering the popup closes it', () => {
  collapseGroup('g1', true)
  render()
  hover('Work')
  pointer(groupRow('Work'), 'pointerout')
  wait(250)
  expect(popup()).toBeNull()
})

test('Escape closes the popup', () => {
  collapseGroup('g1', true)
  render()
  hover('Work')
  expect(popup()).not.toBeNull()
  act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  wait(250)
  expect(popup()).toBeNull()
})

test('an empty folded group says so', () => {
  collapseGroup('g2', true)
  render()
  hover('Empty')
  expect(popup()!.textContent).toBe('No spaces.')
})

test('no popup while a space is being dragged', () => {
  collapseGroup('g1', true)
  render()
  const gamma = container.querySelector('[data-chat-id="c"]')!
  act(() => void gamma.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true })))
  hover('Work')
  expect(popup()).toBeNull()
  // Nor does it pop up once the drag is over.
  act(() => void gamma.dispatchEvent(new MouseEvent('dragend', { bubbles: true })))
  wait(250)
  expect(popup()).toBeNull()
})
