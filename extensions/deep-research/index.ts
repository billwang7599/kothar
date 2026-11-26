import type {
  ChatDetail,
  CompletionRequest,
  Extension,
  ExtensionContext,
  ExtensionHost,
  ExtensionListItem,
  ExtensionValues,
  ExtensionView,
  TurnSummary,
} from '@kothar/extension-api'
import { limitsFor, openResearch, planFromText, PROMPT_IDS, TEXT, type Investigation, type Outcome, type Ports } from './run.ts'
import { ACTIVE, DEPTHS, DEPTH_LIMITS, openStore, type Depth, type Phase, type Run, type RunSummary, type Store } from './store.ts'

export * from './report.ts'
export * from './run.ts'
export * from './store.ts'

// Deep Research: a long, multi-source investigation that ends in a cited report. An agent starts one with the
// deep_research tool, and so does the user, by turning on the composer's Deep research chip (their next messages go to
// the tool) or with New research in the Research popup. A plan of sub-questions waits for the user's go-ahead on the chat's bar; then each
// sub-question goes to a worker (a quiet child chat, on the Searching models) that searches and reads the web and
// returns findings with exact quotes. Kothar fetches each page itself and keeps a finding only if its quote is there.
// After a follow-up round or two on the gaps, the report is written from the kept findings only, with numbered
// citations made here from them, and saved as an artifact, else a note, else a file.
// Each run shows in the chat as a live card (a note view): the plan to approve or edit, its progress with Stop, then a
// link to the report, which opens beside the chat. The Research tab lists a space's runs once it has one; the Research
// popup (a sidebar launcher) lists every run in every space and Home, and opens the chat a run lives in.

// Put before the user's message while the chip is on (the prompt "chip").
export const CHIP_TEXT = [
  '[Deep research is on in this chat.] Call the deep_research tool with the message below as its question, word for',
  'word, then tell the user in a line that it started. Its report arrives in this chat when it’s done. Don’t research',
  'it yourself first. If the message clearly isn’t a question to research (thanks, a greeting, a question about a',
  'report you already gave), answer it normally instead.',
].join('\n')
const TOGGLE = 'research'
const PANEL = 'research'
const REPORT = 'report'
const HISTORY = 'history'
const CARD = 'run'
const FETCH_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 3_000_000
const MAX_QUESTION = 2000

const PHASE_LABELS: Record<Phase, string> = {
  planning: 'Planning',
  awaiting: 'Plan waiting for you',
  researching: 'Researching',
  reviewing: 'Reviewing',
  writing: 'Writing',
  done: 'Done',
  stopped: 'Stopped',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

/** A run's phase, as its row says it: "Researching 2 of 5". */
export function phaseText(run: Run): string {
  if (run.phase !== 'researching') return PHASE_LABELS[run.phase]
  const round = run.workers.filter((w) => w.round === run.round)
  const done = round.filter((w) => w.state !== 'running').length
  const total = run.round === 0 ? run.subQuestions.length : Math.max(round.length, done)
  return `Researching ${done} of ${total}`
}

const sourceCount = (run: Run) => Object.keys(run.sources).length

const short = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** What the agent reads when a run it didn't wait for is over: what came of it, and where its report is. */
export function reportFor(outcome: Outcome, run: Pick<Run, 'id' | 'question'>): string {
  const lines = [`Research ${run.id}: ${run.question}`, '']
  if (outcome.status === 'failed') {
    lines.push(`It failed: ${outcome.error ?? 'no reason given'}. Tell the user, and offer to try again.`)
    return lines.join('\n')
  }
  if (outcome.status === 'cancelled') {
    lines.push(`It didn’t finish: ${outcome.error ?? 'it stopped before any research ran'}. Tell the user, and offer to try again.`)
    return lines.join('\n')
  }
  lines.push(outcome.status === 'partial' ? 'It finished with a partial report (it stopped early or hit its budget).' : 'It finished.')
  if (outcome.sources !== undefined) lines.push(`Sources cited: ${outcome.sources}.`)
  const place = outcome.report
  if (place) lines.push(place.kind === 'file' ? `Report saved as the file ${place.ref}` : `Report saved as the ${place.kind} “${place.title}”.`)
  if (outcome.error) lines.push(outcome.error)
  if (outcome.summary) lines.push('', 'Summary:', outcome.summary)
  lines.push('', 'Tell the user what it found and where the report is.')
  return lines.join('\n')
}

// Fetches a page as a browser would ask for it, for checking quotes: text only, cut at MAX_PAGE_BYTES.
async function fetchPage(url: string, signal: AbortSignal) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, timeout]),
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Kothar-DeepResearch', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (/pdf|image|audio|video|octet-stream/i.test(contentType)) throw new Error(`Can't read ${contentType}`)
  const reader = response.body?.getReader()
  if (!reader) return { body: await response.text(), contentType }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel()
      break
    }
  }
  return { body: new TextDecoder().decode(Buffer.concat(chunks)), contentType }
}

export type DeepResearchOptions = {
  // Tests pass fakes for the model, the web and the workers.
  complete?: (host: ExtensionHost, request: CompletionRequest) => Promise<string>
  fetchPage?: Ports['fetchPage']
  investigate?: Ports['investigate']
}

export function createDeepResearchExtension(options: DeepResearchOptions = {}): Extension {
  let host: ExtensionHost | undefined
  let values: ExtensionValues = {}
  let research: ReturnType<typeof openResearch> | undefined
  let store: Store | undefined
  // Workers running for runs, by chat id: their replies come back through onTurnCompleted.
  const workers = new Map<string, { resolve: (result: Investigation) => void; run: string }>()
  // The runs whose plan the user is editing in their card, and the run each space's Research tab has selected.
  const editing = new Set<string>()
  const opened = new Map<string, string>()
  // By space: the run the report dock shows, whether it shows the evidence instead, and the popup's depth.
  const docked = new Map<string, { run: string; evidence: boolean }>()
  // By space the popup was opened from: what its search box holds, whether it lists only that space, and whether it
  // shows the New research form instead of the list.
  const history = new Map<string, { query: string; here: boolean; composing: boolean }>()
  const historyOf = (spaceId: string) => history.get(spaceId) ?? { query: '', here: false, composing: false }
  const setHistory = (spaceId: string, change: Partial<{ query: string; here: boolean; composing: boolean }>) =>
    history.set(spaceId, { ...historyOf(spaceId), ...change })
  const popupDepth = new Map<string, Depth>()

  // Each sub-question to a quiet child of the run's space, on the model list the settings pick.
  const investigate: Ports['investigate'] = (run, prompt, label, signal) =>
    new Promise<Investigation>((resolve) => {
      const h = host!
      // Planning is Plan's list: with Plan off, there's no such list, so its workers search on Searching.
      const planning = values.workerRole === 'planning' && h.extensionEnabled('plan')
      const role = values.workerRole === 'workers' || values.workerRole === 'chat' || planning ? (values.workerRole as string) : 'searching'
      let chatId: string
      try {
        // Workers are part of Kothar, so this needs nothing else: a child chat counts toward Settings → Workers' limit,
        // and one over it waits for a slot. The setting is read as each worker starts, so a change applies mid-run.
        const shown = values.showWorkers === true
        // Below the chat that asked: its space, Home, or a worker that runs research for its lead (so a worker's
        // research doesn't wait for the slot that worker holds).
        chatId = h.createChat({ name: label, parentId: run.chatId, role, quiet: true, ...(shown && { showReport: true }) }).id
      } catch (error) {
        return resolve({ reply: '', error: error instanceof Error ? error.message : String(error) })
      }
      const record = run.workers.findLast((w) => w.chatId === '' && w.state === 'running')
      if (record) record.chatId = chatId
      workers.set(chatId, { resolve, run: run.id })
      const stop = () => {
        try {
          h.interrupt(chatId)
        } catch {
          // Gone already.
        }
      }
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
      h.send(chatId, prompt)
    })

  const ensure = (h: ExtensionHost) => {
    host = h
    if (research) return research
    store = openStore(h.storage)
    const s = store
    research = openResearch({
      host: h,
      store: s,
      complete: (request) => (options.complete ? options.complete(h, request) : h.complete(request)),
      fetchPage: options.fetchPage ?? fetchPage,
      investigate: options.investigate ?? investigate,
      changed(run) {
        try {
          h.refresh(run.spaceId)
          if (run.chatId !== run.spaceId) h.refresh(run.chatId)
        } catch {
          // A chat that went has nothing to redraw.
        }
      },
    })
    return research
  }

  const settingsOf = (context: { values: ExtensionValues }) => {
    const v = context.values
    const depth: Depth = DEPTHS.includes(v.depth as Depth) ? (v.depth as Depth) : 'standard'
    return {
      depth,
      askFirst: v.askFirst !== false,
      caps: { workers: Number(v.maxWorkers) || 0, sources: Number(v.maxSources) || 0 },
    }
  }

  const spaceOf = (h: ExtensionHost, chatId: string) => h.space(chatId)?.id ?? chatId

  /**
   * Starts a run for a chat: its id at once, and its outcome once it's over. waitOn: the chat whose turn shows the plan
   * bar.
   */
  const begin = (
    h: ExtensionHost,
    context: { values: ExtensionValues },
    spec: { chatId: string; question: string; depth?: Depth; waitOn?: string; background?: boolean },
  ): { run: Run; outcome: Promise<Outcome> } => {
    values = context.values
    const engine = ensure(h)
    const settings = settingsOf(context)
    const depth = spec.depth ?? settings.depth
    const question = spec.question.trim().slice(0, MAX_QUESTION)
    if (!question) throw new Error('Give a question to research')
    const spaceId = spaceOf(h, spec.chatId)
    const run = engine.create({ chatId: spec.chatId, spaceId, question, depth, limits: limitsFor(depth, settings.caps), ...(spec.background && { background: true }) })
    opened.set(spaceId, run.id)
    // The run's live card in the chat: its plan, progress and Stop, then the report's link.
    try {
      h.note(spec.chatId, `Deep research: ${question.slice(0, 200)}`, { view: { id: CARD, key: run.id } })
    } catch {
      // The chat went; the run goes on and shows in the Research tab.
    }
    // A worker's run goes ahead without the plan to approve: its lead chose to run it, and no one watches a worker's
    // own view to approve it.
    const byWorker = h.chat(spec.chatId)?.worker === true
    return { run, outcome: engine.execute(run.id, { askFirst: settings.askFirst && !byWorker, ...(spec.waitOn && { waitOn: spec.waitOn }) }) }
  }

  /** Starts a run for a chat and waits for its report. */
  const start = async (h: ExtensionHost, context: { values: ExtensionValues }, spec: Parameters<typeof begin>[2]): Promise<Outcome> => begin(h, context, spec).outcome

  // A run the agent didn't wait for: its outcome goes to the chat that asked as a report, which wakes its agent to tell
  // the user. A run the user cancelled has nothing to tell.
  const deliver = (h: ExtensionHost, outcome: Outcome, run: Run) => {
    if (outcome.status === 'cancelled' && !outcome.error) return
    try {
      h.report(run.chatId, { name: `Deep research: ${short(run.question, 80)}`, text: reportFor(outcome, run), ...(outcome.status === 'failed' && { error: outcome.error ?? 'It failed' }) })
    } catch {
      // The chat went or was archived: the run's card and the Research tab still have it.
    }
  }

  const runsOf = (chat: ChatDetail) => {
    if (!host || !store) return []
    return store.list(spaceOf(host, chat.id))
  }

  const rowOf = (run: Run, selected: boolean): ExtensionListItem => {
    const active = ACTIVE.includes(run.phase)
    const sources = sourceCount(run)
    const detail = `${phaseText(run)} · ${sources} source${sources === 1 ? '' : 's'}${run.partial && !active ? ' · partial' : ''}`
    return {
      key: run.id,
      label: run.question,
      detail,
      // A running one ticks its time where the detail goes, so its phase shows as a badge.
      ...(active && { since: Date.parse(run.startedAt), badges: [{ text: phaseText(run), tone: 'accent' as const }] }),
      dot: active ? 'accent' : run.phase === 'done' ? (run.partial ? 'warning' : 'success') : run.phase === 'failed' ? 'error' : 'faint',
      selected,
      action: { name: 'open', value: run.id },
      ...(active && run.phase !== 'awaiting' && { button: { label: 'Stop', action: { name: 'stop', value: run.id }, hint: 'Stop and write a partial report from what was found' } }),
    }
  }

  const duration = (run: Run) => {
    const ms = Date.parse(run.endedAt ?? run.startedAt) - Date.parse(run.startedAt)
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
  }

  const placeText = (run: Run) => {
    if (!run.report) return undefined
    const { kind, title, ref } = run.report
    if (kind === 'artifact') return `Saved as the artifact “${title}”.`
    if (kind === 'note') return `Saved as the note “${title}”.`
    return `Saved as ${ref}.`
  }

  const subDot = (run: Run, sub: number): ExtensionListItem['dot'] => {
    const ws = run.workers.filter((w) => w.sub === sub)
    if (ws.some((w) => w.state === 'running')) return 'accent'
    return ws.length ? 'success' : 'faint'
  }

  // A run's card in the chat: the plan to approve or edit, then live progress with Stop, then a compact link to the
  // report once it's written.
  const cardView = (run: Run): ExtensionView => {
    const active = ACTIVE.includes(run.phase)
    const question: ExtensionView = { type: 'text', text: run.question }
    if (run.phase === 'awaiting' && editing.has(run.id)) {
      return {
        type: 'stack',
        children: [
          { type: 'row', children: [{ type: 'badge', text: 'Deep research', tone: 'accent' }, { type: 'text', text: 'Edit the plan', small: true, tone: 'muted' }] },
          question,
          {
            type: 'form',
            key: `plan-${run.id}`,
            fields: [{ name: 'subs', label: 'Sub-questions, one per line', value: run.subQuestions.join('\n'), rows: Math.max(4, run.subQuestions.length + 1) }],
            submit: { label: 'Start research', action: 'start-edited' },
            cancel: { label: 'Back', action: { name: 'edit-done' } },
          },
        ],
      }
    }
    if (run.phase === 'awaiting') {
      return {
        type: 'stack',
        children: [
          { type: 'row', children: [{ type: 'badge', text: PHASE_LABELS.awaiting, tone: 'accent' }, { type: 'text', text: run.depth, small: true, tone: 'muted' }] },
          question,
          { type: 'list', label: 'Plan', items: run.subQuestions.map((q, i) => ({ key: String(i), label: q, dot: 'faint' as const })) },
          {
            type: 'row',
            children: [
              { type: 'button', label: 'Start', variant: 'primary', action: { name: 'start' } },
              { type: 'button', label: 'Edit', action: { name: 'edit' }, hint: 'Change the sub-questions before it starts' },
              { type: 'button', label: 'Cancel', variant: 'ghost', action: { name: 'cancel' } },
            ],
          },
        ],
      }
    }
    if (active) {
      return {
        type: 'stack',
        children: [
          {
            type: 'row',
            justify: 'between',
            children: [
              {
                type: 'row',
                children: [
                  { type: 'badge', text: phaseText(run), tone: 'accent' },
                  { type: 'elapsed', since: Date.parse(run.startedAt), small: true, tone: 'muted' },
                  { type: 'text', text: `${sourceCount(run)} sources`, small: true, tone: 'muted' },
                ],
              },
              ...(run.phase === 'planning'
                ? []
                : [{ type: 'button' as const, label: 'Stop', variant: 'ghost' as const, action: { name: 'stop' }, hint: 'Stop and write a partial report from what was found' }]),
            ],
          },
          question,
          ...(run.subQuestions.length
            ? [{ type: 'list' as const, label: 'Sub-questions', items: run.subQuestions.map((q, i) => ({ key: String(i), label: q, detail: workersText(run, i), dot: subDot(run, i) })) }]
            : []),
        ],
      }
    }
    // Over: the link to its report, or why there's none.
    const report = store?.readReport(run.spaceId, run.id)
    const sources = sourceCount(run)
    const badge: ExtensionView = report
      ? { type: 'badge', text: run.partial ? 'Partial report' : 'Report', tone: run.partial ? 'warning' : 'success' }
      : { type: 'badge', text: PHASE_LABELS[run.phase], tone: run.phase === 'failed' ? 'error' : 'muted' }
    return {
      type: 'stack',
      gap: 'tight',
      children: [
        {
          type: 'row',
          justify: 'between',
          children: [
            { type: 'row', children: [badge, { type: 'text', text: `${sources} source${sources === 1 ? '' : 's'} · ${duration(run)}`, small: true, tone: 'muted' }] },
            {
              type: 'row',
              justify: 'end',
              children: [
                ...(report ? [{ type: 'button' as const, label: 'Open report', variant: 'primary' as const, action: { name: 'report' } }] : []),
                runMenu(run),
              ],
            },
          ],
        },
        question,
        ...(run.error ? [{ type: 'text' as const, text: run.error, tone: 'error' as const, small: true }] : []),
      ],
    }
  }

  // The rarer things to do with a finished run.
  const runMenu = (run: Run): ExtensionView => ({
    type: 'menu',
    label: `More for ${run.question.slice(0, 60)}`,
    items: [
      { label: 'Show evidence', action: { name: 'evidence', value: run.id }, hint: 'Every finding the workers returned, kept or dropped, with its quote' },
      { type: 'divider' },
      {
        label: 'Delete research',
        danger: true,
        action: { name: 'delete', value: run.id },
        confirm: { text: 'Delete this research?', body: 'Its plan, evidence and report here go. A report saved as an artifact or a note stays.', ok: 'Delete', danger: true },
      },
    ],
  })

  // The report, or the run's evidence: each finding with its quote and why it was kept or dropped.
  const reportView = (run: Run, evidence: boolean): ExtensionView => {
    const report = store?.readReport(run.spaceId, run.id)
    const where = placeText(run)
    const top: ExtensionView = {
      type: 'row',
      justify: 'between',
      children: [
        { type: 'badge', text: evidence ? 'Evidence' : run.partial ? 'Partial report' : 'Report', tone: run.partial ? 'warning' : 'muted' },
        {
          type: 'row',
          justify: 'end',
          children: [
            ...(report && !evidence
              ? [
                  { type: 'copy' as const, text: report, label: 'Copy', hint: 'Copy the report as Markdown' },
                  { type: 'download' as const, text: report, filename: `research-${run.id}.md`, label: 'Download', mimeType: 'text/markdown' },
                ]
              : []),
            { type: 'button', label: evidence ? 'Report' : 'Evidence', variant: 'ghost', action: { name: evidence ? 'report' : 'evidence', value: run.id } },
          ],
        },
      ],
    }
    if (!evidence) {
      return { type: 'stack', children: [top, ...(where ? [{ type: 'text' as const, text: where, tone: 'muted' as const, small: true }] : []), report ? { type: 'markdown', text: report } : { type: 'empty', text: 'This research has no report.' }] }
    }
    const items: ExtensionListItem[] = run.findings.map((f) => ({
      key: f.id,
      label: f.claim,
      excerpt: { text: `“${f.quote}”` },
      detail: f.dropped ? `Dropped: ${f.dropped}` : (run.sources[f.url]?.title ?? f.title),
      dot: f.verified ? 'success' : 'faint',
      link: { text: new URL(f.url).hostname, url: f.url },
    }))
    return { type: 'stack', children: [top, { type: 'heading', text: run.question }, { type: 'list', label: 'Findings', items, empty: 'No findings.' }] }
  }

  const deleteRun = (h: ExtensionHost, chatId: string, spaceId: string, runId: string) => {
    if (research!.isLive(runId)) throw new Error('Stop the research first')
    store!.remove(spaceId, runId)
    editing.delete(runId)
    if (opened.get(spaceId) === runId) opened.delete(spaceId)
    if (docked.get(spaceId)?.run === runId) {
      docked.delete(spaceId)
      h.closePanel(chatId, REPORT)
    }
  }

  const openReport = (h: ExtensionHost, chatId: string, spaceId: string, runId: string, evidence = false) => {
    docked.set(spaceId, { run: runId, evidence })
    h.showPanel(chatId, REPORT)
    h.refresh(chatId)
  }

  const newView = (spaceId: string, defaultDepth: Depth): ExtensionView => {
    const depth = popupDepth.get(spaceId) ?? defaultDepth
    return {
      type: 'stack',
      gap: 'loose',
      children: [
        { type: 'text', text: 'Workers search and read the web; the report cites only quotes found on their pages.', tone: 'muted', small: true },
        {
          type: 'row',
          children: [
            { type: 'text', text: 'Depth', small: true, tone: 'muted' },
            ...DEPTHS.map((d): ExtensionView => ({
              type: 'button',
              label: d[0]!.toUpperCase() + d.slice(1),
              variant: d === depth ? 'primary' : 'ghost',
              action: { name: 'depth', value: d },
              hint: `${DEPTH_LIMITS[d].subs} sub-questions, up to ${DEPTH_LIMITS[d].workers} workers and ${DEPTH_LIMITS[d].sources} sources`,
            })),
          ],
        },
        {
          type: 'form',
          key: `new-${spaceId}`,
          fields: [{ name: 'question', label: 'What should be researched?', placeholder: 'Such as: How do heat pumps compare with gas boilers on running cost in the UK?', rows: 4 }],
          submit: { label: 'Research', action: 'start-new' },
        },
      ],
    }
  }

  // Where a run lives, as its row in the Research popup says it: its space (or Home), or the worker in its space.
  const whereOf = (h: ExtensionHost, run: RunSummary) => {
    const space = h.chat(run.spaceId)?.name ?? 'A deleted chat'
    if (run.chatId === run.spaceId) return space
    const chat = h.chat(run.chatId)
    return chat ? `${chat.name} in ${space}` : space
  }

  // When a run started: the time today, the day this year, else the date.
  const whenOf = (h: ExtensionHost, iso: string) => {
    const at = new Date(iso)
    const now = h.now()
    if (Number.isNaN(at.getTime())) return ''
    if (at.toDateString() === now.toDateString()) return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const day: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    if (at.getFullYear() !== now.getFullYear()) day.year = 'numeric'
    return at.toLocaleDateString('en-US', day)
  }

  const statusOf = (run: RunSummary): { text: string; tone: ExtensionListItem['dot'] } => {
    if (ACTIVE.includes(run.phase)) return { text: PHASE_LABELS[run.phase], tone: 'accent' }
    if (run.phase === 'done') return run.partial ? { text: 'Partial', tone: 'warning' } : { text: 'Done', tone: 'success' }
    if (run.phase === 'failed') return { text: 'Failed', tone: 'error' }
    return { text: PHASE_LABELS[run.phase], tone: 'muted' }
  }

  const marksOf = (text: string, query: string): [number, number][] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const at = text.toLowerCase().indexOf(q)
    return at < 0 ? [] : [[at, at + q.length]]
  }

  const historyRow = (h: ExtensionHost, run: RunSummary, query: string): ExtensionListItem => {
    const status = statusOf(run)
    const label = short(run.question, 140)
    const marks = marksOf(label, query)
    const ref = { space: run.spaceId, run: run.id }
    return {
      key: `${run.spaceId}/${run.id}`,
      label,
      ...(marks.length && { marks }),
      detail: `${whereOf(h, run)} · ${run.depth} · ${whenOf(h, run.startedAt)}`,
      badges: [{ text: status.text, tone: status.tone }],
      dot: status.tone,
      action: { name: 'open', value: ref },
      hint: 'Open the chat this research is in',
      ...(run.report && { button: { label: 'Report', action: { name: 'report', value: ref }, hint: 'Open its chat with the report beside it' } }),
    }
  }

  // The Research popup: every run in every space and Home, newest first, from the store's index (no findings or reports
  // read); or the New research form.
  const historyView = (h: ExtensionHost, spaceId: string, defaultDepth: Depth): ExtensionView => {
    const state = historyOf(spaceId)
    if (state.composing) {
      return {
        type: 'stack',
        gap: 'loose',
        children: [
          {
            type: 'row',
            justify: 'between',
            children: [
              { type: 'heading', text: 'New research', hint: `It runs in ${h.chat(spaceId)?.name ?? 'this chat'}, where its card shows` },
              { type: 'button', label: 'Back', variant: 'ghost', action: { name: 'back' } },
            ],
          },
          newView(spaceId, defaultDepth),
        ],
      }
    }
    const q = state.query.trim().toLowerCase()
    const all = store!.all()
    const runs = all
      .filter((run) => !state.here || run.spaceId === spaceId)
      .filter((run) => !q || run.question.toLowerCase().includes(q) || whereOf(h, run).toLowerCase().includes(q))
    const here = h.chat(spaceId)?.name ?? 'This chat'
    return {
      type: 'stack',
      children: [
        {
          type: 'row',
          justify: 'between',
          children: [
            {
              type: 'row',
              children: [
                { type: 'button', label: 'All', variant: state.here ? 'ghost' : 'primary', action: { name: 'here', value: false }, hint: 'Research in every space and Home' },
                { type: 'button', label: short(here, 32), variant: state.here ? 'primary' : 'ghost', action: { name: 'here', value: true }, hint: 'Only research in this space' },
              ],
            },
            { type: 'button', label: 'New research', action: { name: 'compose' }, hint: 'Research a question in depth, with a cited report' },
          ],
        },
        { type: 'search', key: 'research-history', value: state.query, placeholder: 'Search research', label: 'Search research', action: 'search', autofocus: true },
        {
          type: 'list',
          label: 'Research',
          items: runs.map((run) => historyRow(h, run, state.query)),
          empty: all.length ? 'No research matches.' : 'No research yet.',
        },
      ],
    }
  }

  // The log entry of a run's card in a chat, to scroll to it.
  const cardEntry = (h: ExtensionHost, chatId: string, runId: string) => {
    const at = h.read(chatId).findLastIndex((e) => e.type === 'extension.note' && e.view?.id === CARD && e.view.key === runId)
    return at < 0 ? undefined : at
  }

  // Opens the chat a run lives in, scrolled to its card; with the report, beside it. A worker that asked for it and is
  // gone leaves its space.
  const openRun = (h: ExtensionHost, from: string, ref: { space: string; run: string }, report: boolean) => {
    const run = store!.read(ref.space, ref.run)
    if (!run) throw new Error('This research was deleted')
    const live = (id: string) => {
      const chat = h.chat(id)
      return chat !== undefined && !chat.archived
    }
    const target = live(run.chatId) ? run.chatId : live(run.spaceId) ? run.spaceId : undefined
    if (!target) throw new Error('The chat this research is in is gone')
    const entry = cardEntry(h, target, run.id)
    h.closePanel(from, HISTORY)
    if (report) {
      opened.set(run.spaceId, run.id)
      docked.set(run.spaceId, { run: run.id, evidence: false })
    }
    h.openChat(target, { ...(entry !== undefined && { entry }), ...(report && { panel: REPORT }) })
    if (report) h.refresh(target)
  }

  const workersText = (run: Run, sub: number) => {
    const ws = run.workers.filter((w) => w.sub === sub)
    if (!ws.length) return 'Waiting'
    const kept = run.findings.filter((f) => f.sub === sub && f.verified).length
    return ws.some((w) => w.state === 'running') ? 'Researching…' : `${kept} checked finding${kept === 1 ? '' : 's'}`
  }

  const extension: Extension = {
    id: 'deep-research',
    name: 'Deep Research',
    description: 'Long, multi-source research that ends in a cited report. Workers search and read the web; every claim in the report is backed by a quote Kothar found on its page.',
    enabledByDefault: true,
    // Its own model list in Settings → Models, which research workers run on unless Workers use says another. The id
    // predates declared roles: users' saved Searching lists are under it.
    modelRoles: [{ id: 'searching', label: 'Searching', description: 'Research workers, and workers started to search.' }],
    prompts: [
      {
        id: 'chip',
        label: 'Put before your message while Deep research is on',
        text: CHIP_TEXT,
        where: 'message',
      },
      { id: PROMPT_IDS.plan, label: 'The planner’s instructions', text: TEXT.plan, where: 'background' },
      {
        id: PROMPT_IDS.workerIntro,
        label: 'A research worker: who it is',
        text: TEXT.workerIntro,
        where: 'background',
        description: 'The question, its sub-question and the kinds of sources follow it.',
      },
      { id: PROMPT_IDS.workerHow, label: 'A research worker: how to work', text: TEXT.workerHow, where: 'background' },
      {
        id: PROMPT_IDS.workerReply,
        label: 'A research worker: how to reply',
        text: TEXT.workerReply,
        where: 'background',
        description: 'Kothar reads the <findings> block, so keep its shape.',
      },
      { id: PROMPT_IDS.review, label: 'The reviewer’s instructions (follow-up rounds)', text: TEXT.review, where: 'background' },
      { id: PROMPT_IDS.write, label: 'The report writer’s instructions', text: TEXT.write, where: 'background' },
    ],
    settings: [
      {
        key: 'depth',
        label: 'Default depth',
        description: 'Quick: about 3 sub-questions, no follow-up. Standard: 4 to 6, one follow-up round. Thorough: 6 to 8, two follow-up rounds.',
        type: 'select',
        options: DEPTHS.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) })),
        default: 'standard',
      },
      {
        key: 'askFirst',
        label: 'Ask before starting research',
        description: 'Show the plan and wait for Start before any worker runs.',
        type: 'boolean',
        default: true,
      },
      {
        key: 'maxWorkers',
        label: 'Most workers per research',
        description: `0 uses the depth's: ${DEPTHS.map((d) => `${d} ${DEPTH_LIMITS[d].workers}`).join(', ')}.`,
        type: 'number',
        default: 0,
        min: 0,
        max: 50,
        integer: true,
      },
      {
        key: 'maxSources',
        label: 'Most sources per research',
        description: `0 uses the depth's: ${DEPTHS.map((d) => `${d} ${DEPTH_LIMITS[d].sources}`).join(', ')}.`,
        type: 'number',
        default: 0,
        min: 0,
        max: 200,
        integer: true,
      },
      {
        key: 'workerRole',
        label: 'Workers use',
        description: 'Which model list (Settings → Models) research workers run on.',
        type: 'select',
        options: [
          { value: 'searching', label: 'Searching models' },
          { value: 'workers', label: 'Workers models' },
          { value: 'planning', label: 'Planning models (with Plan on)' },
          { value: 'chat', label: 'Chat models' },
        ],
        default: 'searching',
      },
      {
        key: 'showWorkers',
        label: 'Show research workers as subagents',
        description: 'Each worker’s report shows in the chat, folded, like any worker’s. Off: they work quietly and only the report shows.',
        type: 'boolean',
        default: false,
      },
    ],
    composerToggles: [
      {
        id: TOGGLE,
        label: 'Deep research',
        icon: 'search',
        hint: 'Research your next message in depth, with a cited report',
        activeHint: 'Your next message starts deep research',
        // Every chat the user types in, Home included (Home is the Home extension's own chat); not workers.
        shown: (chat) => !chat.worker,
      },
    ],
    tools: [
      {
        name: 'deep_research',
        description:
          'Researches a question in depth across many web sources and writes a cited report: plans sub-questions (the user ' +
          'may be asked to approve the plan), runs research workers, checks every quote against its page, then saves the ' +
          'report (an artifact, a note or a file). Takes minutes, so it runs in the background: it returns at once with the ' +
          'run’s id, your turn can end and the user can keep talking, and when it’s over its summary and where the report ' +
          'is arrive in this chat as a report that wakes you, to tell the user. With wait: true it returns only once the ' +
          'report is written, for when you need it before you go on. Use it for questions that need many sources; not for ' +
          'quick lookups.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', minLength: 1, maxLength: MAX_QUESTION, description: 'The question, as the user asked it' },
            depth: { type: 'string', enum: [...DEPTHS], description: 'quick, standard or thorough; the user’s default without it' },
            wait: { type: 'boolean', description: 'Wait for the report instead of having it arrive later; false by default' },
          },
          required: ['question'],
        },
        // Not to its own workers: research doesn't nest.
        offered: (caller) => !workers.has(caller.id),
        async run(input, { caller, values: v, host: h }) {
          const depth = DEPTHS.includes(input.depth as Depth) ? (input.depth as Depth) : undefined
          const spec = { chatId: caller.id, question: String(input.question ?? ''), ...(depth && { depth }) }
          // A worker waits: it reports and goes once its turn ends, so a report sent to it later would find no one.
          if (input.wait === true || caller.worker === true || h.chat(caller.id)?.worker === true) return start(h, { values: v }, { ...spec, waitOn: caller.id })
          // In the background: the plan, if asked for, waits in the run's card, since the turn that could show it on
          // the bar is about to end.
          const { run, outcome } = begin(h, { values: v }, { ...spec, background: true })
          void outcome.then(
            (o) => deliver(h, o, run),
            (error) => deliver(h, { status: 'failed', question: run.question, error: error instanceof Error ? error.message : String(error), run: run.id }, run),
          )
          const askFirst = settingsOf({ values: v }).askFirst
          return {
            status: 'started',
            run: run.id,
            question: run.question,
            note: [
              'Research started; the report will arrive in this chat when it’s done, as a report that wakes you. Tell the user',
              'it started and end your turn; don’t wait for it or research it yourself.',
              ...(askFirst ? ['Its plan waits for the user’s Start in its card in the chat: say so.'] : []),
            ].join(' '),
          }
        },
      },
    ],
    // With the chip on, a message the user sends asks the agent to research it with the tool.
    transformMessage(text, chat, { host: h }) {
      if (chat.worker || !text.trim() || workers.has(chat.id)) return text
      // A message sent while a plan waits on this chat is about that plan, not a new question.
      if (research?.awaitingOn(chat.id)) return text
      let on = false
      try {
        on = h.toggled(chat.id, TOGGLE)
      } catch {
        return text
      }
      if (!on) return text
      const header = typeof h.prompt === 'function' ? h.prompt('chip') : CHIP_TEXT
      return [header, '', text].join('\n')
    },
    onStart(context) {
      values = context.values
      const engine = ensure(context.host)
      for (const spaceId of store!.spaces()) {
        for (const run of store!.list(spaceId)) {
          if (!ACTIVE.includes(run.phase)) continue
          // A run Kothar quit in the middle of ends now, partial; one the agent didn't wait for reports it, since no
          // tool call is left to return it.
          void engine.recover(run).then(
            (outcome) => outcome && run.background && deliver(context.host, outcome, run),
            () => undefined,
          )
        }
      }
    },
    onSettingsChanged(_changed, context) {
      values = context.values
    },
    onStop() {
      for (const run of research?.liveRuns() ?? []) research?.stop(run.id, 'The Deep Research extension was turned off.')
    },
    onTurnCompleted(turn: TurnSummary) {
      const waiting = workers.get(turn.chat.id)
      if (!waiting) return
      workers.delete(turn.chat.id)
      waiting.resolve({ reply: turn.text, ...(turn.error && { error: turn.error }) })
    },
    onChatRemoved(chat) {
      const waiting = workers.get(chat.id)
      if (waiting) {
        workers.delete(chat.id)
        waiting.resolve({ reply: '', error: 'The worker was removed' })
      }
      opened.delete(chat.id)
      docked.delete(chat.id)
      popupDepth.delete(chat.id)
      history.delete(chat.id)
    },
    onSpaceRemoved(space, context) {
      ensure(context.host)
      for (const run of research!.liveRuns()) if (run.spaceId === space.id) research!.stop(run.id, 'Its space was deleted.')
      store!.removeSpace(space.id)
    },
    onWaitAction(chat, answer, context) {
      ensure(context.host)
      const run = research!.awaitingOn(chat.id)
      if (!run || !('button' in answer)) return
      if (answer.button === 'start') research!.decide(run.id, { start: true })
      else if (answer.button === 'cancel') research!.decide(run.id, { start: false })
      else if (answer.button === 'edit') {
        // The plan opens for editing in the run's card, in the chat.
        editing.add(run.id)
        context.host.refresh(chat.id)
      }
    },
    noteViews: [
      {
        id: CARD,
        render(key, chat, context) {
          ensure(context.host)
          const run = store!.read(spaceOf(context.host, chat.id), key)
          if (!run) return { type: 'text', text: 'This research was deleted.', tone: 'muted', small: true }
          return cardView(run)
        },
        onAction(action, key, chat, context) {
          const h = context.host
          ensure(h)
          const spaceId = spaceOf(h, chat.id)
          const run = store!.read(spaceId, key)
          if (!run) return
          switch (action.name) {
            case 'stop':
              research!.stop(run.id)
              return
            case 'start':
              editing.delete(run.id)
              research!.decide(run.id, { start: true })
              return
            case 'edit':
              editing.add(run.id)
              return
            case 'edit-done':
              editing.delete(run.id)
              return
            case 'cancel':
              editing.delete(run.id)
              research!.decide(run.id, { start: false })
              return
            case 'start-edited': {
              const subs = (action.value as { subs?: unknown } | null)?.subs
              const plan = planFromText(typeof subs === 'string' ? subs : '', run.plan?.sources)
              if (!plan) throw new Error('Give at least one sub-question')
              editing.delete(run.id)
              research!.decide(run.id, { start: true, plan })
              return
            }
            case 'report':
            case 'evidence':
              openReport(h, chat.id, spaceId, run.id, action.name === 'evidence')
              return
            case 'delete':
              deleteRun(h, chat.id, spaceId, run.id)
              return
          }
        },
      },
    ],
    panels: [
      {
        id: PANEL,
        title: 'Research',
        // Only once the space has a run: each run's card is in the chat, and this lists them all.
        shown(chat, context) {
          ensure(context.host)
          return store!.has(spaceOf(context.host, chat.id))
        },
        render(chat, context) {
          values = context.values
          ensure(context.host)
          const runs = runsOf(chat)
          const spaceId = spaceOf(context.host, chat.id)
          const selectedId = opened.get(spaceId)
          if (!runs.length) return { type: 'empty', text: 'No research yet.' }
          return { type: 'list', label: 'Research', items: runs.map((r) => rowOf(r, r.id === selectedId)) }
        },
        onAction(action, chat, context) {
          ensure(context.host)
          const spaceId = spaceOf(context.host, chat.id)
          const runId = typeof action.value === 'string' ? action.value : ''
          switch (action.name) {
            case 'open': {
              opened.set(spaceId, runId)
              // A finished run's report opens beside the chat; a running one is followed in its card.
              if (store!.readReport(spaceId, runId)) openReport(context.host, chat.id, spaceId, runId)
              return
            }
            case 'stop':
              research!.stop(runId)
              return
          }
        },
      },
      {
        id: REPORT,
        title: 'Research report',
        placement: 'dock',
        // Opened from a run's card or the Research tab, not a tab of its own.
        tab: false,
        render(chat, context) {
          ensure(context.host)
          const spaceId = spaceOf(context.host, chat.id)
          const shown = docked.get(spaceId)
          const run = shown && store!.read(spaceId, shown.run)
          if (!run) return { type: 'empty', text: 'Open a finished research from its card in the chat or the Research tab to read its report.' }
          return reportView(run, shown.evidence)
        },
        onAction(action, chat, context) {
          ensure(context.host)
          const spaceId = spaceOf(context.host, chat.id)
          if ((action.name === 'report' || action.name === 'evidence') && typeof action.value === 'string') {
            docked.set(spaceId, { run: action.value, evidence: action.name === 'evidence' })
          }
        },
      },
      {
        id: HISTORY,
        title: 'Research',
        placement: 'popup',
        launcher: true,
        shortcut: 'Mod+Shift+D',
        render(chat, context) {
          ensure(context.host)
          return historyView(context.host, spaceOf(context.host, chat.id), settingsOf(context).depth)
        },
        onAction(action, chat, context) {
          const h = context.host
          ensure(h)
          const spaceId = spaceOf(h, chat.id)
          const ref = action.value as { space?: unknown; run?: unknown } | null
          switch (action.name) {
            case 'search':
              return void setHistory(spaceId, { query: typeof action.value === 'string' ? action.value : '' })
            case 'here':
              return void setHistory(spaceId, { here: action.value === true })
            case 'compose':
              return void setHistory(spaceId, { composing: true })
            case 'back':
              return void setHistory(spaceId, { composing: false })
            case 'open':
            case 'report':
              if (typeof ref?.space !== 'string' || typeof ref.run !== 'string') return
              return openRun(h, chat.id, { space: ref.space, run: ref.run }, action.name === 'report')
            case 'depth':
              if (DEPTHS.includes(action.value as Depth)) popupDepth.set(spaceId, action.value as Depth)
              return
            case 'start-new': {
              const question = (action.value as { question?: unknown } | null)?.question
              if (typeof question !== 'string' || !question.trim()) throw new Error('Type a question to research')
              const depth = popupDepth.get(spaceId) ?? settingsOf(context).depth
              // In the background: the run's card in the space's chat shows the plan, if asked for, then its progress.
              void start(h, context, { chatId: spaceId, question, depth }).catch((error) => h.error(error instanceof Error ? error.message : String(error)))
              setHistory(spaceId, { composing: false })
              h.closePanel(chat.id, HISTORY)
              return
            }
          }
        },
      },
    ],
  }
  return extension
}

/** The context an extension hook gets, for tests that drive the extension directly. */
export type DeepResearchContext = ExtensionContext

export default createDeepResearchExtension()
