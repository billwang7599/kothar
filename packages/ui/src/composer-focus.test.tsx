// @vitest-environment jsdom
// After a chat switch the cursor goes in the new chat's message box: the shortcuts and a sidebar click, as main.tsx
// wires them (select() asks wantComposerFocus), and the cases where focus stays where it is.
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Chat } from './chat.tsx'
import { wantComposerFocus } from './composer-focus.ts'
import { saveDraft } from './drafts.ts'
import { stepSpace } from './nav.ts'
import { lastChat, visit } from './recent-chats.ts'
import { useShortcuts } from './shortcuts.ts'
import { ChatNav } from './sidebar.tsx'
import type { ChatView } from './state.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const space = (id: string, change: Partial<ChatView> = {}): ChatView => ({
  id,
  name: id,
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

let root: Root
let container: HTMLElement
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollTo = vi.fn()
  localStorage.clear()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
})

/** The sidebar and the open chat, with select() and the shortcuts as main.tsx has them. */
function App({ chats, first }: { chats: ChatView[]; first: string }) {
  const [selectedId, setSelectedId] = useState(first)
  const recent = useRef<string[]>([first])
  const select = (chatId: string) => {
    recent.current = visit(recent.current, chatId)
    setSelectedId(chatId)
    wantComposerFocus(chatId)
  }
  const goTo = (chatId: string | undefined) => chatId && select(chatId)
  useShortcuts({
    previousSpace: () => goTo(stepSpace(chats, selectedId, -1)),
    nextSpace: () => goTo(stepSpace(chats, selectedId, 1)),
    lastChat: () => goTo(lastChat(recent.current, chats, selectedId)),
  })
  const chat = chats.find((c) => c.id === selectedId)!
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig transition={{ duration: 0 }}>
        <Tooltip.Provider delayDuration={0}>
          <ChatNav chats={chats} selectedId={selectedId} connected send={() => {}} select={select} askName={() => {}} />
          <input aria-label="Elsewhere" />
          <Chat
            key={chat.id}
            chat={chat}
            chats={chats}
            select={select}
            engines={[{ id: 'fake', enabled: true, installed: true, signedIn: true }]}
            connected
            send={() => {}}
            openSettings={() => {}}
            sidebarOpen
            toggleSidebar={() => {}}
            contextOpen={false}
            contextOverlay={false}
            toggleContext={() => {}}
            contextDefaults={{ agents: true, folders: true, files: true }}
            columnPx={720}
            setColumnPx={() => {}}
            notify={() => {}}
            workFolder={{ defaultPath: '/work', canSandbox: true }}
          />
        </Tooltip.Provider>
      </MotionConfig>
    </LazyMotion>
  )
}

const CHATS = [space('alpha'), space('beta'), space('gamma')]
const render = (chats = CHATS, first = 'alpha') => act(() => root.render(<App chats={chats} first={first} />))
const box = () => container.querySelector<HTMLTextAreaElement>('[data-composer] textarea')
const key = (init: KeyboardEventInit) => act(() => void dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
const mac = navigator.platform.startsWith('Mac')
const frames = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))
const row = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.trim() === name)!

test('Next space puts the cursor in the new chat, at the end of its draft', async () => {
  saveDraft('beta', 'half a thought')
  render()
  expect(document.activeElement).toBe(document.body)
  key({ key: 'ArrowDown', code: 'ArrowDown', ...(mac ? { metaKey: true } : { ctrlKey: true }) })
  await frames()
  const node = box()!
  expect(node.value).toBe('half a thought')
  expect(document.activeElement).toBe(node)
  expect(node.selectionStart).toBe('half a thought'.length)
})

test('Ctrl+Tab back to the last chat focuses its box, from inside the old box too', async () => {
  saveDraft('alpha', 'from alpha')
  render()
  act(() => row('beta').click())
  await frames()
  expect(document.activeElement).toBe(box())
  key({ key: 'Tab', code: 'Tab', ctrlKey: true })
  await frames()
  expect(box()!.value).toBe('from alpha')
  expect(document.activeElement).toBe(box())
})

test('a sidebar click puts the cursor in the chat it opens', async () => {
  render()
  act(() => row('gamma').click())
  await frames()
  expect(document.activeElement).toBe(box())
})

test('the first render takes no focus: only a switch does', async () => {
  render()
  await frames()
  expect(document.activeElement).toBe(document.body)
})

test('a field elsewhere the user is typing in keeps focus', async () => {
  render()
  const elsewhere = container.querySelector<HTMLInputElement>('[aria-label="Elsewhere"]')!
  act(() => elsewhere.focus())
  key({ key: 'ArrowDown', code: 'ArrowDown', ...(mac ? { metaKey: true } : { ctrlKey: true }) })
  await frames()
  expect(document.activeElement).toBe(elsewhere)
})

test('an open dialog keeps focus', async () => {
  render()
  const dialog = document.body.appendChild(document.createElement('div'))
  dialog.setAttribute('role', 'dialog')
  dialog.dataset.state = 'open'
  act(() => row('beta').click())
  await frames()
  expect(document.activeElement).not.toBe(box())
  dialog.remove()
  await frames()
  expect(document.activeElement).not.toBe(box())
})

test('a dialog closing (as ⌘O does after a pick) is waited for, then the box takes focus', async () => {
  render()
  const dialog = document.body.appendChild(document.createElement('div'))
  dialog.setAttribute('role', 'dialog')
  dialog.dataset.state = 'closed'
  act(() => row('beta').click())
  await frames()
  expect(document.activeElement).not.toBe(box())
  dialog.remove()
  await frames()
  expect(document.activeElement).toBe(box())
})

test("a subagent's view-only chat has no box, and nothing else is focused", async () => {
  render([space('alpha'), space('sub', { parentId: 'alpha', worker: true })], 'sub')
  act(() => wantComposerFocus('sub'))
  await frames()
  expect(box()).toBeNull()
  expect(document.activeElement).toBe(document.body)
})

test('touch screens take no focus, so the keyboard stays down', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('coarse'), addEventListener() {}, removeEventListener() {} }))
  render()
  act(() => row('beta').click())
  await frames()
  expect(document.activeElement).not.toBe(box())
})
