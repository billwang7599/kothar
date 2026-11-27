// Workers' own checkouts: a worker in a space with git folders works on a branch of its own, in a worktree of its own
// in the space's work folder (<work>/<space>/workers/<worker id>/<repo>), so workers running side by side never edit
// the same files. Each is made in code from the space checkout's current commit, before the worker's first session
// (design rule 10), and the space's optional setup script runs in it then.
//
// A worker is removed once it reports, so what its branch holds is kept on the space, not the worker: chat.json's
// `workerBranches`, by worker id. While the worker runs the entry is `working`; once it's gone, an entry with changes
// waits for review (`review`, or `kept` once the user says to leave it), and one without any is removed with its
// worktree and branch. Review is Merge (or Squash) into the space's branch, Discard, or Keep. Nothing here deletes
// work nobody saw: Merge commits what's uncommitted first, Discard is only ever asked for, and deleting the space
// commits what's left on each branch and keeps every branch with commits of its own.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatInfo, Machine, WorkerBranch, WorkerRepo, WorkerRepoChanges, Worktree } from './shared.ts'
import { freeName } from './checkouts.ts'
import { messageOf } from './util.ts'

const GIT_TIMEOUT_MS = 120_000
export const SETUP_TIMEOUT_MS = 15 * 60_000
// How much of a setup script's output its note keeps: the end, where errors are.
export const SETUP_OUTPUT_MAX_CHARS = 4000
export const WORKERS_DIR = 'workers'
const SLUG_MAX_CHARS = 30
// Who commits a worker's leftovers when the repo names nobody.
const FALLBACK_IDENTITY = ['-c', 'user.name=Kothar', '-c', 'user.email=kothar@localhost']

export type MergeHow = 'merge' | 'squash'
export type ReviewAction = MergeHow | 'discard' | 'keep'
export const REVIEW_ACTIONS = ['merge', 'squash', 'discard', 'keep'] as const satisfies readonly ReviewAction[]
export const isReviewAction = (value: unknown): value is ReviewAction => REVIEW_ACTIONS.includes(value as ReviewAction)

/** What the worker checkouts need of a space: its saved info, kept with updateSpace. */
type Space = { info: ChatInfo }
type Worker = { info: Pick<ChatInfo, 'id' | 'name'> }

export type MergeResult = { merged: string[]; conflicts: { folder: string; files: string[] }[]; unchanged: string[] }

const slugOf = (text: string, fallback: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, SLUG_MAX_CHARS).replace(/^-|-$/g, '') || fallback

/** The changes summed over a worker's repos. */
export const totalsOf = (changes: WorkerRepoChanges[] = []) =>
  changes.reduce(
    (sum, c) => ({
      files: sum.files + c.files,
      added: sum.added + c.added,
      removed: sum.removed + c.removed,
      uncommitted: sum.uncommitted + c.uncommitted,
      commits: sum.commits + c.commits,
    }),
    { files: 0, added: 0, removed: 0, uncommitted: 0, commits: 0 },
  )

export const hasChanges = (changes: WorkerRepoChanges[] = []) => changes.some((c) => c.files > 0 || c.commits > 0 || c.uncommitted > 0)

/** One line per repo, as the lead reads it in a worker's report and the review card shows it. */
export function changesText(branch: Pick<WorkerBranch, 'repos' | 'changes'>) {
  return (branch.changes ?? []).map((c) => {
    const repo = branch.repos.find((r) => r.folder === c.folder)
    const parts = [
      `${c.files} file${c.files === 1 ? '' : 's'} changed (+${c.added} −${c.removed})`,
      `${c.commits} commit${c.commits === 1 ? '' : 's'}`,
      ...(c.uncommitted ? [`${c.uncommitted} uncommitted`] : []),
    ]
    return `- ${c.folder}: ${parts.join(', ')}, on branch ${repo?.branch ?? '?'} (into ${repo?.into ?? '?'})`
  })
}

export function openWorkerCheckouts<S extends Space>(deps: {
  machine: Pick<Machine, 'run'>
  now: () => Date
  /** Saves the space's workerBranches in its chat.json (and tells the window). */
  saveBranches: (space: S, branches: Record<string, WorkerBranch> | undefined) => void
}) {
  const { machine, now, saveBranches } = deps

  const run = async (folder: string, args: string[], ok = [0]) => {
    const { code, stdout, stderr } = await machine.run('git', ['-C', folder, ...args], { cwd: folder, timeoutMs: GIT_TIMEOUT_MS })
    if (!ok.includes(code ?? -1)) throw new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`)
    return stdout.trim()
  }
  const tryRun = (folder: string, args: string[]) => run(folder, args).catch(() => undefined)

  const branchesOf = (space: S) => space.info.workerBranches ?? {}
  const save = (space: S, id: string, entry: WorkerBranch | undefined) => {
    const { [id]: _, ...rest } = branchesOf(space)
    const next = entry ? { ...rest, [id]: entry } : rest
    saveBranches(space, Object.keys(next).length ? next : undefined)
  }

  const identity = async (path: string) => ((await tryRun(path, ['config', 'user.email'])) ? [] : FALLBACK_IDENTITY)

  // Commits whatever is uncommitted in the worker's worktree to its branch, so nothing is lost when it goes.
  const commitLeftovers = async (repo: WorkerRepo, message: string) => {
    if (!existsSync(repo.path)) return false
    const status = await run(repo.path, ['status', '--porcelain'])
    if (!status) return false
    await run(repo.path, ['add', '-A'])
    await run(repo.path, [...(await identity(repo.path)), 'commit', '-q', '--no-verify', '-m', message])
    return true
  }

  const removeWorktree = async (repo: WorkerRepo, dropBranch: boolean) => {
    await tryRun(repo.folder, ['worktree', 'remove', '--force', repo.path])
    if (existsSync(repo.path)) rmSync(repo.path, { recursive: true, force: true })
    await tryRun(repo.folder, ['worktree', 'prune'])
    if (dropBranch) await tryRun(repo.folder, ['branch', '-D', repo.branch])
  }

  /** What the worker changed in one repo since its branch was made: committed and not. */
  const changesOfRepo = async (repo: WorkerRepo): Promise<WorkerRepoChanges> => {
    const none = { folder: repo.folder, files: 0, added: 0, removed: 0, uncommitted: 0, commits: 0 }
    // A worktree that's gone: its branch still says what was committed.
    const at = existsSync(repo.path) ? repo.path : repo.folder
    if (!(await tryRun(repo.folder, ['rev-parse', '--verify', '--quiet', `refs/heads/${repo.branch}`]))) return none
    const commits = Number(await run(repo.folder, ['rev-list', '--count', `${repo.base}..${repo.branch}`])) || 0
    // Against the base: committed and uncommitted tracked changes in the worktree, else the branch's own commits.
    const numstat = existsSync(repo.path)
      ? await run(at, ['diff', '--numstat', repo.base])
      : await run(at, ['diff', '--numstat', repo.base, repo.branch])
    const untracked = existsSync(repo.path) ? (await run(at, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean) : []
    const uncommitted = existsSync(repo.path) ? (await run(at, ['status', '--porcelain'])).split('\n').filter(Boolean).length : 0
    let added = 0
    let removed = 0
    const lines = numstat.split('\n').filter(Boolean)
    for (const line of lines) {
      const [a, r] = line.split('\t')
      added += Number(a) || 0
      removed += Number(r) || 0
    }
    return { folder: repo.folder, files: lines.length + untracked.length, added, removed, uncommitted, commits }
  }

  const changesOf = async (entry: WorkerBranch) => Promise.all(entry.repos.map((repo) => changesOfRepo(repo)))

  return {
    /**
     * The worker's own worktree of folder, made now from the space checkout's current commit if it has none.
     * made: whether it was made just now (so the space's setup script runs in it).
     */
    async checkoutOf(space: S, worker: Worker, folder: string, spaceCheckout: Worktree, workDir: string): Promise<{ worktree: Worktree; made: boolean }> {
      const id = worker.info.id
      const entry: WorkerBranch = branchesOf(space)[id] ?? {
        name: worker.info.name,
        createdAt: now().toISOString(),
        state: 'working',
        repos: [],
      }
      const saved = entry.repos.find((r) => r.folder === folder)
      if (saved && existsSync(saved.path)) return { worktree: { path: saved.path, branch: saved.branch, from: saved.into }, made: false }
      try {
        const base = await run(spaceCheckout.path, ['rev-parse', 'HEAD'])
        const branches = (await run(folder, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).split('\n')
        let repo: WorkerRepo
        if (saved && branches.includes(saved.branch)) {
          // The worktree went (deleted by hand); its branch is still there, so it's checked out again.
          await run(folder, ['worktree', 'prune'])
          mkdirSync(join(saved.path, '..'), { recursive: true })
          await run(folder, ['worktree', 'add', saved.path, saved.branch])
          repo = saved
        } else {
          const spaceSlug = slugOf(space.info.name, 'space')
          const branch = freeName(`kothar-worker/${spaceSlug}/${id}-${slugOf(worker.info.name, 'task')}`, (b) => branches.includes(b))
          const taken = entry.repos.map((r) => r.path)
          const path = freeName(join(workDir, basename(folder)), (p) => taken.includes(p) || existsSync(p))
          mkdirSync(workDir, { recursive: true })
          await run(folder, ['worktree', 'add', '--no-track', '-b', branch, path, base])
          repo = { folder, path, branch, base, into: spaceCheckout.branch }
        }
        save(space, id, { ...entry, state: 'working', repos: [...entry.repos.filter((r) => r.folder !== folder), repo] })
        return { worktree: { path: repo.path, branch: repo.branch, from: repo.into }, made: !saved }
      } catch (error) {
        throw new Error(`Couldn't make a worktree of ${folder} for this worker: ${messageOf(error)}`)
      }
    },

    /** Runs the space's setup script in a worktree just made. Throws with the end of its output when it fails. */
    async runSetup(script: string, path: string) {
      const { code, stdout, stderr } = await machine.run('/bin/sh', ['-c', script], { cwd: path, timeoutMs: SETUP_TIMEOUT_MS })
      const output = `${stdout}${stderr ? `${stdout ? '\n' : ''}${stderr}` : ''}`.trimEnd()
      const tail = output.length > SETUP_OUTPUT_MAX_CHARS ? `…${output.slice(-SETUP_OUTPUT_MAX_CHARS)}` : output
      return { ok: code === 0, code, output: tail }
    },

    /** The worker's changes so far, saved on its entry. Undefined for a worker without its own checkouts. */
    async summarize(space: S, workerId: string) {
      const entry = branchesOf(space)[workerId]
      if (!entry) return undefined
      const changes = await changesOf(entry)
      const current = branchesOf(space)[workerId]
      if (current) save(space, workerId, { ...current, changes })
      return { ...entry, changes }
    },

    /**
     * The worker is gone (it reported, was deleted, or a restart dropped it): its entry waits for review, or goes with
     * its worktrees and branches when it changed nothing.
     */
    async settle(space: S, workerId: string) {
      const entry = branchesOf(space)[workerId]
      if (!entry || entry.state !== 'working') return entry
      const changes = await changesOf(entry).catch(() => entry.changes ?? [])
      if (!hasChanges(changes)) {
        for (const repo of entry.repos) await removeWorktree(repo, true)
        save(space, workerId, undefined)
        return undefined
      }
      const settled: WorkerBranch = { ...entry, state: 'review', changes }
      save(space, workerId, settled)
      return settled
    },

    /**
     * Merges the worker's branches into the space's, each in the space's checkout of that folder. What the worker
     * left uncommitted is committed first. A repo that conflicts is left as it was (the merge undone) and reported;
     * the others merge, and their worktree and branch go.
     */
    async merge(space: S, workerId: string, how: MergeHow): Promise<MergeResult> {
      const entry = branchesOf(space)[workerId]
      if (!entry) throw new Error('That worker has no changes waiting')
      if (entry.state === 'working') throw new Error('That worker is still running. Stop it first, or wait for its report')
      const result: MergeResult = { merged: [], conflicts: [], unchanged: [] }
      const left: WorkerRepo[] = []
      for (const repo of entry.repos) {
        const target = space.info.worktrees?.[repo.folder]
        if (!target || !existsSync(target.path)) {
          throw new Error(`The space's checkout of ${repo.folder} is gone. Send the space a message to check it out again, then merge`)
        }
        if (await run(target.path, ['status', '--porcelain', '--untracked-files=no'])) {
          throw new Error(`The space's checkout of ${repo.folder} (${target.path}) has uncommitted changes. Commit or stash them first`)
        }
        await commitLeftovers(repo, `${entry.name}: work left uncommitted`)
        const ahead = Number(await run(target.path, ['rev-list', '--count', `HEAD..${repo.branch}`])) || 0
        if (!ahead) {
          result.unchanged.push(repo.folder)
          await removeWorktree(repo, true)
          continue
        }
        const ids = await identity(target.path)
        try {
          if (how === 'squash') {
            await run(target.path, [...ids, 'merge', '--squash', repo.branch])
            await run(target.path, [...ids, 'commit', '-q', '--no-verify', '-m', entry.name])
          } else {
            await run(target.path, [...ids, 'merge', '--no-ff', '--no-edit', '-m', `Merge worker "${entry.name}"`, repo.branch])
          }
          result.merged.push(repo.folder)
          await removeWorktree(repo, true)
        } catch (error) {
          const files = ((await tryRun(target.path, ['diff', '--name-only', '--diff-filter=U'])) ?? '').split('\n').filter(Boolean)
          await tryRun(target.path, how === 'squash' ? ['reset', '--merge'] : ['merge', '--abort'])
          result.conflicts.push({ folder: repo.folder, files: files.length ? files : [messageOf(error)] })
          left.push(repo)
        }
      }
      if (left.length) {
        const changes = await changesOf({ ...entry, repos: left }).catch(() => entry.changes)
        save(space, workerId, { ...entry, state: 'review', repos: left, ...(changes && { changes }) })
      } else save(space, workerId, undefined)
      return result
    },

    /** Removes the worker's worktrees and branches, and whatever they held. Only on the user's say. */
    async discard(space: S, workerId: string) {
      const entry = branchesOf(space)[workerId]
      if (!entry) throw new Error('That worker has no changes waiting')
      if (entry.state === 'working') throw new Error('That worker is still running. Stop it first, or wait for its report')
      for (const repo of entry.repos) await removeWorktree(repo, true)
      save(space, workerId, undefined)
    },

    /** Leaves the worker's branches as they are, out of the way, for the user to deal with later. */
    keep(space: S, workerId: string) {
      const entry = branchesOf(space)[workerId]
      if (!entry) throw new Error('That worker has no changes waiting')
      if (entry.state === 'working') throw new Error('That worker is still running')
      save(space, workerId, { ...entry, state: 'kept' })
    },

    /**
     * The space is being deleted: each worker's worktree goes, after what it left uncommitted is committed to its
     * branch. A branch with commits of its own stays in the repo; one without goes.
     */
    async removeAll(space: S) {
      for (const entry of Object.values(branchesOf(space))) {
        for (const repo of entry.repos) {
          await commitLeftovers(repo, `${entry.name}: work left uncommitted`).catch(() => false)
          const ahead = Number(await tryRun(repo.folder, ['rev-list', '--count', `${repo.base}..${repo.branch}`])) || 0
          await removeWorktree(repo, ahead === 0)
        }
      }
    },
  }
}

export type WorkerCheckouts = ReturnType<typeof openWorkerCheckouts>

const ACTION_DONE: Record<ReviewAction, string> = { merge: 'Merged', squash: 'Squashed', discard: 'Discarded', keep: 'Kept' }

/** What a review did, as the space's note and the lead's tool result say it. */
export function reviewText(name: string, action: ReviewAction, into: string[], result?: MergeResult) {
  if (action === 'discard') return `Discarded worker "${name}"'s changes, with its worktrees and branches.`
  if (action === 'keep') return `Kept worker "${name}"'s branches as they are, for later.`
  const lines: string[] = []
  // Folders by name: their paths are in the Changes tab, and a note is read at a glance.
  const names = (folders: string[]) => folders.map((f) => basename(f)).join(', ')
  if (result?.merged.length) {
    lines.push(`${ACTION_DONE[action]} worker "${name}"'s changes into ${[...new Set(into)].join(', ')} (${names(result.merged)}).`)
  }
  if (result?.unchanged.length) lines.push(`Nothing new to merge in ${names(result.unchanged)}.`)
  for (const { folder, files } of result?.conflicts ?? []) {
    lines.push(`${basename(folder)} conflicts, so it was left as it was (the merge undone), its branch waiting: ${files.join(', ')}.`)
  }
  return lines.join('\n') || `Nothing to merge from worker "${name}".`
}

/** A worker's own folder in its space's work folder, where its worktrees go. */
export const workerWorkDirOf = (spaceWorkDir: string, workerId: string) => join(spaceWorkDir, WORKERS_DIR, workerId)
