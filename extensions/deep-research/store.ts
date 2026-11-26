// Each research run's record, kept so its evidence can be checked later: runs/<space id>/<run id>.json holds the
// question, the plan, every worker's findings (dropped ones too, with why), the sources and where the report went;
// <run id>.md is the report. A space's runs go when the space is deleted. index.json keeps a short summary of every run
// in every space (RunSummary), so the list of all research reads one small file, not each run's findings.
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionStorage } from '@kothar/extension-api'
import type { Finding, Source } from './report.ts'

export type Depth = 'quick' | 'standard' | 'thorough'
export const DEPTHS: readonly Depth[] = ['quick', 'standard', 'thorough']

// How far each depth goes: workers at once, workers and sources in all, follow-up rounds after the first, and how
// many sub-questions the plan aims for.
export const DEPTH_LIMITS: Record<Depth, { parallel: number; workers: number; sources: number; rounds: number; subs: string }> = {
  quick: { parallel: 2, workers: 4, sources: 12, rounds: 0, subs: '3' },
  standard: { parallel: 3, workers: 10, sources: 30, rounds: 1, subs: '4 to 6' },
  thorough: { parallel: 5, workers: 20, sources: 60, rounds: 2, subs: '6 to 8' },
}

export type Phase = 'planning' | 'awaiting' | 'researching' | 'reviewing' | 'writing' | 'done' | 'stopped' | 'cancelled' | 'failed'
export const ACTIVE: readonly Phase[] = ['planning', 'awaiting', 'researching', 'reviewing', 'writing']

export type Plan = { subQuestions: string[]; sources: string[] }

export type WorkerRecord = { chatId: string; sub: number; round: number; state: 'running' | 'done' | 'failed' | 'stopped'; error?: string }

export type ReportPlace = { kind: 'artifact' | 'note' | 'file'; title: string; ref: string }

export type Run = {
  id: string
  spaceId: string
  // The chat that asked: the agent's (the tool), or the space (the popup).
  chatId: string
  question: string
  depth: Depth
  phase: Phase
  startedAt: string
  endedAt?: string
  round: number
  plan?: Plan
  // Sub-questions added by follow-up rounds come after the plan's, so a finding's sub indexes this list.
  subQuestions: string[]
  workers: WorkerRecord[]
  findings: Finding[]
  sources: Record<string, Source>
  limits: { parallel: number; workers: number; sources: number; rounds: number }
  partial?: string
  summary?: string
  report?: ReportPlace
  error?: string
  // Started by an agent that didn't wait for it: its outcome goes to chatId as a report (ExtensionHost.report).
  background?: true
}

/** What the list of every run shows of one: no plan, findings or sources. */
export type RunSummary = Pick<Run, 'id' | 'spaceId' | 'chatId' | 'question' | 'depth' | 'phase' | 'startedAt' | 'endedAt'> & {
  partial?: true
  report?: true
}

const INDEX = 'index.json'
const QUESTION_CHARS = 300

export const summaryOf = (run: Run): RunSummary => ({
  id: run.id,
  spaceId: run.spaceId,
  chatId: run.chatId,
  question: run.question.slice(0, QUESTION_CHARS),
  depth: run.depth,
  phase: run.phase,
  startedAt: run.startedAt,
  ...(run.endedAt && { endedAt: run.endedAt }),
  ...(run.partial && { partial: true as const }),
  // The report is written (its .md) once the run has a summary, wherever it was then placed.
  ...((run.summary !== undefined || run.report) && { report: true as const }),
})

const sameSummary = (a: RunSummary | undefined, b: RunSummary) => a !== undefined && JSON.stringify(a) === JSON.stringify(b)

const folderOf = (spaceId: string) => `runs/${spaceId}`
const fileOf = (spaceId: string, runId: string) => `${folderOf(spaceId)}/${runId}.json`
const reportFileOf = (spaceId: string, runId: string) => `${folderOf(spaceId)}/${runId}.md`

export function openStore(storage: ExtensionStorage) {
  const read = (spaceId: string, runId: string): Run | undefined => {
    const text = storage.read(fileOf(spaceId, runId))
    if (!text) return undefined
    try {
      return JSON.parse(text) as Run
    } catch {
      return undefined
    }
  }
  const spaces = (): string[] => {
    try {
      // Folders aren't listed by storage.list, so the runs folder is read through its path.
      return readdirSync(join(storage.dir, 'runs'))
    } catch {
      return []
    }
  }
  // The index by "<space id>/<run id>", read once and kept; written only when a summary changes.
  let index: Record<string, RunSummary> | undefined
  const loadIndex = (): Record<string, RunSummary> => {
    if (index) return index
    try {
      const parsed = JSON.parse(storage.read(INDEX) ?? '{}') as unknown
      index = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, RunSummary>) : {}
    } catch {
      index = {}
    }
    return index
  }
  const writeIndex = () => storage.write(INDEX, JSON.stringify(index ?? {}))
  const keyOf = (spaceId: string, runId: string) => `${spaceId}/${runId}`
  return {
    save(run: Run) {
      storage.write(fileOf(run.spaceId, run.id), JSON.stringify(run, null, 2))
      const all = loadIndex()
      const summary = summaryOf(run)
      const key = keyOf(run.spaceId, run.id)
      if (sameSummary(all[key], summary)) return
      all[key] = summary
      writeIndex()
    },
    read,
    // The space's runs, newest first.
    list(spaceId: string): Run[] {
      return storage
        .list(folderOf(spaceId))
        .filter((f) => f.name.endsWith('.json'))
        .flatMap((f) => read(spaceId, f.name.slice(0, -'.json'.length)) ?? [])
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    },
    // Whether the space has any run, without reading them: for whether its Research tab shows.
    has: (spaceId: string) => storage.list(folderOf(spaceId)).some((f) => f.name.endsWith('.json')),
    // Every space's runs, for finding runs Kothar quit in the middle of.
    spaces,
    /**
     * Every run in every space, newest first, from the index. Runs saved before the index, or missing from it, are read
     * once and added; entries whose run file went are dropped. Only file names are listed for that, never contents.
     */
    all(): RunSummary[] {
      const all = loadIndex()
      const present = new Set<string>()
      let changed = false
      for (const spaceId of spaces()) {
        for (const f of storage.list(folderOf(spaceId))) {
          if (!f.name.endsWith('.json')) continue
          const runId = f.name.slice(0, -'.json'.length)
          const key = keyOf(spaceId, runId)
          present.add(key)
          if (all[key]) continue
          const run = read(spaceId, runId)
          if (!run) continue
          all[key] = summaryOf(run)
          changed = true
        }
      }
      for (const key of Object.keys(all)) {
        if (present.has(key)) continue
        delete all[key]
        changed = true
      }
      if (changed) writeIndex()
      return Object.values(all).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    },
    saveReport: (run: Run, markdown: string) => storage.write(reportFileOf(run.spaceId, run.id), markdown),
    readReport: (spaceId: string, runId: string) => storage.read(reportFileOf(spaceId, runId)),
    remove(spaceId: string, runId: string) {
      storage.remove(fileOf(spaceId, runId))
      storage.remove(reportFileOf(spaceId, runId))
      const all = loadIndex()
      if (!all[keyOf(spaceId, runId)]) return
      delete all[keyOf(spaceId, runId)]
      writeIndex()
    },
    removeSpace(spaceId: string) {
      rmSync(join(storage.dir, folderOf(spaceId)), { recursive: true, force: true })
      const all = loadIndex()
      const keys = Object.keys(all).filter((key) => all[key]!.spaceId === spaceId)
      for (const key of keys) delete all[key]
      if (keys.length) writeIndex()
    },
  }
}

export type Store = ReturnType<typeof openStore>
