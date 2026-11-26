// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ClientMessage, SpaceGroup } from '@kothar/core/shared'
import { collapseGroup, reloadCollapsed } from './collapsed-groups.ts'
import { nthSpace, spaceOrder, stepSpace } from './nav.ts'
import { ChatNav } from './sidebar.tsx'
import { initialState, reduce, type ChatView } from './state.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
let sent: ClientMessage[]
let selected: string[]

beforeEach(() => {
  localStorage.clear()
  reloadCollapsed()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  sent = []
  selected = []
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

const WORK: SpaceGroup = { id: 'g1', name: 'Work' }
const PLAY: SpaceGroup = { id: 'g2', name: 'Play' }
const GROUPS = [WORK, PLAY]
const A = chat({ id: 'a', name: 'Alpha', order: 0, group: 'g1' })
const B = chat({ id: 'b', name: 'Beta', order: 1, group: 'g1' })
const C = chat({ id: 'c', name: 'Gamma', order: 0 })
const D = chat({ id: 'd', name: 'Delta', order: 0, group: 'g2' })
const WORKER = chat({ id: 'w', name: 'Worker', parentId: 'a', worker: true })

function render(chats: ChatView[], groups: SpaceGroup[] = GROUPS, selectedId = '') {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            <ChatNav
              chats={chats}
              selectedId={selectedId}
              connected
              send={(m) => sent.push(m)}
              select={(id) => selected.push(id)}
              askName={() => {}}
              groups={groups}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

const groupEl = (name: string) => container.querySelector(`[role="group"][aria-label="${name}"]`)
const groupRow = (name: string) => groupEl(name)?.querySelector('button[aria-expanded]') as HTMLButtonElement
const names = (el: Element | null) =>
  [...(el?.querySelectorAll('button[data-chat-id]') ?? [])].map((b) => b.getAttribute('data-chat-id'))
const ungrouped = () => container.querySelector('[role="group"][aria-labelledby="spaces-label"]')
const pinned = () => container.querySelector('[role="group"][aria-labelledby="pinned-label"]')
const rowOf = (id: string) => container.querySelector(`button[data-chat-id="${id}"]`) as HTMLButtonElement
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const items = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]
const menuOf = (label: string) => {
  key(container.querySelector(`[aria-label="More for ${label}"]`)!, 'Enter')
  return items()
}
const pick = (label: string) => act(() => items().find((i) => i.textContent === label)!.click())
const openSub = (label: string) => key(items().find((i) => i.textContent === label)!, 'ArrowRight')
const typeIn = (input: HTMLInputElement, value: string) => {
  act(() => {
    input.value = value
  })
}
const drag = (el: Element, type: string, clientY = 0) =>
  act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))

test('groups list their spaces in the groups’ order, above the ungrouped spaces, one step further in', () => {
  render([C, D, B, WORKER, A])
  expect(names(groupEl('Work'))).toEqual(['a', 'w', 'b'])
  expect(names(groupEl('Play'))).toEqual(['d'])
  expect(names(ungrouped())).toEqual(['c'])
  expect(groupEl('Work')!.compareDocumentPosition(groupEl('Play')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(rowOf('a').className).toContain('pl-22')
  expect(rowOf('w').className).toContain('pl-36')
  expect(rowOf('c').className).toContain('pl-8')
  // A group whose id is gone from groups.json counts as no group.
  render([C, chat({ id: 'x', name: 'Lost', group: 'gone' })])
  expect(names(ungrouped())).toEqual(['x', 'c'])
})

test('New group names a group in place: Enter creates it, Escape cancels', () => {
  render([C])
  act(() => (container.querySelector('[aria-label="New group"]') as HTMLButtonElement).click())
  const input = container.querySelector('input[aria-label="New group name"]') as HTMLInputElement
  expect(document.activeElement).toBe(input)
  typeIn(input, '  Side projects ')
  key(input, 'Enter')
  expect(sent).toEqual([{ type: 'group.create', name: 'Side projects' }])
  expect(container.querySelector('input[aria-label="New group name"]')).toBeNull()

  act(() => (container.querySelector('[aria-label="New group"]') as HTMLButtonElement).click())
  const again = container.querySelector('input[aria-label="New group name"]') as HTMLInputElement
  typeIn(again, 'Nope')
  key(again, 'Escape')
  expect(sent).toHaveLength(1)
  expect(container.querySelector('input[aria-label="New group name"]')).toBeNull()
})

test('a space’s menu moves it into a group, a new one, or out of its group', () => {
  render([A, C], GROUPS)
  expect(menuOf('Gamma').map((i) => i.textContent)).toContain('Move to group')
  openSub('Move to group')
  expect(items().map((i) => i.textContent)).toEqual(expect.arrayContaining(['Work', 'Play', 'New group…']))
  pick('Play')
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'c', pinned: false, index: Number.MAX_SAFE_INTEGER, group: 'g2' })

  // Its own group isn't offered; Remove from group is.
  const alpha = menuOf('Alpha').map((i) => i.textContent)
  expect(alpha).toContain('Remove from group')
  pick('Remove from group')
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'a', pinned: false, index: 0, group: null })
  menuOf('Alpha')
  openSub('Move to group')
  expect(items().map((i) => i.textContent)).not.toContain('Work')

  menuOf('Gamma')
  openSub('Move to group')
  pick('New group…')
  const input = container.querySelector('input[aria-label="New group name"]') as HTMLInputElement
  typeIn(input, 'Fresh')
  act(() => input.blur())
  expect(sent.at(-1)).toEqual({ type: 'group.create', name: 'Fresh', chatId: 'c' })
})

test('a group’s menu renames, moves and deletes it', () => {
  render([A, D])
  expect(menuOf('Work').map((i) => i.textContent)).toEqual(['Rename…', 'Move down', 'Delete group'])
  pick('Rename…')
  const input = container.querySelector('input[aria-label="Group name"]') as HTMLInputElement
  expect(input.value).toBe('Work')
  typeIn(input, 'Jobs')
  key(input, 'Enter')
  expect(sent.at(-1)).toEqual({ type: 'group.rename', groupId: 'g1', name: 'Jobs' })

  expect(menuOf('Play').map((i) => i.textContent)).toEqual(['Rename…', 'Move up', 'Delete group'])
  pick('Move up')
  expect(sent.at(-1)).toEqual({ type: 'group.move', groupId: 'g2', index: 0 })
  key(groupRow('Work'), 'ArrowDown', { altKey: true })
  expect(sent.at(-1)).toEqual({ type: 'group.move', groupId: 'g1', index: 1 })

  // Nothing is lost, so no confirmation.
  menuOf('Play')
  pick('Delete group')
  expect(sent.at(-1)).toEqual({ type: 'group.delete', groupId: 'g2' })
})

// Rows leave through an exit animation, so wait for it to finish.
const settle = () => act(() => new Promise((done) => setTimeout(done, 50)))

test('a group collapses and expands, showing its count while collapsed, and stays so after a reload', async () => {
  render([A, B, C])
  const row = groupRow('Work')
  expect(row.getAttribute('aria-expanded')).toBe('true')
  expect(row.querySelector('[data-count]')).toBeNull()
  act(() => row.click())
  await settle()
  expect(groupRow('Work').getAttribute('aria-expanded')).toBe('false')
  expect(names(groupEl('Work'))).toEqual([])
  expect(groupRow('Work').querySelector('[data-count]')?.textContent).toBe('2')
  expect(JSON.parse(localStorage.getItem('kothar.collapsedGroups')!)).toEqual(['g1'])

  act(() => root.unmount())
  root = createRoot(container)
  reloadCollapsed()
  render([A, B, C])
  expect(groupRow('Work').getAttribute('aria-expanded')).toBe('false')
  act(() => groupRow('Work').click())
  expect(names(groupEl('Work'))).toEqual(['a', 'b'])
})

test('a collapsed group shows a dot when a space inside is running, waiting or unread', () => {
  act(() => collapseGroup('g1', true))
  const dot = () => groupRow('Work').querySelector('[data-group-dot]')
  render([A, B])
  expect(dot()).toBeNull()
  render([{ ...A, status: 'running' }, B])
  expect(dot()?.getAttribute('data-status')).toBe('running')
  // A worker waiting on the user counts, through its space.
  const asking = chat({
    ...WORKER,
    status: 'waiting',
    items: [{ kind: 'permission', id: 'p', tool: 'Bash', input: {}, outcome: 'pending' } as never],
  })
  render([{ ...A, status: 'running' }, B, asking])
  expect(dot()?.getAttribute('data-status')).toBe('waiting')
  render([{ ...A, doneAt: '2026-02-01T00:00:00.000Z' }, B])
  expect(dot()?.className).toContain('bg-text')
  expect(groupRow('Work').querySelector('.font-semibold')).not.toBeNull()
  // Expanded, the spaces show their own state.
  act(() => collapseGroup('g1', false))
  expect(dot()).toBeNull()
})

test('a collapsed group counts the spaces in its top status, from two up', () => {
  act(() => collapseGroup('g1', true))
  const E = chat({ id: 'e', name: 'Epsilon', order: 2, group: 'g1' })
  const counted = () => groupRow('Work').querySelector('[data-group-needing]')?.textContent ?? null
  const label = () => groupRow('Work').querySelector('[role="img"]')?.getAttribute('aria-label') ?? null
  // One waiting: just the dot.
  render([{ ...A, status: 'waiting' }, { ...B, status: 'running' }, E])
  expect(groupRow('Work').querySelector('[data-group-dot]')?.getAttribute('data-status')).toBe('waiting')
  expect(counted()).toBeNull()
  expect(label()).toBeNull()
  // Two waiting (one through its worker), one running: "2 waiting".
  const asking = chat({
    ...WORKER,
    status: 'waiting',
    items: [{ kind: 'permission', id: 'p', tool: 'Bash', input: {}, outcome: 'pending' } as never],
  })
  render([A, { ...B, status: 'waiting' }, { ...E, status: 'running' }, asking])
  expect(counted()).toBe('2')
  expect(label()).toBe('2 waiting')
  expect(groupRow('Work').querySelector('[role="img"]')?.getAttribute('title')).toBe('2 waiting')
  // Nothing busy, three unread: "3 unread".
  const done = { doneAt: '2026-02-01T00:00:00.000Z' }
  render([{ ...A, ...done }, { ...B, ...done }, { ...E, ...done }])
  expect(label()).toBe('3 unread')
  // Unfolded: no dot and no count.
  act(() => collapseGroup('g1', false))
  expect(counted()).toBeNull()
  expect(groupRow('Work').querySelector('[data-group-dot]')).toBeNull()
})

test('pinned spaces show in Pinned, not in their group, and offer no group moves', () => {
  render([{ ...A, pinned: true }, B, C])
  expect(names(pinned())).toEqual(['a'])
  expect(names(groupEl('Work'))).toEqual(['b'])
  const alpha = menuOf('Alpha').map((i) => i.textContent)
  expect(alpha).not.toContain('Move to group')
  expect(alpha).not.toContain('Remove from group')
  // Unpin keeps its group, and sends no place: the core puts it back where it was.
  pick('Unpin')
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'a', pinned: false })
})

test('opening a space in a collapsed group (from search, say) expands the group', () => {
  act(() => collapseGroup('g1', true))
  render([A, B, C], GROUPS, 'c')
  expect(groupRow('Work').getAttribute('aria-expanded')).toBe('false')
  render([A, B, C], GROUPS, 'b')
  expect(groupRow('Work').getAttribute('aria-expanded')).toBe('true')
  expect(names(groupEl('Work'))).toEqual(['a', 'b'])
  // Collapsing the open space's group again sticks.
  act(() => groupRow('Work').click())
  expect(groupRow('Work').getAttribute('aria-expanded')).toBe('false')
})

test('drag and drop moves spaces into and out of groups, and reorders groups', () => {
  render([A, B, C, D])
  // Onto a group's row: into that group, at its end.
  drag(rowOf('c'), 'dragstart')
  drag(groupRow('Work'), 'dragover')
  expect(groupEl('Work')!.firstElementChild!.className).toContain('ring-accent')
  drag(groupRow('Work'), 'drop')
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'c', pinned: false, index: Number.MAX_SAFE_INTEGER, group: 'g1' })
  // Onto a space in another group: next to it, in that group.
  drag(rowOf('a'), 'dragstart')
  drag(rowOf('d'), 'dragover', 0)
  drag(rowOf('d'), 'drop', 0)
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'a', pinned: false, index: 0, group: 'g2' })
  // Within its own group: no group change.
  drag(rowOf('a'), 'dragstart')
  drag(rowOf('b'), 'dragover', 100)
  drag(rowOf('b'), 'drop', 100)
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'a', pinned: false, index: 1 })
  // Onto the Spaces label: out of its group.
  drag(rowOf('b'), 'dragstart')
  const label = container.querySelector('#spaces-label')!
  drag(label, 'dragover')
  drag(label, 'drop')
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'b', pinned: false, index: 0, group: null })
  // A group onto another: before or after it.
  drag(groupRow('Play'), 'dragstart')
  drag(groupRow('Work'), 'dragover', 0)
  expect(groupEl('Work')!.querySelector('[data-drop="before"]')).not.toBeNull()
  drag(groupRow('Work'), 'drop', 0)
  expect(sent.at(-1)).toEqual({ type: 'group.move', groupId: 'g2', index: 0 })
  // Spaces never land on a space's row while a group is dragged.
  const count = sent.length
  drag(groupRow('Play'), 'dragstart')
  drag(rowOf('c'), 'drop')
  expect(sent).toHaveLength(count)
})

test('the keyboard moves a space within its group', () => {
  render([A, B, C])
  key(rowOf('a'), 'ArrowDown', { altKey: true })
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'a', pinned: false, index: 1 })
  const before = sent.length
  key(rowOf('b'), 'ArrowDown', { altKey: true })
  expect(sent).toHaveLength(before)
})

test('space shortcuts step through the sidebar’s order, skipping collapsed groups', () => {
  const chats = [C, D, B, A]
  const nav = { groups: GROUPS, collapsed: new Set<string>() }
  expect(spaceOrder(chats, nav).map((c) => c.id)).toEqual(['a', 'b', 'd', 'c'])
  const folded = { groups: GROUPS, collapsed: new Set(['g1']) }
  expect(spaceOrder(chats, folded).map((c) => c.id)).toEqual(['d', 'c'])
  expect(nthSpace(chats, 1, folded)).toBe('d')
  expect(stepSpace(chats, 'd', 1, folded)).toBe('c')
  // From a space in a collapsed group (opened from search), the steps go on from it.
  expect(stepSpace(chats, 'a', 1, folded)).toBe('d')
})

test('groups come with the snapshot and follow groups.updated', () => {
  const snapshot = reduce(initialState, {
    type: 'snapshot',
    engines: [],
    chats: [],
    accounts: [],
    contextDefaults: { agents: true, folders: true, files: true },
    extensions: [],
    modelLists: initialState.modelLists,
    setups: [],
    groups: GROUPS,
    memory: {},
    workers: {} as never,
    corePrompts: [],
    workFolder: initialState.workFolder,
    themes: [],
    installed: [],
    communityExtensions: false,
    restart: initialState.restart,
  } as never)
  expect(snapshot.groups).toEqual(GROUPS)
  expect(reduce(snapshot, { type: 'groups.updated', groups: [PLAY] }).groups).toEqual([PLAY])
})
