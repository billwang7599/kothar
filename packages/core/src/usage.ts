// Usage: the tokens and cost engines report, kept as plain files. Each chat's reports go in usage.jsonl in its folder,
// one JSON line each (UsageRecord): a turn's model calls (turn.usage, source 'turn') and the one-shot calls made for it
// (host.complete with its chatId, source 'complete'). A one-shot call no chat asked for goes in the garage's own
// usage.jsonl. The file stays when messages are deleted or forgotten (the calls were made all the same). A worker's
// folder goes once it has reported, so its records move to its lead's file first (carried: chatId names the worker),
// and the space's total keeps them; a deleted space takes its file with it.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Usage, UsageRecord, UsageTotals } from '@kothar/extension-api'

export const USAGE_FILE = 'usage.jsonl'

const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd'] as const

export const emptyTotals = (): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  turns: 0,
  calls: 0,
  unpriced: 0,
})

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined)

/**
 * The usage an engine reported, kept to what Kothar stores: numbers that are finite and above 0 (an engine's zeros and
 * nonsense left out), and a model id. Undefined when nothing is left, so a turn that used nothing records nothing.
 */
export function cleanUsage(usage: Usage | undefined): Usage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const clean: Usage = {}
  for (const field of FIELDS) {
    const value = count(usage[field])
    if (value !== undefined) clean[field] = field === 'costUsd' ? value : Math.round(value)
  }
  if (!FIELDS.some((field) => clean[field] !== undefined)) return undefined
  if (typeof usage.model === 'string' && usage.model) clean.model = usage.model
  return clean
}

/** Adds one record to totals, in place, and returns them. */
export function addUsage(totals: UsageTotals, record: Usage & { source?: UsageRecord['source'] }): UsageTotals {
  for (const field of FIELDS) totals[field] += count(record[field]) ?? 0
  if (record.source === 'complete') totals.calls += 1
  else totals.turns += 1
  const tokens = (record.inputTokens ?? 0) + (record.outputTokens ?? 0) + (record.cacheReadTokens ?? 0) + (record.cacheWriteTokens ?? 0)
  if (record.costUsd === undefined && tokens > 0) totals.unpriced += 1
  return totals
}

/** Totals added together, into a new one. */
export function sumTotals(all: readonly (UsageTotals | undefined)[]): UsageTotals {
  const sum = emptyTotals()
  for (const totals of all) {
    if (!totals) continue
    for (const key of Object.keys(sum) as (keyof UsageTotals)[]) sum[key] += totals[key]
  }
  return sum
}

/** The records in dir's usage.jsonl, oldest first; a line that isn't one is skipped, a missing file is none. */
export function readUsage(dir: string): UsageRecord[] {
  let text: string
  try {
    text = readFileSync(join(dir, USAGE_FILE), 'utf8')
  } catch {
    return []
  }
  const records: UsageRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as UsageRecord
      if (parsed && typeof parsed === 'object' && typeof parsed.at === 'string') records.push(parsed)
    } catch {
      // A line cut short by a crash.
    }
  }
  return records
}

/**
 * The totals of dir's usage.jsonl, the chat chatId's own (own) apart from those of its workers that have been removed
 * (carried).
 */
export function totalsOf(dir: string, chatId: string) {
  const own = emptyTotals()
  const carried = emptyTotals()
  for (const record of readUsage(dir)) addUsage(record.chatId === undefined || record.chatId === chatId ? own : carried, record)
  return { own, carried }
}

/** Adds every record in each of `from`'s usage files to `to`'s, as they are. Returns them. */
export function carryUsage(from: readonly string[], to: string) {
  const records = from.flatMap(readUsage)
  if (records.length) appendFileSync(join(to, USAGE_FILE), records.map((record) => JSON.stringify(record) + '\n').join(''))
  return records
}

/** Adds one record to dir's usage.jsonl. */
export const appendUsage = (dir: string, record: UsageRecord) =>
  appendFileSync(join(dir, USAGE_FILE), JSON.stringify(record) + '\n')

/**
 * Adds up usage the engine reports per model and per call, for adapters: each entry's fields read through `read` and
 * summed per model, so an engine that reports each model call (pi's messages) or each model (Claude Code's per-model
 * usage) sends one turn.usage per model.
 */
export function usageByModel<T>(items: Iterable<[model: string | undefined, item: T]>, read: (item: T) => Usage): Usage[] {
  const by = new Map<string, Usage>()
  for (const [model, item] of items) {
    const usage = cleanUsage(read(item))
    if (!usage) continue
    const key = model ?? ''
    const sum = by.get(key) ?? (model ? { model } : {})
    for (const field of FIELDS) {
      const value = usage[field]
      if (value !== undefined) sum[field] = (sum[field] ?? 0) + value
    }
    by.set(key, sum)
  }
  return [...by.values()]
}

const short = (n: number) => (n >= 1000 ? `${Number((n / 1000).toFixed(n >= 10_000 ? 0 : 1))}k` : String(n))

/** What one-shot calls used, for an Activity line: ", 1.2k tokens, $0.0021", or nothing when none was reported. */
export function usedText(used: readonly Usage[]) {
  const totals = used.map((usage) => cleanUsage(usage)).filter((u) => u !== undefined).reduce(addUsage, emptyTotals())
  const tokens = totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  if (!tokens && !totals.costUsd) return ''
  return `, ${short(tokens)} tokens${totals.costUsd ? `, $${Number(totals.costUsd.toPrecision(2))}` : ''}`
}
