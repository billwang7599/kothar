// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ChatEntry } from '@kothar/core/shared'
import { ItemView } from './chat/transcript-items.tsx'
import { initialState, reduce, type ChatView, type Item } from './state.ts'
import { kotharToolName, rawArguments, toolLabel } from './tool-labels.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('kotharToolName', () => {
  test.each([
    ['mcp__kothar__spawn_worker', 'spawn_worker'],
    ['kothar_send_message', 'send_message'],
    ['kothar/search_notes', 'search_notes'],
    ['kothar.start_process', 'start_process'],
  ])('reads %s, as each engine names it', (name, bare) => {
    expect(kotharToolName(name)).toBe(bare)
  })

  test.each(['Bash', 'Read', 'mcp__github__create_issue', 'mcp__kotharx__spawn_worker', 'spawn_worker'])(
    'leaves %s alone',
    (name) => expect(kotharToolName(name)).toBeUndefined(),
  )
})

describe('toolLabel', () => {
  const names: Record<string, string> = { w1: 'Fix the login bug' }
  const chatName = (id: string) => names[id] ?? id

  test('fills labels in from the arguments', () => {
    expect(toolLabel('mcp__kothar__spawn_worker', { task: 'Fix the\n  login bug' })).toEqual({
      label: 'Started worker',
      detail: 'Fix the login bug',
    })
    expect(toolLabel('mcp__kothar__send_message', { chatId: 'w1', text: 'Rebase onto #470' }, chatName)).toEqual({
      label: 'Sent message to Fix the login bug',
      detail: 'Rebase onto #470',
    })
    expect(toolLabel('mcp__kothar__send_message', { chatId: 'gone', text: 'hi' }, chatName)?.label).toBe('Sent message to gone')
    expect(toolLabel('mcp__kothar__search_notes', { query: 'market' })).toEqual({ label: 'Searched notes', detail: '"market"' })
    expect(toolLabel('mcp__kothar__browser_open', { url: 'https://kothar.sh' })).toEqual({ label: 'Opened', detail: 'https://kothar.sh' })
    expect(toolLabel('mcp__kothar__start_process', { command: 'npm run dev', name: 'web' })).toEqual({
      label: 'Started process web',
      detail: 'npm run dev',
    })
    expect(toolLabel('mcp__kothar__start_process', { command: 'npm run dev' })?.label).toBe('Started process')
    expect(toolLabel('mcp__kothar__review_worker', { workerId: 'w1', action: 'squash' }, chatName)?.label).toBe(
      'Squashed worker Fix the login bug',
    )
  })

  test('survives missing or odd arguments', () => {
    expect(toolLabel('mcp__kothar__spawn_worker', undefined)).toEqual({ label: 'Started worker' })
    expect(toolLabel('mcp__kothar__spawn_worker', ['x'])).toEqual({ label: 'Started worker' })
    expect(toolLabel('mcp__kothar__list_chats', {})).toEqual({ label: 'Listed chats' })
  })

  test('leaves engine tools, other servers and unlabelled Kothar tools to the plain row', () => {
    expect(toolLabel('Bash', { command: 'ls' })).toBeUndefined()
    expect(toolLabel('mcp__github__create_issue', { title: 'x' })).toBeUndefined()
    expect(toolLabel('mcp__kothar__some_new_tool', {})).toBeUndefined()
  })

  test('rawArguments keeps every argument, falling back to the summary', () => {
    expect(rawArguments({ task: 'a', checkout: 'own' }, 'ignored')).toBe('{\n  "task": "a",\n  "checkout": "own"\n}')
    expect(rawArguments(undefined, 'ls -la')).toBe('ls -la')
  })
})

test("a tool row keeps the call's arguments from the log", () => {
  const at = '2026-01-01T00:00:00.000Z'
  const entries: ChatEntry[] = [
    { at, type: 'tool.started', toolId: 't1', name: 'mcp__kothar__spawn_worker', kind: 'mcp', summary: '{"task":"x"}', input: { task: 'x' } },
    { at, type: 'tool.completed', toolId: 't1', output: '{"chatId":"w1"}', isError: false },
  ]
  const state = reduce(initialState, {
    type: 'snapshot',
    chats: [
      { id: 'c1', name: 'demo', folders: [], files: [], engine: 'fake', archived: false, createdAt: at, status: 'idle', entries, draft: '', queue: [] },
    ],
  } as never)
  const item = state.chats.find((c) => c.id === 'c1')?.items.find((i) => i.kind === 'tool')
  expect(item).toMatchObject({ name: 'mcp__kothar__spawn_worker', input: { task: 'x' }, output: '{"chatId":"w1"}' })
})

describe('the tool row', () => {
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

  const chat = { id: 'c1', name: 'demo', items: [] } as unknown as ChatView
  const render = (item: Item) =>
    act(() =>
      root.render(
        <LazyMotion features={domAnimation}>
          <MotionConfig reducedMotion="always">
            <Tooltip.Provider>
              <ItemView item={item} chat={chat} connected send={() => {}} chatName={(id) => (id === 'w1' ? 'Fix login' : id)} />
            </Tooltip.Provider>
          </MotionConfig>
        </LazyMotion>,
      ),
    )
  const open = () => act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())

  test('a Kothar tool shows its label, its real name, and when open its full arguments and output', () => {
    render({
      kind: 'tool',
      toolId: 't1',
      name: 'mcp__kothar__send_message',
      summary: '{"chatId":"w1","text":"Rebase please"}',
      input: { chatId: 'w1', text: 'Rebase please' },
      state: 'done',
      output: '{"delivered":"steered"}',
    })
    const row = container.querySelector('button[aria-expanded]')!
    expect(row.textContent).toContain('Sent message to Fix login')
    expect(row.textContent).toContain('Rebase please')
    expect(container.querySelector('[data-testid="tool-real-name"]')?.textContent).toBe('mcp__kothar__send_message')
    if (row.getAttribute('aria-expanded') !== 'true') open()
    expect(container.querySelector('[data-testid="tool-arguments"]')?.textContent).toBe(
      '{\n  "chatId": "w1",\n  "text": "Rebase please"\n}',
    )
    expect(container.textContent).toContain('{"delivered":"steered"}')
  })

  test('any other tool keeps the plain row', () => {
    render({ kind: 'tool', toolId: 't1', name: 'Bash', summary: 'ls -la', input: { command: 'ls -la' }, state: 'done', output: 'a' })
    const row = container.querySelector('button[aria-expanded]')!
    expect(row.textContent).toContain('Bash')
    expect(row.textContent).toContain('ls -la')
    expect(container.querySelector('[data-testid="tool-real-name"]')).toBeNull()
    expect(container.querySelector('[data-testid="tool-arguments"]')).toBeNull()
  })
})
