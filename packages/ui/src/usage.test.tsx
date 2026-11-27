// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { UsageTotals } from '@kothar/core/shared'
import type { ChatView } from './state.ts'
import { formatCost, formatTokens, UsageTotal, usageFor, usageLabel } from './usage.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const totals = (fields: Partial<UsageTotals>): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  turns: 1,
  calls: 0,
  unpriced: 0,
  ...fields,
})
const chat = (id: string, fields: Partial<ChatView> = {}) => ({ id, name: id, ...fields }) as ChatView

describe('formatting', () => {
  test('tokens and dollars as people read them', () => {
    expect([950, 12_400, 3_100_000].map(formatTokens)).toEqual(['950', '12k', '3.1M'])
    expect(formatTokens(1_234)).toBe('1.2k')
    expect([0, 0.00423, 0.371, 12.8].map(formatCost)).toEqual(['$0', '$0.0042', '$0.37', '$12.80'])
    expect(usageLabel(totals({ costUsd: 0.5, inputTokens: 10 }))).toBe('$0.50')
    expect(usageLabel(totals({ inputTokens: 1500, outputTokens: 500 }))).toBe('2k tokens')
  })
})

describe('usageFor', () => {
  test('adds a space’s workers in, running and removed, and gives any other chat its own', () => {
    const chats = [
      chat('space', { usage: totals({ costUsd: 1 }), workersUsage: totals({ costUsd: 0.25 }) }),
      chat('w1', { parentId: 'space', usage: totals({ costUsd: 0.5 }) }),
      chat('other', { usage: totals({ costUsd: 9 }) }),
    ]
    const space = usageFor(chats, chats[0]!)!
    expect(space.total.costUsd).toBe(1.75)
    expect(space.own?.costUsd).toBe(1)
    expect(space.workers?.costUsd).toBe(0.75)
    expect(usageFor(chats, chats[1]!)).toEqual({ total: totals({ costUsd: 0.5 }), own: totals({ costUsd: 0.5 }) })
    expect(usageFor([chat('quiet')], chat('quiet'))).toBeUndefined()
  })
})

describe('UsageTotal', () => {
  let root: Root
  let host: HTMLElement
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const show = (usage: Parameters<typeof UsageTotal>[0]['usage']) =>
    act(() =>
      root.render(
        <Tooltip.Provider delayDuration={0}>
          <UsageTotal usage={usage} />
        </Tooltip.Provider>,
      ),
    )

  test('shows a quiet total, with the breakdown on focus, and nothing while nothing is reported', () => {
    show(undefined)
    expect(host.textContent).toBe('')
    const own = totals({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 50_000, costUsd: 0.42, turns: 3 })
    const workers = totals({ inputTokens: 100, costUsd: 0.08, turns: 2, unpriced: 1 })
    const total = totals({ inputTokens: 1300, outputTokens: 300, cacheReadTokens: 50_000, costUsd: 0.5, turns: 5, unpriced: 1 })
    show({ total, own, workers })
    const chip = host.querySelector('[aria-label="Usage: $0.50"]') as HTMLElement
    expect(chip.textContent).toBe('$0.50')
    // Hints open on keyboard focus (controls.tsx), so a key goes first.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      chip.focus()
    })
    const tip = document.body.textContent ?? ''
    expect(tip).toContain('Usage engines reported')
    expect(tip).toContain('This chat$0.42')
    expect(tip).toContain('Workers$0.08')
    expect(tip).toContain('Cache reads50k tokens')
    expect(tip).toContain('5 turns')
    expect(tip).toContain('1 without a cost')
  })
})
