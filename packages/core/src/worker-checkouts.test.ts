import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCheckouts } from './checkouts.ts'
import { localMachine } from './machine.ts'
import type { ChatInfo, WorkerBranch } from './shared.ts'
import { changesText, openWorkerCheckouts, totalsOf, workerWorkDirOf } from './worker-checkouts.ts'

const temps: string[] = []
afterEach(() => temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-worker-checkouts-')))
  temps.push(dir)
  return dir
}

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    encoding: 'utf8',
  }).trim()
const gitRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(dir, 'README.md'), 'one\ntwo\nthree\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'first')
  return dir
}
const branchesOf = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n')

type Space = { info: ChatInfo }
const worker = (id: string, name = 'Fix the bug') => ({ info: { id, name } })

// A space with one git folder checked out in its work folder, and the worker checkouts over it, in plain test state.
async function setup() {
  const root = tempDir()
  const repo = gitRepo(join(root, 'repo'))
  const workDir = join(root, 'work', 'abc123')
  mkdirSync(workDir, { recursive: true })
  const space: Space = { info: { id: 'abc123', name: 'My Space', folders: [repo], files: [], workDir } as unknown as ChatInfo }
  const spaceCheckouts = openCheckouts<Space>({
    machine: localMachine,
    saveWorktrees: (s, worktrees) => {
      s.info.worktrees = worktrees
    },
  })
  const { worktree: spaceTree } = await spaceCheckouts.checkoutOf(space, repo, workDir, false)
  const workers = openWorkerCheckouts<Space>({
    machine: localMachine,
    now: () => new Date('2026-11-26T12:00:00Z'),
    saveBranches: (s, branches) => {
      if (branches) s.info.workerBranches = branches
      else delete s.info.workerBranches
    },
  })
  const checkout = (id: string, name?: string) => workers.checkoutOf(space, worker(id, name), repo, spaceTree, workerWorkDirOf(workDir, id))
  return { root, repo, workDir, space, spaceTree, workers, checkout }
}

describe('worker checkouts', () => {
  it("makes a worker's own worktree on a branch of its own from the space checkout's commit, once", async () => {
    const { repo, workDir, space, spaceTree, checkout } = await setup()
    writeFileSync(join(spaceTree.path, 'space.txt'), 'space\n')
    git(spaceTree.path, 'add', '-A')
    git(spaceTree.path, 'commit', '-q', '-m', 'space work')

    const first = await checkout('w1')
    expect(first.made).toBe(true)
    expect(first.worktree.path).toBe(join(workDir, 'workers', 'w1', 'repo'))
    expect(first.worktree.branch).toBe('kothar-worker/my-space/w1-fix-the-bug')
    expect(first.worktree.from).toBe(spaceTree.branch)
    // From the space checkout's commit, not the folder's.
    expect(existsSync(join(first.worktree.path, 'space.txt'))).toBe(true)
    const entry = space.info.workerBranches!.w1!
    expect(entry).toMatchObject({ name: 'Fix the bug', state: 'working', repos: [{ folder: repo, into: spaceTree.branch }] })
    expect(entry.repos[0]!.base).toBe(git(spaceTree.path, 'rev-parse', 'HEAD'))

    const again = await checkout('w1')
    expect(again).toEqual({ worktree: first.worktree, made: false })
  })

  it('gives two workers separate worktrees and branches', async () => {
    const { repo, checkout } = await setup()
    const a = await checkout('w1', 'Same task')
    const b = await checkout('w2', 'Same task')
    expect(a.worktree.path).not.toBe(b.worktree.path)
    expect(a.worktree.branch).not.toBe(b.worktree.branch)
    expect(branchesOf(repo)).toEqual(expect.arrayContaining([a.worktree.branch, b.worktree.branch]))
  })

  it('a worker that changed nothing leaves no worktree, branch or entry once it goes', async () => {
    const { repo, space, workers, checkout } = await setup()
    const { worktree } = await checkout('w1')
    expect(await workers.settle(space, 'w1')).toBeUndefined()
    expect(existsSync(worktree.path)).toBe(false)
    expect(branchesOf(repo)).not.toContain(worktree.branch)
    expect(space.info.workerBranches).toBeUndefined()
  })

  it("a worker's changes, committed and not, wait for review once it goes", async () => {
    const { repo, space, workers, checkout } = await setup()
    const { worktree } = await checkout('w1')
    writeFileSync(join(worktree.path, 'README.md'), 'one\nTWO\nthree\nfour\n')
    git(worktree.path, 'commit', '-q', '-am', 'edit')
    writeFileSync(join(worktree.path, 'new.txt'), 'new\n')

    const summed = await workers.summarize(space, 'w1')
    expect(summed!.changes).toEqual([{ folder: repo, files: 2, added: 2, removed: 1, uncommitted: 1, commits: 1 }])
    expect(changesText(summed!)).toEqual([
      `- ${repo}: 2 files changed (+2 −1), 1 commit, 1 uncommitted, on branch ${worktree.branch} (into ${summed!.repos[0]!.into})`,
    ])

    const settled = await workers.settle(space, 'w1')
    expect(settled!.state).toBe('review')
    expect(totalsOf(settled!.changes)).toMatchObject({ files: 2, commits: 1 })
    expect(existsSync(worktree.path)).toBe(true)
  })

  it("merges a worker's branch into the space's, committing what it left first, and cleans up", async () => {
    const { repo, space, spaceTree, workers, checkout } = await setup()
    const { worktree } = await checkout('w1')
    writeFileSync(join(worktree.path, 'a.txt'), 'a\n')
    git(worktree.path, 'add', '-A')
    git(worktree.path, 'commit', '-q', '-m', 'a')
    writeFileSync(join(worktree.path, 'b.txt'), 'b\n')
    await workers.settle(space, 'w1')

    const result = await workers.merge(space, 'w1', 'merge')
    expect(result).toEqual({ merged: [repo], conflicts: [], unchanged: [] })
    expect(readFileSync(join(spaceTree.path, 'a.txt'), 'utf8')).toBe('a\n')
    expect(readFileSync(join(spaceTree.path, 'b.txt'), 'utf8')).toBe('b\n')
    expect(git(spaceTree.path, 'log', '-1', '--format=%s')).toBe('Merge worker "Fix the bug"')
    expect(git(spaceTree.path, 'status', '--porcelain')).toBe('')
    expect(existsSync(worktree.path)).toBe(false)
    expect(branchesOf(repo)).not.toContain(worktree.branch)
    expect(space.info.workerBranches).toBeUndefined()
  })

  it('squashes a worker’s commits into one on the space’s branch', async () => {
    const { space, spaceTree, workers, checkout } = await setup()
    const { worktree } = await checkout('w1')
    for (const name of ['a', 'b']) {
      writeFileSync(join(worktree.path, `${name}.txt`), `${name}\n`)
      git(worktree.path, 'add', '-A')
      git(worktree.path, 'commit', '-q', '-m', name)
    }
    const before = Number(git(spaceTree.path, 'rev-list', '--count', 'HEAD'))
    await workers.settle(space, 'w1')
    await workers.merge(space, 'w1', 'squash')
    expect(Number(git(spaceTree.path, 'rev-list', '--count', 'HEAD'))).toBe(before + 1)
    expect(git(spaceTree.path, 'log', '-1', '--format=%s')).toBe('Fix the bug')
    expect(existsSync(join(spaceTree.path, 'b.txt'))).toBe(true)
  })

  for (const how of ['merge', 'squash'] as const) {
    it(`leaves a conflicting ${how} undone and reports the files`, async () => {
      const { repo, space, spaceTree, workers, checkout } = await setup()
      const { worktree } = await checkout('w1')
      writeFileSync(join(worktree.path, 'README.md'), 'worker\n')
      git(worktree.path, 'commit', '-q', '-am', 'worker edit')
      writeFileSync(join(spaceTree.path, 'README.md'), 'space\n')
      git(spaceTree.path, 'commit', '-q', '-am', 'space edit')
      await workers.settle(space, 'w1')

      const result = await workers.merge(space, 'w1', how)
      expect(result.merged).toEqual([])
      expect(result.conflicts).toEqual([{ folder: repo, files: ['README.md'] }])
      // The space's checkout is as it was, and the worker's branch waits.
      expect(git(spaceTree.path, 'status', '--porcelain')).toBe('')
      expect(readFileSync(join(spaceTree.path, 'README.md'), 'utf8')).toBe('space\n')
      expect(space.info.workerBranches!.w1!.state).toBe('review')
      expect(existsSync(worktree.path)).toBe(true)
    })
  }

  it('refuses to merge while the worker runs, or into a space checkout with uncommitted changes', async () => {
    const { space, spaceTree, workers, checkout } = await setup()
    const { worktree } = await checkout('w1')
    writeFileSync(join(worktree.path, 'a.txt'), 'a\n')
    await expect(workers.merge(space, 'w1', 'merge')).rejects.toThrow(/still running/)
    await workers.settle(space, 'w1')
    writeFileSync(join(spaceTree.path, 'README.md'), 'dirty\n')
    await expect(workers.merge(space, 'w1', 'merge')).rejects.toThrow(/uncommitted changes/)
    expect(space.info.workerBranches!.w1).toBeDefined()
  })

  it('discards a worker’s worktree and branch, and keep leaves them', async () => {
    const { repo, space, workers, checkout } = await setup()
    const one = await checkout('w1')
    const two = await checkout('w2', 'Other')
    for (const { worktree } of [one, two]) writeFileSync(join(worktree.path, 'x.txt'), 'x\n')
    await workers.settle(space, 'w1')
    await workers.settle(space, 'w2')

    await workers.discard(space, 'w1')
    expect(existsSync(one.worktree.path)).toBe(false)
    expect(branchesOf(repo)).not.toContain(one.worktree.branch)

    workers.keep(space, 'w2')
    expect(space.info.workerBranches).toEqual({ w2: expect.objectContaining({ state: 'kept' }) as WorkerBranch })
    expect(existsSync(two.worktree.path)).toBe(true)
  })

  it('with the space deleted, commits leftovers and keeps branches that hold work', async () => {
    const { repo, space, workers, checkout } = await setup()
    const busy = await checkout('w1')
    const idle = await checkout('w2', 'Idle')
    writeFileSync(join(busy.worktree.path, 'wip.txt'), 'wip\n')

    await workers.removeAll(space)
    expect(existsSync(busy.worktree.path)).toBe(false)
    expect(existsSync(idle.worktree.path)).toBe(false)
    expect(branchesOf(repo)).toContain(busy.worktree.branch)
    expect(branchesOf(repo)).not.toContain(idle.worktree.branch)
    expect(git(repo, 'show', `${busy.worktree.branch}:wip.txt`)).toBe('wip')
  })

  it('makes the worktree again from its branch when it was deleted by hand', async () => {
    const { repo, checkout } = await setup()
    const { worktree } = await checkout('w1')
    writeFileSync(join(worktree.path, 'a.txt'), 'a\n')
    git(worktree.path, 'add', '-A')
    git(worktree.path, 'commit', '-q', '-m', 'a')
    rmSync(worktree.path, { recursive: true, force: true })
    git(repo, 'worktree', 'prune')

    const again = await checkout('w1')
    expect(again.worktree).toEqual(worktree)
    expect(readFileSync(join(worktree.path, 'a.txt'), 'utf8')).toBe('a\n')
  })

  it("runs a setup script in a worktree and keeps the end of its output", async () => {
    const { workers, checkout } = await setup()
    const { worktree } = await checkout('w1')
    expect(await workers.runSetup('echo hi > made.txt && echo done', worktree.path)).toEqual({ ok: true, code: 0, output: 'done' })
    expect(readFileSync(join(worktree.path, 'made.txt'), 'utf8')).toBe('hi\n')
    expect(await workers.runSetup('echo oops >&2; exit 3', worktree.path)).toEqual({ ok: false, code: 3, output: 'oops' })
  })
})
