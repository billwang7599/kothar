// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ChatInfo, ClientMessage } from '@kothar/core/shared'
import { bySpaceOrder } from '@kothar/core/shared'
import { ChatNav } from './sidebar.tsx'
import { initialState, reduce, type ChatView, type State } from './state.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
let sent: ClientMessage[]

beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  sent = []
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

const HOME = chat({ id: 'main', name: 'Home', extension: 'home', createdAt: '2025-01-01T00:00:00.000Z' })
const A = chat({ id: 'a', name: 'Alpha', order: 0 })
const B = chat({ id: 'b', name: 'Beta', order: 1 })
const C = chat({ id: 'c', name: 'Gamma', order: 2 })
const WORKER = chat({ id: 'w', name: 'Worker', parentId: 'a', worker: true })

function render(chats: ChatView[], connected = true) {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            <ChatNav
              chats={chats}
              selectedId=""
              connected={connected}
              send={(m) => sent.push(m)}
              select={() => {}}
              askName={() => {}}
            />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

const group = (label: string) => container.querySelector(`[role="group"][aria-labelledby="${label}-label"]`)
const names = (el: Element | null) => [...(el?.querySelectorAll('button[title]') ?? [])].map((b) => b.textContent)
const rowOf = (name: string) =>
  [...container.querySelectorAll('button[title]')].find((b) => b.textContent?.startsWith(name)) as HTMLButtonElement
const fire = (el: Element, type: string, clientY = 0) =>
  act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))
const key = (el: Element, k: string, altKey = true) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey, bubbles: true, cancelable: true })))
const menuItems = (name: string) => {
  key(container.querySelector(`[aria-label="More for ${name}"]`)!, 'Enter', false)
  return [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]
}

test('spaces follow their saved order, pinned ones in their own group on top, workers under their space', () => {
  render([C, HOME, { ...B, pinned: true, order: 0 }, WORKER, A, chat({ id: 'n', name: 'New' })])
  expect(container.querySelector('#pinned-label')?.textContent).toBe('Pinned')
  expect(names(group('pinned'))).toEqual(['Beta'])
  expect(names(group('spaces'))).toEqual(['New', 'Alpha', 'Workerworker', 'Gamma'])
  expect(rowOf('Home').compareDocumentPosition(group('pinned')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('with nothing pinned there is no Pinned group', () => {
  render([A, B])
  expect(container.querySelector('#pinned-label')).toBeNull()
  expect(group('pinned')).toBeNull()
})

test('dragging a space onto another moves it there, with a drop line while over it', () => {
  render([A, B, C, WORKER])
  expect(rowOf('Alpha').draggable).toBe(true)
  expect(rowOf('Worker').draggable).toBe(false)
  expect(rowOf('Home')).toBeUndefined()

  fire(rowOf('Gamma'), 'dragstart')
  fire(rowOf('Alpha'), 'dragover', -1)
  expect(container.querySelector('[data-drop="before"]')).not.toBeNull()
  expect(rowOf('Gamma').closest('.opacity-50')).not.toBeNull()
  fire(rowOf('Alpha'), 'drop', -1)
  expect(sent).toEqual([{ type: 'chat.move', chatId: 'c', pinned: false, index: 0 }])
  expect(container.querySelector('[data-drop]')).toBeNull()

  // After a space with workers, the line sits below its last worker, and it lands after the space.
  fire(rowOf('Gamma'), 'dragstart')
  fire(rowOf('Alpha'), 'dragover', 10)
  const line = container.querySelector('[data-drop="after"]')!
  expect(rowOf('Worker').parentElement!.contains(line)).toBe(true)
  fire(rowOf('Worker'), 'drop', 10)
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'c', pinned: false, index: 1 })
})

test('dropping a space into the pinned group pins it; a worker row can’t be dragged', () => {
  render([{ ...A, pinned: true }, B, C, chat({ id: 'w2', name: 'Helper', parentId: 'b', worker: true })])
  fire(rowOf('Gamma'), 'dragstart')
  fire(rowOf('Alpha'), 'dragover', 10)
  fire(rowOf('Alpha'), 'drop', 10)
  expect(sent).toEqual([{ type: 'chat.move', chatId: 'c', pinned: true, index: 1 }])

  sent = []
  fire(rowOf('Helper'), 'dragstart')
  fire(rowOf('Gamma'), 'dragover', 10)
  fire(rowOf('Gamma'), 'drop', 10)
  expect(sent).toEqual([])
  expect(container.querySelector('[data-drop]')).toBeNull()
})

test('Alt+Arrow keys move a focused space within its group', () => {
  render([A, B, C])
  key(rowOf('Beta'), 'ArrowUp')
  key(rowOf('Beta'), 'ArrowDown')
  key(rowOf('Alpha'), 'ArrowUp')
  key(rowOf('Gamma'), 'ArrowDown')
  key(rowOf('Beta'), 'ArrowDown', false)
  expect(sent).toEqual([
    { type: 'chat.move', chatId: 'b', pinned: false, index: 0 },
    { type: 'chat.move', chatId: 'b', pinned: false, index: 2 },
  ])
})

test('the row menu pins, unpins and moves a space, offering only the moves it can make', () => {
  render([{ ...A, pinned: true }, B, C])
  const beta = menuItems('Beta')
  expect(beta.map((i) => i.textContent)).toEqual(['Rename…', 'Pin', 'Move to group', 'Move down', 'Archive', 'Delete…'])
  act(() => beta.find((i) => i.textContent === 'Pin')!.click())
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'b', pinned: true, index: 1 })

  const gamma = menuItems('Gamma')
  expect(gamma.map((i) => i.textContent)).toContain('Move up')
  expect(gamma.map((i) => i.textContent)).not.toContain('Move down')
  act(() => gamma.find((i) => i.textContent === 'Move up')!.click())
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'c', pinned: false, index: 0 })

  const alpha = menuItems('Alpha')
  act(() => alpha.find((i) => i.textContent === 'Unpin')!.click())
  expect(sent.at(-1)).toEqual({ type: 'chat.move', chatId: 'a', pinned: false, index: 0 })
})

test('archived spaces and a disconnected sidebar can’t be reordered', () => {
  render([A, { ...B, archived: true }], false)
  expect(rowOf('Alpha').draggable).toBe(false)
  key(rowOf('Alpha'), 'ArrowDown')
  expect(sent).toEqual([])
})

// What the core does with a chat.move (chat-lifecycle.ts moveChat): renumber the group the space joins, with pinned
// cleared by leaving it out, and send each changed chat's whole info as JSON, which drops the cleared field.
const coreMove = (chats: ChatInfo[], m: Extract<ClientMessage, { type: 'chat.move' }>): ChatInfo[] => {
  const moved = chats.find((c) => c.id === m.chatId)!
  const group = chats
    .filter((c) => !c.extension && !c.parentId && !!c.pinned === m.pinned && c.id !== m.chatId)
    .sort(bySpaceOrder)
  group.splice(Math.max(0, Math.min(m.index, group.length)), 0, moved)
  return group.flatMap((info, order) => {
    if (info.order === order && !!info.pinned === m.pinned) return []
    const { pinned, ...rest } = info
    return [JSON.parse(JSON.stringify({ ...rest, order, ...(m.pinned && { pinned: true }) })) as ChatInfo]
  })
}
const infoOf = ({ status, items, entries, from, shift, draft, queue, waits, run, ...info }: ChatView): ChatInfo => info

test('Unpin takes a space out of Pinned and back into the spaces list, and pinning it again works, after reload too', async () => {
  const start = [HOME, { ...A, pinned: true, order: 0 }, { ...B, pinned: true, order: 1 }, C].map((c) => ({
    ...infoOf(c),
    status: 'idle' as const,
    entries: [],
    draft: '',
    queue: [],
  }))
  let state: State = reduce(initialState, {
    type: 'snapshot',
    engines: [],
    accounts: [],
    chats: start,
    contextDefaults: { agents: true, folders: true, files: true },
    extensions: [],
    modelLists: { chat: [], planning: [], searching: [], workers: [] },
    setups: [],
    memory: {},
    workers: { start: true, limit: 4, instructions: { id: 'i', label: 'i', where: 'instructions', default: '', text: '' } },
    corePrompts: [],
    workFolder: { defaultPath: '/g/work', canSandbox: true },
    themes: [],
    installed: [],
    communityExtensions: false,
    restart: { changes: [], canRestart: false },
  })
  // A row leaving a group plays its (zero-length) exit animation before it goes.
  const settle = () => act(() => new Promise((done) => setTimeout(done, 30)))
  const click = async (name: string, label: string) => {
    render(state.chats)
    sent = []
    key(container.querySelector(`[aria-label="More for ${name}"]`)!, 'Enter', false)
    // Earlier tests' menus can linger in the page; this one is the newest.
    const menu = [...document.querySelectorAll('[role="menu"]')].at(-1)!
    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === label)!
    act(() => item.click())
    const move = sent.at(-1) as Extract<ClientMessage, { type: 'chat.move' }>
    for (const info of coreMove(state.chats.map(infoOf), move)) state = reduce(state, { type: 'chat.updated', chat: info })
    render(state.chats)
    await settle()
  }

  await click('Beta', 'Unpin')
  expect(names(group('pinned'))).toEqual(['Alpha'])
  expect(names(group('spaces'))).toEqual(['Beta', 'Gamma'])
  expect(state.chats.find((c) => c.id === 'b')?.pinned).toBeUndefined()

  await click('Alpha', 'Unpin')
  expect(group('pinned')).toBeNull()
  expect(names(group('spaces'))).toEqual(['Alpha', 'Beta', 'Gamma'])

  await click('Gamma', 'Pin')
  expect(names(group('pinned'))).toEqual(['Gamma'])
  await click('Gamma', 'Unpin')
  expect(group('pinned')).toBeNull()
  await click('Beta', 'Pin')
  expect(names(group('pinned'))).toEqual(['Beta'])
  expect(names(group('spaces'))).toEqual(['Gamma', 'Alpha'])

  // A reload gets the same places from the core's saved infos.
  render(state.chats.map((c) => ({ ...c, ...(JSON.parse(JSON.stringify(infoOf(c))) as ChatInfo) })))
  expect(names(group('pinned'))).toEqual(['Beta'])
  expect(names(group('spaces'))).toEqual(['Gamma', 'Alpha'])
})
