import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type {
  ChatDetail,
  Checkout,
  Extension,
  ExtensionAction,
  ExtensionContext,
  ExtensionHost,
  ExtensionListItem,
  ExtensionTone,
  ExtensionValues,
  ExtensionView,
} from '@kothar/extension-api'
import { cleanupCheckout, cleanupStrayWorktrees } from './cleanup.ts'
import {
  anchorOf,
  diffRows,
  loadComments,
  reviewMessage,
  saveComments,
  SENT_FILE,
  viewComments,
  type Group,
  type ReviewComment,
  type ReviewTarget,
} from './review.ts'

// The Changes tab shows each git folder of a space as its agents left it, and a note follows a turn that
// changed files. Agents already use git and gh through their shell, so this adds no tools and no buttons that change
// the repo. Its one change there is its cleanup: a checkout whose branch is merged goes (cleanup.ts). Every git and
// gh call goes through the Machine (host.run). The user can pop the tab out into a large view (REVIEW) and write
// comments on lines of a diff, which go to the space's agent in one message (review.ts).

export const PANEL = 'changes'
export const REVIEW = 'changes-review'
const GIT_TIMEOUT_MS = 30_000
const GH_TIMEOUT_MS = 15_000
// gh asks GitHub, so a PR's status is kept this long between draws, unless the user refreshes or a turn ends.
export const PR_TTL_MS = 60_000
const DIFF_MAX_LINES = 800
// A group lists at most this many files; a build folder an agent forgot to ignore can hold thousands.
export const FILES_MAX = 200
// While a turn runs, the tab is drawn again at most this often after the agent's shell commands and edits.
export const LIVE_REFRESH_MS = 3000

type Run = ExtensionHost['run']

export type FileChange = { path: string; added?: number; removed?: number; binary?: boolean; untracked?: boolean }

export type PrStatus = {
  number: number
  title: string
  state: string
  url: string
  checks?: 'passing' | 'failing' | 'running'
}

// One git folder of a space: its checkout in the work folder, or the folder itself before the first message.
// label: the card's title, when the folder's name isn't enough (a worker's own checkout).
type Target = { folder: string; path: string; checkout?: Checkout; label?: string }

export type RepoState = {
  target: Target
  branch?: string
  // The commit checked out when no branch is (branch is then HEAD).
  detached?: string
  upstream?: string
  ahead?: number
  behind?: number
  // What committed changes are counted against: the branch the checkout was made from, else the default branch.
  base?: string
  committed: FileChange[]
  uncommitted: FileChange[]
  pr?: PrStatus
  error?: string
}

async function git(run: Run, cwd: string, args: string[], ok = [0]) {
  const result = await run('git', ['-C', cwd, ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
  if (!ok.includes(result.code ?? -1)) throw new Error(result.stderr.trim() || `git ${args[0]} failed`)
  return result.stdout
}

const tryGit = (run: Run, cwd: string, args: string[]) => git(run, cwd, args).then((out) => out.trim(), () => undefined)

export function parseNumstat(out: string): FileChange[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added = '', removed = '', ...rest] = line.split('\t')
      const path = rest.join('\t')
      return added === '-' ? { path, binary: true } : { path, added: Number(added), removed: Number(removed) }
    })
}

export function checksOf(rollup: unknown): PrStatus['checks'] {
  if (!Array.isArray(rollup) || !rollup.length) return undefined
  const states = rollup.map((c) => String(c?.conclusion || c?.state || c?.status || '').toUpperCase())
  if (states.some((s) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(s))) {
    return 'failing'
  }
  if (states.some((s) => !['SUCCESS', 'NEUTRAL', 'SKIPPED', 'COMPLETED'].includes(s))) return 'running'
  return 'passing'
}

export function targetsOf(host: ExtensionHost, chatId: string): Target[] {
  const space = host.space(chatId)
  if (!space) return []
  // A checkout the cleanup removed stays in the space's record until its next message makes a new one. The Machine is
  // this computer for now, so the file system can tell.
  const checkouts = space.checkouts
    .filter((c) => existsSync(c.path))
    .map((checkout) => ({ folder: checkout.folder, path: checkout.path, checkout }))
  // Workers' own checkouts: a worker sees only its own; the space sees its own, then each worker's that's still there,
  // counted against the space's branch it merges into.
  const workers = (space.workerCheckouts ?? [])
    .filter((c) => existsSync(c.path))
    .map(({ worker, name, state, ...checkout }) => ({
      folder: checkout.folder,
      path: checkout.path,
      checkout,
      label: `${basename(checkout.folder)} · worker ${name}${state === 'working' ? '' : state === 'kept' ? ' (kept)' : ' (to review)'}`,
      worker,
    }))
  const own = workers.filter((w) => w.worker === chatId)
  if (own.length) return own.map(({ worker: _, ...target }) => target)
  const waiting = space.folders
    .filter((f) => f.git && !checkouts.some((c) => c.folder === f.path))
    .map((f) => ({ folder: f.path, path: f.path }))
  return [...checkouts, ...waiting, ...workers.map(({ worker: _, ...target }) => target)]
}

async function defaultBranch(run: Run, cwd: string) {
  const head = await tryGit(run, cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head) return head
  for (const name of ['main', 'master']) {
    if (await tryGit(run, cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) return name
  }
  return undefined
}

export async function prOf(run: Run, cwd: string, branch: string): Promise<PrStatus | undefined> {
  try {
    const fields = 'number,title,state,url,statusCheckRollup'
    const result = await run('gh', ['pr', 'view', branch, '--json', fields], { cwd, timeoutMs: GH_TIMEOUT_MS })
    if (result.code !== 0) return undefined
    const pr = JSON.parse(result.stdout)
    if (typeof pr?.number !== 'number') return undefined
    const checks = checksOf(pr.statusCheckRollup)
    const { number, title = '', state = '', url = '' } = pr
    return { number, title: String(title), state: String(state), url: String(url), ...(checks && { checks }) }
  } catch {
    // No gh, not signed in, no network: the tab just shows no PR.
    return undefined
  }
}

// git's own words for a folder that isn't a repo, made plain.
export function errorText(message: string, path: string) {
  if (/not a git repository/i.test(message)) return `Not a git repository: ${path}`
  return message.replace(/^fatal: /, '')
}

// The branch checked out. A repo with no commits yet still has one (unborn), which rev-parse can't name.
async function branchOf(run: Run, path: string) {
  const named = await tryGit(run, path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (named) return named
  const unborn = await tryGit(run, path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (unborn) return unborn
  // Neither: say why, in git's words.
  return (await git(run, path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

export async function repoState(run: Run, target: Target, pr?: (branch: string) => Promise<PrStatus | undefined>) {
  const state: RepoState = { target, committed: [], uncommitted: [] }
  const { path } = target
  // The user's folder was moved or deleted. The Machine is this computer for now, so the file system can tell.
  if (!existsSync(path)) return { ...state, error: `Folder not found: ${path}` }
  try {
    state.branch = await branchOf(run, path)
    // Reads that don't depend on each other run together, so a big repo's tab waits for the slowest, not the sum.
    const [upstream, hasHead, defaultBase] = await Promise.all([
      tryGit(run, path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      tryGit(run, path, ['rev-parse', '--verify', '--quiet', 'HEAD']),
      defaultBranch(run, path),
    ])
    if (state.branch === 'HEAD' && hasHead) state.detached = hasHead.slice(0, 7)
    state.upstream = upstream
    if (state.upstream) {
      const counts = await tryGit(run, path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
      const [behind, ahead] = (counts ?? '').split(/\s+/).map(Number)
      if (Number.isFinite(ahead) && Number.isFinite(behind)) Object.assign(state, { ahead, behind })
    }
    const from = target.checkout?.from
    const base = from && from !== state.branch ? from : defaultBase
    const forkPoint =
      hasHead && base && base !== state.branch ? await tryGit(run, path, ['merge-base', base, 'HEAD']) : undefined
    const [committed, tracked, untracked, prStatus] = await Promise.all([
      base && forkPoint ? git(run, path, ['diff', '--numstat', '--no-renames', forkPoint, 'HEAD']) : undefined,
      hasHead ? git(run, path, ['diff', '--numstat', '--no-renames', 'HEAD']) : '',
      git(run, path, ['ls-files', '--others', '--exclude-standard']),
      pr && state.branch && state.branch !== 'HEAD' ? pr(state.branch) : undefined,
    ])
    if (base && committed !== undefined) {
      state.base = base
      state.committed = parseNumstat(committed)
    }
    const added = untracked
      .split('\n')
      .filter(Boolean)
      .map((file) => ({ path: file, untracked: true }))
    state.uncommitted = [...parseNumstat(tracked), ...added]
    if (prStatus) state.pr = prStatus
  } catch (error) {
    state.error = errorText(error instanceof Error ? error.message : String(error), path)
  }
  return state
}

export type { Group } from './review.ts'
type Selected = { path: string; group: Group; file: string }

export async function diffOf(run: Run, state: RepoState, group: Group, file: string) {
  const { path } = state.target
  const change = state[group].find((f) => f.path === file)
  if (!change) return ''
  if (change.untracked) return git(run, path, ['diff', '--no-index', '--', '/dev/null', file], [0, 1])
  if (group === 'uncommitted') return git(run, path, ['diff', '--no-renames', 'HEAD', '--', file])
  const forkPoint = (await git(run, path, ['merge-base', state.base!, 'HEAD'])).trim()
  return git(run, path, ['diff', '--no-renames', forkPoint, 'HEAD', '--', file])
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function fileItem(state: RepoState, group: Group, file: FileChange, selected?: Selected, comments = 0): ExtensionListItem {
  const counts = file.binary ? 'binary' : file.untracked ? 'new' : `+${file.added} −${file.removed}`
  const open = selected?.path === state.target.path && selected.group === group && selected.file === file.path
  return {
    key: `${group}:${file.path}`,
    label: file.path,
    path: true,
    detail: counts,
    selected: open,
    ...(comments > 0 && { badges: [{ text: `${comments}`, tone: 'accent' as const, hint: plural(comments, 'comment') }] }),
    action: { name: 'open', value: { path: state.target.path, group, file: file.path } },
    hint: open ? 'Hide the diff' : 'Show the diff',
  }
}

const PR_TONES: Record<string, ExtensionTone> = { OPEN: 'success', MERGED: 'accent', CLOSED: 'faint' }
const CHECK_TONES: Record<NonNullable<PrStatus['checks']>, ExtensionTone> = {
  passing: 'success',
  failing: 'error',
  running: 'warning',
}

// A diff, or why it couldn't be read.
export type Diff = string | { error: string }

// What a repo's view needs besides git: the user's comments on it, and whether it offers a pop-out.
export type RepoViewOptions = { comments?: ReviewComment[]; popout?: boolean; diffKey?: string }

export const diffKeyOf = (s: Selected) => `${s.path}\n${s.group}\n${s.file}`

// The diff of the file open in a panel, with its comments and the actions to add, edit and delete them.
export function diffView(selected: Selected, diff: string, comments: ReviewComment[], fill = false): ExtensionView {
  const mine = comments.filter((c) => c.path === selected.path && c.group === selected.group && c.file === selected.file)
  return {
    type: 'diff',
    key: diffKeyOf(selected),
    text: diff,
    comments: viewComments(diffRows(diff), mine),
    comment: 'comment',
    remove: 'uncomment',
    maxLines: DIFF_MAX_LINES,
    ...(fill && { fill }),
  }
}

// A repo's header: its branch, where it stands against its upstream, and its pull request and CI.
function badgesOf(state: RepoState, comments: number): NonNullable<ExtensionListItem['badges']> {
  const { target } = state
  const badges: NonNullable<ExtensionListItem['badges']> = []
  if (state.detached) {
    badges.push({ text: `detached at ${state.detached}`, tone: 'warning', hint: 'No branch is checked out' })
  } else if (state.branch) {
    const hint = target.checkout ? undefined : 'Not checked out yet: this is the folder itself'
    badges.push({ text: state.branch, tone: 'normal', ...(hint && { hint }) })
  }
  const { upstream, ahead, behind } = state
  if (upstream) {
    if (ahead) badges.push({ text: `↑${ahead}`, hint: `${plural(ahead, 'commit')} not pushed to ${upstream}` })
    if (behind) {
      badges.push({ text: `↓${behind}`, tone: 'warning', hint: `${plural(behind, 'commit')} on ${upstream} not here` })
    }
  } else if (state.branch && state.branch !== 'HEAD') {
    badges.push({ text: 'Not pushed', tone: 'faint', hint: 'The branch has no upstream' })
  }
  if (state.pr) {
    badges.push({ text: state.pr.state.toLowerCase(), tone: PR_TONES[state.pr.state] ?? 'muted' })
    if (state.pr.checks) badges.push({ text: `CI ${state.pr.checks}`, tone: CHECK_TONES[state.pr.checks] })
  }
  if (comments) badges.push({ text: plural(comments, 'comment'), tone: 'accent', hint: 'Not sent yet' })
  return badges
}

export function repoView(state: RepoState, selected?: Selected, diff?: Diff, options: RepoViewOptions = {}): ExtensionView {
  const { target } = state
  const title = target.label ?? basename(target.folder)
  const hint = target.label ? `${title}\n${target.path}` : target.path
  const popout: ExtensionView[] = options.popout
    ? [
        {
          type: 'button',
          label: 'Pop out',
          variant: 'ghost',
          action: { name: 'popout', value: { path: target.path } },
          popup: REVIEW,
          hint: 'Open these changes in a large view, to read the diffs and comment on them',
        },
      ]
    : []
  if (state.error) {
    return { type: 'section', title, hint, children: [{ type: 'text', text: state.error, tone: 'error', small: true }] }
  }
  const comments = (options.comments ?? []).filter((c) => c.path === target.path)
  const children: ExtensionView[] = []
  if (state.pr) children.push({ type: 'link', text: `#${state.pr.number} ${state.pr.title}`, url: state.pr.url })
  const group = (name: Group, heading: string, files: FileChange[]) => {
    if (!files.length) return
    children.push({ type: 'text', text: heading, tone: 'muted', small: true })
    const shown = files.slice(0, FILES_MAX)
    const count = (file: string) => comments.filter((c) => c.group === name && c.file === file).length
    children.push({ type: 'list', label: heading, items: shown.map((f) => fileItem(state, name, f, selected, count(f.path))) })
    if (files.length > shown.length) {
      children.push({ type: 'text', text: `and ${plural(files.length - shown.length, 'more file')}`, tone: 'muted', small: true })
    }
    const open = selected?.path === target.path && selected.group === name
    if (!open || diff === undefined || !shown.some((f) => f.path === selected.file)) return
    if (typeof diff !== 'string') {
      children.push({ type: 'text', text: diff.error, tone: 'error', small: true })
      return
    }
    children.push(diff.trim() ? diffView(selected, diff, comments) : { type: 'empty', text: 'No diff' })
  }
  group('uncommitted', 'Uncommitted', state.uncommitted)
  group('committed', `Committed since ${state.base}`, state.committed)
  if (!state.uncommitted.length && !state.committed.length) children.push({ type: 'empty', text: 'No changes' })
  return { type: 'section', title, hint, badges: badgesOf(state, comments.length), buttons: popout, children }
}

// path → numstat line, and HEAD: enough to tell which files a turn touched.
type Snapshot = { head?: string; files: Map<string, string> }

async function snapshot(run: Run, path: string): Promise<Snapshot> {
  const head = await tryGit(run, path, ['rev-parse', 'HEAD'])
  const files = new Map<string, string>()
  const tracked = head ? await git(run, path, ['diff', '--numstat', '--no-renames', 'HEAD']).catch(() => '') : ''
  for (const f of parseNumstat(tracked)) files.set(f.path, `${f.added}/${f.removed}/${f.binary ?? ''}`)
  const untracked = await git(run, path, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
  for (const file of untracked.split('\n').filter(Boolean)) files.set(file, 'new')
  return { ...(head && { head }), files }
}

async function changedSince(run: Run, path: string, before: Snapshot, after: Snapshot) {
  const changed = new Set<string>()
  if (before.head && after.head && before.head !== after.head) {
    const range = [before.head, after.head]
    const committed = await git(run, path, ['diff', '--name-only', '--no-renames', ...range]).catch(() => '')
    committed.split('\n').filter(Boolean).forEach((file) => changed.add(file))
  }
  for (const [file, line] of after.files) if (before.files.get(file) !== line) changed.add(file)
  for (const file of before.files.keys()) if (!after.files.has(file)) changed.add(file)
  return changed.size
}

export function noteText(counts: { branch: string; files: number }[]) {
  const changed = counts.filter((c) => c.files > 0)
  if (!changed.length) return undefined
  const [first, ...rest] = changed
  const others = rest.map((c) => `${c.files} on ${c.branch}`)
  return [`${plural(first!.files, 'file')} changed on ${first!.branch}`, ...others].join(', ')
}

export function createGitExtension(options: { now?: () => number } = {}): Extension {
  const now = options.now ?? Date.now
  // Per chat and panel (the tab and its pop-out each have their own, keyed by keyOf): the file open, what the panel last
  // showed, so opening a file's diff draws from it instead of reading every repo again, and the diff it showed, which a
  // comment's line indexes refer to.
  const selected = new Map<string, Selected>()
  const shownDiffs = new Map<string, { selected: Selected; text: string }>()
  const prs = new Map<string, { at: number; status?: PrStatus }>()
  const before = new Map<string, Map<string, Snapshot>>()
  const shownStates = new Map<string, RepoState[]>()
  const reuse = new Set<string>()
  // Per chat, its running shell commands and edits, and when its tab was last drawn for one.
  const writing = new Map<string, Set<string>>()
  const live = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout> }>()

  const prFor = (run: Run, path: string) => async (branch: string) => {
    const key = `${path}\n${branch}`
    const cached = prs.get(key)
    if (cached && now() - cached.at < PR_TTL_MS) return cached.status
    const status = await prOf(run, path, branch)
    prs.set(key, { at: now(), ...(status && { status }) })
    return status
  }
  const forget = (host: ExtensionHost, chatId: string) => {
    for (const target of targetsOf(host, chatId)) {
      for (const key of prs.keys()) if (key.startsWith(`${target.path}\n`)) prs.delete(key)
    }
  }
  // Removes the space's checkouts whose branch is merged, once nothing in the space runs.
  const sweeping = new Set<string>()
  const repoSweeps = new Map<string, Promise<unknown>>()
  const sweep = async (host: ExtensionHost, chat: ChatDetail) => {
    const space = host.space(chat.id) ?? (chat.parentId === undefined ? undefined : host.space(chat.parentId))
    if (!space || sweeping.has(space.id)) return
    const idle = () => host.chats().every((c) => (c.id !== space.id && c.parentId !== space.id) || c.status === 'idle')
    if (!idle()) return
    sweeping.add(space.id)
    try {
      for (const checkout of space.checkouts) {
        if (!existsSync(checkout.path)) continue
        // One checkout git won't remove doesn't stop the others, or the turn's hook.
        const result = await cleanupCheckout(host.run, checkout, space.workDir, idle).catch(() => undefined)
        if (!result?.removed) continue
        const where = space.checkouts.length > 1 ? ` in ${basename(checkout.folder)}` : ''
        const kept = result.branchKept ? `; its branch ${result.branch} stays, since git wouldn’t delete it` : ''
        const text = `Removed the checkout of ${result.branch}${where}: ${result.reason}${kept}`
        if (host.chat(space.id)) host.note(space.id, text, { panel: PANEL })
        forget(host, space.id)
        host.refresh(space.id)
      }
      // Other worktrees in the work folder, one repo at a time across spaces, since they share its worktree list.
      await Promise.all(
        [...new Set(space.checkouts.map((c) => c.folder))].map((folder) => {
          const one = { ...space, checkouts: space.checkouts.filter((c) => c.folder === folder) }
          const swept = (repoSweeps.get(folder) ?? Promise.resolve())
            .then(() => cleanupStrayWorktrees(host.run, one, idle))
            .catch(() => [])
            .finally(() => repoSweeps.get(folder) === swept && repoSweeps.delete(folder))
          repoSweeps.set(folder, swept)
          return swept
        }),
      )
    } finally {
      sweeping.delete(space.id)
    }
  }
  const cleansUp = (values: ExtensionValues) => values.cleanup === true

  // A turn of the space or one of its workers shows in the space's tab and its own.
  const refreshAround = (host: ExtensionHost, chat: ChatDetail) => {
    host.refresh(chat.id)
    if (chat.parentId && host.chat(chat.parentId)) host.refresh(chat.parentId)
  }
  // An agent's commit or edit shows during a long turn too, not only once it ends: drawn at once, then at most every
  // LIVE_REFRESH_MS, with the last one always drawn. host.refresh draws only tabs that are open.
  const refreshLive = (host: ExtensionHost, chat: ChatDetail) => {
    const last = live.get(chat.id) ?? { at: -Infinity }
    live.set(chat.id, last)
    if (last.timer) return
    const wait = last.at + LIVE_REFRESH_MS - now()
    const draw = () => {
      delete last.timer
      last.at = now()
      if (host.chat(chat.id)) refreshAround(host, chat)
    }
    if (wait <= 0) draw()
    else last.timer = setTimeout(draw, wait)
  }
  const stopLive = (chatId: string) => {
    clearTimeout(live.get(chatId)?.timer)
    live.delete(chatId)
    writing.delete(chatId)
  }

  const keyOf = (chatId: string, panel: string) => `${chatId}\n${panel}`

  const readDiff = (host: ExtensionHost, state: RepoState, pick: Selected): Promise<Diff> =>
    diffOf(host.run, state, pick.group, pick.file).catch((e) => ({
      error: `Couldn’t read the diff: ${errorText(String(e?.message ?? e), state.target.path)}`,
    }))

  // What a panel shows: every repo's state (kept from its last draw after a click that only opens a file), the file open
  // and its diff.
  const panelState = async (host: ExtensionHost, chat: ChatDetail, panel: string) => {
    const key = keyOf(chat.id, panel)
    const targets = targetsOf(host, chat.id)
    const kept = reuse.delete(key) ? shownStates.get(key) : undefined
    const same = kept?.length === targets.length && kept.every((s, i) => s.target.path === targets[i]!.path)
    const states = kept && same ? kept : await Promise.all(targets.map((t) => repoState(host.run, t, prFor(host.run, t.path))))
    shownStates.set(key, states)
    let pick = selected.get(key)
    const picked = pick && states.find((s) => s.target.path === pick!.path)
    // A file that left its group (committed, reverted, its checkout gone) closes.
    if (pick && !picked?.[pick.group].some((f) => f.path === pick!.file)) {
      selected.delete(key)
      pick = undefined
    }
    const diff = picked && pick ? await readDiff(host, picked, pick) : undefined
    if (pick && typeof diff === 'string') shownDiffs.set(key, { selected: pick, text: diff })
    else shownDiffs.delete(key)
    return { states, pick, picked: pick ? picked : undefined, diff }
  }

  // Comments live in the space's folder, so the space and its workers' tabs share them.
  const storageOf = (host: ExtensionHost, chatId: string) => {
    const space = host.space(chatId)
    return space ? host.chatStorage(space.id) : undefined
  }
  // The comments on the repos this chat's panels show.
  const commentsFor = (host: ExtensionHost, chatId: string, states: RepoState[]) => {
    const storage = storageOf(host, chatId)
    if (!storage) return []
    const paths = new Set(states.map((s) => s.target.path))
    return loadComments(storage).filter((c) => paths.has(c.path))
  }
  const sendButton = (count: number): ExtensionView[] =>
    count
      ? [
          {
            type: 'button',
            label: `Send ${plural(count, 'comment')}`,
            variant: 'primary',
            action: { name: 'send' },
            hint: 'Send every comment to the space’s agent in one message, asking it to apply them. It waits behind a running turn.',
          },
        ]
      : []

  // Who the comments are about, for the message: each repo's name and branch, and the worker whose worktree it is.
  const reviewTargets = (host: ExtensionHost, chatId: string, states: RepoState[]): ReviewTarget[] => {
    const workers = host.space(chatId)?.workerCheckouts ?? []
    return states.map((s) => {
      const worker = workers.find((w) => w.path === s.target.path)
      const branch = s.detached ? undefined : s.branch
      return { path: s.target.path, repo: basename(s.target.folder), ...(branch && { branch }), ...(worker && { worker: worker.name }) }
    })
  }

  // Draws both panels of every chat in the space again: a comment shows in the tab and the pop-out, the space's and its
  // workers'.
  const redrawSpace = (host: ExtensionHost, chatId: string) => {
    const space = host.space(chatId)
    const ids = new Set([chatId, ...(space ? [space.id] : []), ...host.chats().filter((c) => space && c.parentId === space.id).map((c) => c.id)])
    for (const id of ids) {
      for (const panel of [PANEL, REVIEW]) reuse.add(keyOf(id, panel))
      if (host.chat(id)) host.refresh(id)
    }
  }

  const panelAction = async (action: ExtensionAction, chat: ChatDetail, { host, values }: ExtensionContext, panel: string) => {
    const key = keyOf(chat.id, panel)
    if (action.name === 'refresh') {
      forget(host, chat.id)
      if (cleansUp(values)) await sweep(host, chat)
      // The other panel reads git again too, next time it draws.
      host.refresh(chat.id)
      return
    }
    if (action.name === 'popout') {
      // The tab's Pop out: the pop-out opens on the file open in the tab, else on the first of the repo it was for.
      const path = (action.value as { path?: unknown } | null)?.path
      const tab = selected.get(keyOf(chat.id, PANEL))
      const into = keyOf(chat.id, REVIEW)
      if (tab && (path === undefined || tab.path === path)) selected.set(into, tab)
      else if (typeof path === 'string') {
        const state = shownStates.get(key)?.find((s) => s.target.path === path)
        const group = state?.uncommitted.length ? 'uncommitted' : 'committed'
        const file = state?.[group][0]
        if (file) selected.set(into, { path, group, file: file.path })
        else selected.delete(into)
      }
      reuse.add(key)
      host.refresh(chat.id)
      return
    }
    if (action.name === 'open') {
      const value = action.value as { path?: unknown; group?: unknown; file?: unknown } | null
      const { path, group, file } = value ?? {}
      const known = group === 'uncommitted' || group === 'committed'
      if (typeof path !== 'string' || typeof file !== 'string' || !known) return
      const open = selected.get(key)
      const same = open?.path === path && open.group === group && open.file === file
      // In the pop-out a file stays open; the tab's second click folds its diff away.
      if (same && panel === PANEL) selected.delete(key)
      else selected.set(key, { path, group, file })
      reuse.add(key)
      return
    }
    const storage = storageOf(host, chat.id)
    if (!storage) return
    if (action.name === 'comment') {
      const value = action.value as { id?: unknown; start?: unknown; end?: unknown; text?: unknown } | null
      const text = typeof value?.text === 'string' ? value.text.trim() : ''
      if (!text) return
      const comments = loadComments(storage)
      if (typeof value?.id === 'string') {
        const found = comments.find((c) => c.id === value.id)
        if (!found) return
        found.text = text
      } else {
        const shown = shownDiffs.get(key)
        if (!shown) throw new Error('That diff isn’t open any more')
        const at = anchorOf(diffRows(shown.text), Number(value?.start), Number(value?.end))
        if (!at) throw new Error('Those lines can’t take a comment')
        const id = `c${host.now().getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        comments.push({ id, ...shown.selected, ...at, text, at: host.now().toISOString() })
      }
      saveComments(storage, comments)
      redrawSpace(host, chat.id)
      return
    }
    if (action.name === 'uncomment') {
      const comments = loadComments(storage)
      const left = comments.filter((c) => c.id !== action.value)
      if (left.length === comments.length) return
      saveComments(storage, left)
      redrawSpace(host, chat.id)
      return
    }
    if (action.name === 'send') {
      const space = host.space(chat.id)
      if (!space) return
      const states = shownStates.get(key) ?? []
      const paths = new Set(states.map((s) => s.target.path))
      const all = loadComments(storage)
      const sending = all.filter((c) => paths.has(c.path))
      if (!sending.length) return
      // As the composer's Option+Enter: queued behind a running turn, else sent now. Workers' comments go to the space's
      // agent too, since a worker takes no messages; the message says whose worktree they're about.
      host.send(space.id, reviewMessage(sending, reviewTargets(host, chat.id, states)))
      storage.append(SENT_FILE, `${JSON.stringify({ at: host.now().toISOString(), comments: sending })}\n`)
      saveComments(storage, all.filter((c) => !paths.has(c.path)))
      redrawSpace(host, chat.id)
    }
  }

  return {
    id: 'git',
    name: 'Git',
    description:
      'A Changes tab for spaces with git folders: each checkout’s branch, how far it is from its upstream, the files ' +
      'changed with their diffs, and its pull request if gh is signed in. Read-only.',
    enabledByDefault: false,
    settings: [
      {
        key: 'cleanup',
        label: 'Remove merged checkouts',
        description:
          'After a turn, a space’s checkout goes, with its local branch, once the branch’s pull request is merged or ' +
          'the branch is merged into the default branch and deleted on the remote. Never your own checkout, one with ' +
          'uncommitted changes, or one in use by a running chat. The next message makes a fresh checkout. Other ' +
          'worktrees an agent made in the space’s work folder go too, once their branch is merged and deleted on the remote.',
        type: 'boolean',
        default: true,
      },
    ],
    panels: [
      {
        id: PANEL,
        title: 'Changes',
        shown: (chat, { host }) => chat.keepsContext && targetsOf(host, chat.id).length > 0,
        async render(chat, { host }) {
          const { states, pick, picked, diff } = await panelState(host, chat, PANEL)
          const comments = commentsFor(host, chat.id, states)
          const top: ExtensionView[] = [
            ...sendButton(comments.length),
            {
              type: 'button',
              label: 'Pop out',
              variant: 'ghost',
              action: { name: 'popout' },
              popup: REVIEW,
              hint: 'Open the changes in a large view, to read the diffs and comment on them',
            },
            {
              type: 'button',
              label: 'Refresh',
              variant: 'ghost',
              action: { name: 'refresh' },
              hint: 'Look at git and the pull requests again',
            },
          ]
          return {
            type: 'stack',
            gap: 'normal',
            children: [
              { type: 'row', justify: 'end', children: top },
              ...states.map((s) =>
                repoView(s, pick, s === picked ? diff : undefined, { comments, popout: states.length > 1 }),
              ),
            ],
          }
        },
        async onAction(action, chat, context) {
          await panelAction(action, chat, context, PANEL)
        },
      },
      {
        id: REVIEW,
        title: 'Changes',
        placement: 'popup',
        shown: (chat, { host }) => chat.keepsContext && targetsOf(host, chat.id).length > 0,
        async render(chat, { host }) {
          let { states, pick, picked, diff } = await panelState(host, chat, REVIEW)
          // The pop-out always shows a file when there is one: the first of the repo it was opened for, else of any.
          if (!pick) {
            const first = states.flatMap((s) =>
              (['uncommitted', 'committed'] as const).flatMap((group) =>
                s[group].slice(0, 1).map((f) => ({ state: s, pick: { path: s.target.path, group, file: f.path } })),
              ),
            )[0]
            if (first) {
              pick = first.pick
              picked = first.state
              selected.set(keyOf(chat.id, REVIEW), pick)
              diff = await readDiff(host, picked, pick)
              if (typeof diff === 'string') shownDiffs.set(keyOf(chat.id, REVIEW), { selected: pick, text: diff })
            }
          }
          const comments = commentsFor(host, chat.id, states)
          const side: ExtensionView = {
            type: 'stack',
            gap: 'normal',
            children: [
              {
                type: 'row',
                children: [
                  ...sendButton(comments.length),
                  { type: 'button', label: 'Refresh', variant: 'ghost', action: { name: 'refresh' }, hint: 'Look at git and the pull requests again' },
                ],
              },
              ...states.map((s) => repoView(s, pick, undefined, { comments })),
            ],
          }
          const main: ExtensionView =
            pick && picked
              ? {
                  type: 'stack',
                  gap: 'tight',
                  children: [
                    { type: 'text', text: pick.file, mono: true, hint: `${picked.target.label ?? basename(picked.target.folder)} · ${pick.group}` },
                    typeof diff === 'object'
                      ? { type: 'text', text: diff.error, tone: 'error', small: true }
                      : diff?.trim()
                        ? diffView(pick, diff, comments, true)
                        : { type: 'empty', text: 'No diff' },
                  ],
                }
              : { type: 'empty', text: 'No changes' }
          return { type: 'split', side, main }
        },
        async onAction(action, chat, context) {
          await panelAction(action, chat, context, REVIEW)
        },
      },
    ],
    async onTurnStarted({ chat }, { host }) {
      if (!chat.keepsContext || chat.worker) return
      const shots = new Map<string, Snapshot>()
      for (const target of targetsOf(host, chat.id)) shots.set(target.path, await snapshot(host.run, target.path))
      before.set(chat.id, shots)
    },
    onEvent(chat, event, { host }) {
      if (!chat.keepsContext) return
      if (event.type === 'tool.started' && (event.kind === 'shell' || event.kind === 'edit')) {
        const ids = writing.get(chat.id) ?? new Set()
        writing.set(chat.id, ids.add(event.toolId))
      } else if (event.type === 'tool.completed' && writing.get(chat.id)?.delete(event.toolId)) {
        refreshLive(host, chat)
      }
    },
    async onTurnCompleted({ chat }, { host, values }) {
      if (!chat.keepsContext) return
      stopLive(chat.id)
      const shots = before.get(chat.id)
      before.delete(chat.id)
      forget(host, chat.id)
      if (!chat.worker && shots) {
        const counts: { branch: string; files: number }[] = []
        for (const target of targetsOf(host, chat.id)) {
          const after = await snapshot(host.run, target.path)
          // A checkout made during the turn started clean, from its folder's last commit.
          const head = shots.get(target.folder)?.head
          const start = shots.get(target.path) ?? { ...(head && { head }), files: new Map() }
          const files = await changedSince(host.run, target.path, start, after)
          const current = await tryGit(host.run, target.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
          counts.push({ branch: current ?? target.checkout?.branch ?? basename(target.folder), files })
        }
        const text = noteText(counts)
        if (text && host.chat(chat.id)) host.note(chat.id, text, { panel: PANEL })
      }
      if (host.chat(chat.id)) refreshAround(host, chat)
      else if (chat.parentId && host.chat(chat.parentId)) host.refresh(chat.parentId)
      if (cleansUp(values)) await sweep(host, chat)
    },
    onChatRemoved(chat) {
      for (const panel of [PANEL, REVIEW]) {
        const key = keyOf(chat.id, panel)
        selected.delete(key)
        shownStates.delete(key)
        shownDiffs.delete(key)
        reuse.delete(key)
      }
      before.delete(chat.id)
      stopLive(chat.id)
    },
    // The core removes a deleted space's checkouts; what's cached about them goes too.
    onSpaceRemoved(space) {
      for (const { path } of space.checkouts) {
        for (const key of prs.keys()) if (key.startsWith(`${path}\n`)) prs.delete(key)
      }
    },
    onStop() {
      for (const chatId of [...live.keys()]) stopLive(chatId)
    },
  }
}

export default createGitExtension()
