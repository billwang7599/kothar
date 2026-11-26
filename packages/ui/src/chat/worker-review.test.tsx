// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ClientMessage, WorkerBranch } from '@kothar/core/shared'
import type { ChatView, Item } from '../state.ts'
import { ItemView } from './transcript-items.tsx'

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

const branch = (change: Partial<WorkerBranch> = {}): WorkerBranch => ({
  name: 'Fix the bug',
  createdAt: '2026-11-26T00:00:00.000Z',
  state: 'review',
  repos: [{ folder: '/repo', path: '/work/s1/workers/w1/repo', branch: 'kothar-worker/app/w1-fix', base: 'abc', into: 'kothar/app' }],
  changes: [{ folder: '/repo', files: 3, added: 12, removed: 4, uncommitted: 1, commits: 2 }],
  ...change,
})

const chatOf = (workerBranches?: Record<string, WorkerBranch>): ChatView => ({
  id: 's1',
  name: 'App',
  folders: ['/repo'],
  files: [],
  engine: 'fake',
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'idle',
  items: [],
  draft: '',
  queue: [],
  ...(workerBranches && { workerBranches }),
})

const report: Item = { kind: 'report', chatId: 'w1', name: 'Fix the bug', text: 'Fixed it', entry: 3 }

function render(chat: ChatView, send: (m: ClientMessage) => void) {
  act(() =>
    root.render(
      <MotionConfig reducedMotion="always">
        <LazyMotion features={domAnimation}>
          <Tooltip.Provider>
            <ItemView item={report} chat={chat} connected send={send} />
          </Tooltip.Provider>
        </LazyMotion>
      </MotionConfig>,
    ),
  )
}

const bar = () => container.querySelector('[data-worker-review]')
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label)

test("shows a worker's changes under its report and sends Merge, Squash and Keep for its space", () => {
  const sent: ClientMessage[] = []
  render(chatOf({ w1: branch() }), (m) => sent.push(m))
  expect(bar()!.getAttribute('aria-label')).toBe('Changes of worker Fix the bug')
  expect(bar()!.textContent).toContain('3 files changed +12 −4 · 2 commits · 1 uncommitted')
  act(() => button('Squash')!.click())
  expect(sent).toEqual([{ type: 'worker.review', chatId: 's1', workerId: 'w1', action: 'squash' }])
  // Busy until the core answers: no second click.
  expect(button('Squash…')).toBeDefined()
  expect(button('Merge')!.disabled).toBe(true)
})

test('asks before Discard, saying what goes, and a kept branch offers no Keep', () => {
  const sent: ClientMessage[] = []
  render(chatOf({ w1: branch({ state: 'kept' }) }), (m) => sent.push(m))
  expect(button('Keep')).toBeUndefined()
  expect(bar()!.textContent).toContain('kept')
  act(() => button('Discard…')!.click())
  expect(sent).toEqual([])
  expect(bar()!.textContent).toContain('Discard 3 files, 1 uncommitted?')
  act(() => button('Cancel')!.click())
  act(() => button('Discard…')!.click())
  act(() => button('Discard')!.click())
  expect(sent).toEqual([{ type: 'worker.review', chatId: 's1', workerId: 'w1', action: 'discard' }])
})

test('shows nothing once the changes are merged or discarded, or while the worker still runs', () => {
  render(chatOf(), () => {})
  expect(container.querySelector('section[aria-label="Report from worker Fix the bug"]')).not.toBeNull()
  expect(bar()).toBeNull()
  render(chatOf({ w1: branch({ state: 'working' }) }), () => {})
  expect(bar()).toBeNull()
})
