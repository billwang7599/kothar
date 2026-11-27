// @vitest-environment jsdom
import { act, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { lastChat, visit } from './recent-chats.ts'
import { acceleratorOf, actionFor, bindings, conflictsOf, formatBinding, matches, refusal, reloadShortcuts, useShortcuts } from './shortcuts.ts'
import type { ChatView } from './state.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

const HOME = chat({ id: 'main', name: 'Home', extension: 'home' })
const A = chat({ id: 'a' })
const B = chat({ id: 'b' })
const SUB = chat({ id: 's', parentId: 'a', worker: true })
const OLD = chat({ id: 'old', archived: true })

beforeEach(() => {
  localStorage.clear()
  reloadShortcuts()
})

describe('the recent chats', () => {
  test('a visit moves the chat to the front, once', () => {
    let recent: string[] = []
    for (const id of ['a', 'b', 'a', 'main', 'main', '']) recent = visit(recent, id)
    expect(recent).toEqual(['main', 'a', 'b'])
  })

  test('only the last 20 are kept', () => {
    let recent: string[] = []
    for (let i = 0; i < 30; i++) recent = visit(recent, `c${i}`)
    expect(recent).toHaveLength(20)
    expect(recent[0]).toBe('c29')
  })

  test('going back picks the newest other chat: spaces, Home and subagents alike', () => {
    const chats = [HOME, A, B, SUB]
    expect(lastChat(['b', 'main'], chats, 'b')).toBe('main')
    expect(lastChat(['s', 'a'], chats, 's')).toBe('a')
    expect(lastChat(['a', 's'], chats, 'a')).toBe('s')
    expect(lastChat(['a'], chats, 'a')).toBeUndefined()
    expect(lastChat([], chats, '')).toBeUndefined()
  })

  test('skips chats deleted or archived since, and subagents of an archived space', () => {
    const archivedA = { ...A, archived: true }
    expect(lastChat(['b', 'gone', 'old', 'main'], [HOME, B, OLD], 'b')).toBe('main')
    expect(lastChat(['b', 's', 'main'], [HOME, archivedA, B, SUB], 'b')).toBe('main')
    expect(lastChat(['b', 's', 'main'], [HOME, B, SUB], 'b')).toBe('main')
  })
})

describe('the Last chat key', () => {
  test('is Ctrl+Tab, the real Control key, on the menu and clashing with nothing', () => {
    expect(bindings().lastChat).toBe('Ctrl+Tab')
    expect(conflictsOf('lastChat', 'Ctrl+Tab')).toEqual([])
    expect(acceleratorOf('Ctrl+Tab')).toBe('Ctrl+Tab')
    expect([formatBinding('Ctrl+Tab', true), formatBinding('Ctrl+Tab', false)]).toEqual(['⌃⇥', 'Ctrl+Tab'])
  })

  const ctrlTab = { key: 'Tab', code: 'Tab', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }
  test('Control+Tab matches on macOS and elsewhere; ⌘Tab and Ctrl+Shift+Tab never do', () => {
    expect(matches(ctrlTab, 'Ctrl+Tab', true)).toBe(true)
    expect(matches(ctrlTab, 'Ctrl+Tab', false)).toBe(true)
    expect(matches({ ...ctrlTab, ctrlKey: false, metaKey: true }, 'Ctrl+Tab', true)).toBe(false)
    expect(matches({ ...ctrlTab, shiftKey: true }, 'Ctrl+Tab', true)).toBe(false)
    expect(actionFor(ctrlTab, { lastChat: () => {} }, bindings(), true)).toBe('lastChat')
    expect(actionFor(ctrlTab, { lastChat: () => {} }, bindings(), false)).toBe('lastChat')
  })

  test('⌘Tab stays the Mac app switcher; Ctrl+Tab can be recorded on every platform', () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')!
    const as = (p: string) => Object.defineProperty(navigator, 'platform', { value: p, configurable: true })
    try {
      as('MacIntel')
      expect(refusal('Mod+Tab')).toMatch(/system/)
      expect(refusal('Ctrl+Tab')).toBeUndefined()
      as('Win32')
      // A Ctrl+Tab press records as Mod+Tab off macOS.
      expect(refusal('Mod+Tab')).toBeUndefined()
      expect(refusal('Mod+Q')).toMatch(/system/)
    } finally {
      delete (navigator as { platform?: string }).platform
      Object.defineProperty(Navigator.prototype, 'platform', platform)
    }
  })
})

describe('in the window', () => {
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

  // The same wiring as main.tsx: a visit on every selection, and the key going back.
  function Window({ chats, opened }: { chats: ChatView[]; opened: string[] }) {
    const [selectedId, select] = useState('a')
    const recent = useRef<string[]>([])
    useEffect(() => {
      recent.current = visit(recent.current, selectedId)
      opened.push(selectedId)
    }, [selectedId, opened])
    useShortcuts({ lastChat: () => select((id) => lastChat(recent.current, chats, id) ?? id) })
    return (
      <>
        <textarea aria-label="composer" />
        <div contentEditable aria-label="notes" />
        {chats.map((c) => (
          <button key={c.id} onClick={() => select(c.id)}>
            {c.id}
          </button>
        ))}
      </>
    )
  }

  const pressFrom = (target: Element) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => void target.dispatchEvent(event))
    return event
  }

  test('Ctrl+Tab goes back, and again flips back, from the composer or an editor, keeping focus there', () => {
    const opened: string[] = []
    act(() => root.render(<Window chats={[HOME, A, B, SUB]} opened={opened} />))
    const open = (id: string) => act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === id)!.click())
    open('b')
    open('s')
    const composer = container.querySelector('textarea')!
    composer.focus()
    const event = pressFrom(composer)
    // Taken from the field, so the browser never moves focus.
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(composer)
    pressFrom(composer)
    pressFrom(container.querySelector('[contenteditable]')!)
    expect(opened).toEqual(['a', 'b', 's', 'b', 's', 'b'])
  })

  test('a plain Tab is left alone', () => {
    const opened: string[] = []
    act(() => root.render(<Window chats={[A, B]} opened={opened} />))
    const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true })
    act(() => void container.querySelector('textarea')!.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
    expect(opened).toEqual(['a'])
  })
})
