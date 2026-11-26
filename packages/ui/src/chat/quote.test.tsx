// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Chat } from '../chat.tsx'
import type { ClientMessage } from '@kothar/core/shared'
import type { ChatView, Item } from '../state.ts'
import { placeQuote, quoteBlock, withQuote } from './quote.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('quoteBlock', () => {
  test('puts > before every line and ends with a blank line', () => {
    expect(quoteBlock('one\ntwo')).toBe('> one\n> two\n\n')
  })
  test('keeps blank lines inside as bare >, and drops trailing whitespace and blank ends', () => {
    expect(quoteBlock('\n  \nfirst  \n\nsecond\t\n\n')).toBe('> first\n>\n> second\n\n')
  })
  test('nothing for whitespace only', () => {
    expect(quoteBlock(' \n\t ')).toBe('')
  })
})

describe('withQuote', () => {
  test('an empty box gets just the quote, the caret after it', () => {
    expect(withQuote('', 0, 0, 'hi')).toEqual({ value: '> hi\n\n', caret: 6 })
  })
  test('appended after typed text with a blank line between', () => {
    const { value, caret } = withQuote('my note', 7, 7, 'hi')
    expect(value).toBe('my note\n\n> hi\n\n')
    expect(caret).toBe(value.length)
  })
  test('at the caret, keeping the text after it', () => {
    const { value, caret } = withQuote('before\n\nafter', 8, 8, 'q')
    expect(value).toBe('before\n\n> q\n\nafter')
    expect(value.slice(caret)).toBe('after')
  })
  test('a second quote is its own block', () => {
    const once = withQuote('', 0, 0, 'a').value
    expect(withQuote(once, once.length, once.length, 'b').value).toBe('> a\n\n> b\n\n')
  })
})

describe('placeQuote', () => {
  const size = { width: 80, height: 28 }
  const view = { top: 50, width: 450, height: 800 }
  test('above the first line, centred on it', () => {
    const place = placeQuote({ top: 300, left: 100, width: 100 }, { bottom: 340, left: 100, width: 50 }, size, view)
    expect(place).toEqual({ x: 150, y: 300 - 6 - 28, below: false })
  })
  test('below the last line when there is no room above', () => {
    const place = placeQuote({ top: 60, left: 100, width: 100 }, { bottom: 120, left: 100, width: 40 }, size, view)
    expect(place).toEqual({ x: 120, y: 126, below: true })
  })
  test('kept inside the window at both sides', () => {
    expect(placeQuote({ top: 300, left: 0, width: 4 }, { bottom: 320, left: 0, width: 4 }, size, view).x).toBe(48)
    expect(placeQuote({ top: 300, left: 440, width: 10 }, { bottom: 320, left: 440, width: 10 }, size, view).x).toBe(402)
  })
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
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const ITEMS: Item[] = [
  { kind: 'user', text: 'What does it do?' },
  { kind: 'text', text: 'It reads the file.\n\n```\nline one\nline two\n```' },
]

function render(chat: Partial<ChatView> = {}, send: (m: ClientMessage) => void = () => {}) {
  const view: ChatView = {
    id: 'c1',
    name: 'demo',
    folders: [],
    files: [],
    engine: 'fake',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    items: ITEMS,
    draft: '',
    queue: [],
    ...chat,
  }
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            <Chat
              chat={view}
              chats={[view]}
              engines={[{ id: 'fake', enabled: true, installed: true, signedIn: true }]}
              connected
              send={send}
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
      </LazyMotion>,
    ),
  )
}

const quoteButton = () => document.querySelector<HTMLButtonElement>('[data-quote-selection]')
const box = () => container.querySelector<HTMLTextAreaElement>('textarea')!

/** Selects all of `node`'s text, as a drag or Shift+arrows would, and lets the page hear of it. */
function select(node: Node, start?: number, end?: number) {
  const range = document.createRange()
  if (start === undefined) range.selectNodeContents(node)
  else {
    range.setStart(node, start)
    range.setEnd(node, end ?? start)
  }
  act(() => {
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}
const textNode = (text: string) => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.includes(text)) return node
  throw new Error(`no text ${text}`)
}

test('selecting text in a reply shows Quote; clicking puts it in the box as a blockquote', () => {
  render()
  expect(quoteButton()).toBeNull()
  const node = textNode('It reads the file.')
  select(node, 3, 18)
  expect(quoteButton()?.textContent).toBe('Quote')
  act(() => quoteButton()!.click())
  expect(box().value).toBe('> reads the file.\n\n')
  expect(document.activeElement).toBe(box())
  expect(box().selectionStart).toBe(box().value.length)
  expect(window.getSelection()!.isCollapsed).toBe(true)
  expect(quoteButton()).toBeNull()
})

test('the quote goes after what the user already typed, each quote its own block', () => {
  localStorage.clear()
  render()
  act(() => {
    const input = box()
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'my thoughts')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  select(textNode('What does it do?'))
  act(() => quoteButton()!.click())
  expect(box().value).toBe('my thoughts\n\n> What does it do?\n\n')
  select(textNode('It reads'), 0, 8)
  act(() => quoteButton()!.click())
  expect(box().value).toBe('my thoughts\n\n> What does it do?\n\n> It reads\n\n')
})

test('a multi-line selection quotes every line', () => {
  render()
  select(textNode('line one'))
  act(() => quoteButton()!.click())
  expect(box().value).toBe('> line one\n> line two\n\n')
})

test('quoting while a turn runs just fills the box', () => {
  render({ status: 'running' })
  select(textNode('It reads'), 0, 8)
  act(() => quoteButton()!.click())
  expect(box().value).toBe('> It reads\n\n')
})

test('no Quote for a selection outside the transcript, or a whitespace-only one', () => {
  render()
  const outside = document.body.appendChild(document.createElement('p'))
  outside.textContent = 'Somewhere else'
  select(outside)
  expect(quoteButton()).toBeNull()
  // From the transcript into somewhere else.
  const range = document.createRange()
  range.setStart(textNode('It reads'), 0)
  range.setEnd(outside.firstChild!, 4)
  act(() => {
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(quoteButton()).toBeNull()
  select(textNode('It reads'), 2, 3)
  expect(quoteButton()).toBeNull()
})

test('Escape hides it, and so does the selection collapsing', () => {
  render()
  const node = textNode('It reads')
  select(node, 0, 8)
  expect(quoteButton()).not.toBeNull()
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(quoteButton()).toBeNull()
  // The same selection stays dismissed; a new one shows it again.
  act(() => document.dispatchEvent(new Event('selectionchange')))
  expect(quoteButton()).toBeNull()
  select(node, 0, 6)
  expect(quoteButton()).not.toBeNull()
  select(node, 2, 2)
  expect(quoteButton()).toBeNull()
})

test('the same text selected again with the mouse after Escape shows Quote again', () => {
  vi.useFakeTimers()
  render()
  const node = textNode('It reads')
  select(node, 0, 8)
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(quoteButton()).toBeNull()
  act(() => node.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  select(node, 0, 8)
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.runAllTimers()
  })
  expect(quoteButton()).not.toBeNull()
  vi.useRealTimers()
})

test('pressing the button keeps the selection; dragging a selection waits for the mouse to come up', () => {
  vi.useFakeTimers()
  render()
  select(textNode('It reads'), 0, 8)
  const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  act(() => quoteButton()!.dispatchEvent(press))
  expect(press.defaultPrevented).toBe(true)
  expect(quoteButton()).not.toBeNull()
  act(() => textNode('It reads').parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  select(textNode('It reads'), 0, 5)
  expect(quoteButton()).toBeNull()
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.runAllTimers()
  })
  expect(quoteButton()).not.toBeNull()
  vi.useRealTimers()
})

test('no Quote in an archived chat, where the box takes no text', () => {
  render({ archived: true })
  select(textNode('It reads'), 0, 8)
  expect(quoteButton()).toBeNull()
})
