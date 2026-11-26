// Usage in the chat's header: a quiet total of what its engines reported (tokens, and cost where the engine says it),
// for a space with its workers' added in, and the breakdown on hover.
import type { UsageTotals } from '@kothar/core/shared'
import { Hint } from './controls.tsx'
import type { ChatView } from './state.ts'

const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'turns', 'calls', 'unpriced'] as const

export const sumUsage = (all: readonly (UsageTotals | undefined)[]): UsageTotals | undefined => {
  const present = all.filter((totals): totals is UsageTotals => totals !== undefined)
  if (!present.length) return undefined
  const sum = Object.fromEntries(FIELDS.map((field) => [field, 0])) as UsageTotals
  for (const totals of present) for (const field of FIELDS) sum[field] += totals[field] ?? 0
  return sum
}

/** A token count as people read it: 950, 12.4k, 3.1M. */
export function formatTokens(tokens: number) {
  if (tokens < 1000) return String(Math.round(tokens))
  const [value, unit] = tokens < 1_000_000 ? [tokens / 1000, 'k'] : [tokens / 1_000_000, 'M']
  return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)}${unit}`
}

/** Dollars, to the cent from 10 cents on, and to two significant figures below: $0.0042, $0.37, $12.80. */
export function formatCost(usd: number) {
  if (usd <= 0) return '$0'
  if (usd >= 0.1) return `$${usd.toFixed(2)}`
  return `$${Number(usd.toPrecision(2))}`
}

export const tokensIn = (u: UsageTotals) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens

// The chip's text: the cost when engines reported one, else the tokens.
export function usageLabel(u: UsageTotals) {
  if (u.costUsd > 0) return formatCost(u.costUsd)
  return `${formatTokens(tokensIn(u))} tokens`
}

/** What the header shows for a chat: a space with every chat below it, any other chat (a worker, Home) its own. */
export function usageFor(chats: readonly ChatView[], chat: ChatView) {
  const own = chat.usage
  if (chat.parentId !== undefined || chat.extension) {
    const total = sumUsage([own, chat.workersUsage])
    return total && { total, own }
  }
  const below = new Map<string, ChatView[]>()
  for (const c of chats) if (c.parentId !== undefined) below.set(c.parentId, [...(below.get(c.parentId) ?? []), c])
  const workers: ChatView[] = []
  const walk = (id: string) => {
    for (const child of below.get(id) ?? []) {
      workers.push(child)
      walk(child.id)
    }
  }
  walk(chat.id)
  const fromWorkers = sumUsage([chat.workersUsage, ...workers.flatMap((w) => [w.usage, w.workersUsage])])
  const total = sumUsage([own, fromWorkers])
  return total && { total, own, workers: fromWorkers }
}

function Row({ label, usage }: { label: string; usage?: UsageTotals }) {
  if (!usage) return null
  return (
    <div className="flex justify-between gap-16">
      <span>{label}</span>
      <span className="tabular-nums">{usageLabel(usage)}</span>
    </div>
  )
}

function Breakdown({ total, own, workers }: NonNullable<ReturnType<typeof usageFor>>) {
  const parts = [
    ['Input', total.inputTokens],
    ['Output', total.outputTokens],
    ['Cache reads', total.cacheReadTokens],
    ['Cache writes', total.cacheWriteTokens],
  ] as const
  const counted = [
    total.turns && `${total.turns} ${total.turns === 1 ? 'turn' : 'turns'}`,
    total.calls && `${total.calls} background ${total.calls === 1 ? 'call' : 'calls'}`,
  ].filter(Boolean)
  return (
    <div className="flex min-w-200 flex-col gap-4">
      <div className="font-semibold">Usage engines reported</div>
      {workers && (
        <>
          <Row label="This chat" usage={own} />
          <Row label="Workers" usage={workers} />
        </>
      )}
      {parts
        .filter(([, n]) => n > 0)
        .map(([label, n]) => (
          <div key={label} className="flex justify-between gap-16 text-muted">
            <span>{label}</span>
            <span className="tabular-nums">{formatTokens(n)} tokens</span>
          </div>
        ))}
      {total.costUsd > 0 && (
        <div className="flex justify-between gap-16">
          <span>Cost</span>
          <span className="tabular-nums">{formatCost(total.costUsd)}</span>
        </div>
      )}
      {counted.length > 0 && <div className="text-faint">{counted.join(', ')}</div>}
      <div className="text-faint">
        {total.costUsd > 0
          ? 'The cost is what the engine reports at API prices; a subscription is billed its own way.'
          : 'The engine reports no cost.'}
        {total.unpriced > 0 && total.costUsd > 0 && ` ${total.unpriced} without a cost (Codex reports none) aren’t in it.`}
      </div>
    </div>
  )
}

/** The header's usage chip, or nothing while no usage is reported. */
export function UsageTotal({ usage }: { usage?: ReturnType<typeof usageFor> }) {
  if (!usage || tokensIn(usage.total) + usage.total.costUsd <= 0) return null
  return (
    <Hint text={<Breakdown {...usage} />} side="bottom" align="end">
      <span
        tabIndex={0}
        aria-label={`Usage: ${usageLabel(usage.total)}`}
        className="shrink-0 cursor-default font-mono text-xs text-faint tabular-nums outline-none focus-visible:text-muted max-[650px]:hidden"
      >
        {usageLabel(usage.total)}
      </span>
    </Hint>
  )
}
