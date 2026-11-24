// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ClientMessage } from '@kothar/core/shared'
import { ConfirmDialog } from '../controls.tsx'
import type { ChatView, Item } from '../state.ts'
import { ItemView } from './transcript-items.tsx'
import { runningFrom } from './message-menu.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const chatOf = (change: Partial<ChatView> = {}): ChatView => ({
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

function render(item: Item, chat: ChatView, send: (m: ClientMessage) => void) {
  act(() =>
    root.render(
      <MotionConfig reducedMotion="always">
        <LazyMotion features={domAnimation}>
          <Tooltip.Provider>
            <ItemView item={item} chat={chat} connected send={send} />
            <ConfirmDialog />
          </Tooltip.Provider>
        </LazyMotion>
      </MotionConfig>,
    ),
  )
}

const press = (element: Element) =>
  act(() => void element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
const dialog = () => document.querySelector('[role="alertdialog"]')
async function answer(ok: boolean) {
  const [cancel, confirming] = [...dialog()!.querySelectorAll('button')]
  await act(async () => (ok ? confirming : cancel)!.click())
}

test('Delete on a message asks first, says files stay, then deletes it by its log entry', async () => {
  const sent: ClientMessage[] = []
  const item: Item = { kind: 'user', text: 'my key is sk-123', entry: 4 }
  render(item, chatOf({ items: [item] }), (m) => sent.push(m))
  const more = container.querySelector('[aria-label="More for this message"]')!
  // Shown on hover or focus, like Copy.
  expect(more.className).toContain('opacity-0')
  press(more)
  const del = menuItems().find((i) => i.textContent === 'Delete')!
  press(del)
  await act(async () => {})
  expect(dialog()!.textContent).toContain('Delete this message?')
  expect(dialog()!.textContent).toContain('Files the agent changed stay as they are.')
  await answer(false)
  expect(sent).toEqual([])

  press(container.querySelector('[aria-label="More for this message"]')!)
  press(menuItems().find((i) => i.textContent === 'Delete')!)
  await act(async () => {})
  expect(dialog()!.textContent).toContain('Delete this message?')
  await answer(true)
  expect(sent).toEqual([{ type: 'chat.deleteMessage', chatId: 'c1', entry: 4 }])
})

test("a reply's Delete says its tool calls go too", async () => {
  const item: Item = { kind: 'text', text: 'Done', entry: 7 }
  render(item, chatOf({ items: [item] }), () => {})
  press(container.querySelector('[aria-label="More for this reply"]')!)
  press(menuItems().find((i) => i.textContent === 'Delete')!)
  await act(async () => {})
  expect(dialog()!.textContent).toContain('Delete this reply?')
  expect(dialog()!.textContent).toContain('Its tool calls go with it')
})

test('Delete is greyed out for the turn that runs, not for earlier messages', () => {
  const earlier: Item = { kind: 'user', text: 'earlier', entry: 0 }
  const now: Item = { kind: 'user', text: 'now', entry: 3 }
  const steered: Item = { kind: 'user', text: 'also', entry: 5, midTurn: true }
  const chat = chatOf({ status: 'running', items: [earlier, { kind: 'text', text: 'ok', entry: 1 }, now, steered] })
  expect(runningFrom(chat)).toBe(3)
  expect(runningFrom({ ...chat, status: 'idle' })).toBe(Infinity)

  render(now, chat, () => {})
  press(container.querySelector('[aria-label="More for this message"]')!)
  expect(menuItems().find((i) => i.textContent === 'Delete')!.dataset.disabled).toBe('')
  act(() => root.unmount())
  root = createRoot(container)
  render(earlier, chat, () => {})
  press(container.querySelector('[aria-label="More for this message"]')!)
  expect(menuItems().find((i) => i.textContent === 'Delete')!.dataset.disabled).toBeUndefined()
})

test('a message the view cannot place in the log gets no menu', () => {
  render({ kind: 'user', text: 'Not logged yet' }, chatOf(), () => {})
  expect(container.querySelector('[data-message-menu]')).toBeNull()
})

const typeInto = (box: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
const key = (element: Element, k: string, extra: KeyboardEventInit = {}) =>
  act(() => void element.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })))

test('Edit turns the message into a box in place: Esc cancels, Enter sends it again from there', () => {
  const sent: ClientMessage[] = []
  const item: Item = { kind: 'user', text: 'draft one', entry: 2 }
  render(item, chatOf({ items: [item] }), (m) => sent.push(m))
  press(container.querySelector('[aria-label="More for this message"]')!)
  press(menuItems().find((i) => i.textContent === 'Edit')!)
  const box = container.querySelector<HTMLTextAreaElement>('[aria-label="Edit message"]')!
  expect(box.value).toBe('draft one')
  expect(container.querySelector('[data-edit-box]')!.textContent).toContain('Files the agent changed stay as they are.')
  key(box, 'Escape')
  expect(container.querySelector('[aria-label="Edit message"]')).toBeNull()
  expect(container.textContent).toContain('draft one')

  press(container.querySelector('[aria-label="More for this message"]')!)
  press(menuItems().find((i) => i.textContent === 'Edit')!)
  const again = container.querySelector<HTMLTextAreaElement>('[aria-label="Edit message"]')!
  typeInto(again, 'draft two')
  key(again, 'Enter', { shiftKey: true })
  expect(sent).toEqual([])
  key(again, 'Enter')
  expect(sent).toEqual([{ type: 'chat.editMessage', chatId: 'c1', entry: 2, text: 'draft two' }])
  expect(container.querySelector('[aria-label="Edit message"]')).toBeNull()
})

test('Edit and Undo wait for the chat to stop; Undo is only on the last message', () => {
  const first: Item = { kind: 'user', text: 'first', entry: 0 }
  const last: Item = { kind: 'user', text: 'last', entry: 2 }
  const items = [first, { kind: 'text', text: 'ok', entry: 1 } as Item, last]
  const labels = (item: Item, status: ChatView['status']) => {
    act(() => root.unmount())
    root = createRoot(container)
    render(item, chatOf({ items, status }), () => {})
    press(container.querySelector('[aria-label="More for this message"]')!)
    return menuItems().map((i) => `${i.textContent}${i.dataset.disabled === '' ? ' (off)' : ''}`)
  }
  expect(labels(first, 'idle')).toEqual(['Edit', 'Delete'])
  expect(labels(last, 'idle')).toEqual(['Edit', 'Undo', 'Delete'])
  expect(labels(first, 'running')).toEqual(['Edit (off)', 'Delete'])
  expect(labels(last, 'running')).toEqual(['Edit (off)', 'Undo (off)', 'Delete (off)'])
})

test('Undo asks first, says files stay, then asks the core for the message back', async () => {
  const sent: ClientMessage[] = []
  const item: Item = { kind: 'user', text: 'oops', entry: 6 }
  render(item, chatOf({ items: [item] }), (m) => sent.push(m))
  press(container.querySelector('[aria-label="More for this message"]')!)
  press(menuItems().find((i) => i.textContent === 'Undo')!)
  await act(async () => {})
  expect(dialog()!.textContent).toContain('Undo this message?')
  expect(dialog()!.textContent).toContain('Files the agent changed stay as they are.')
  await answer(true)
  expect(sent).toEqual([{ type: 'chat.undoMessage', chatId: 'c1', entry: 6 }])
})
