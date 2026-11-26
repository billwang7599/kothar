// Workers' own checkouts through the core: a worker started in a space with a git folder works in a worktree of its
// own, the space's setup script runs there first, and once it reports, its changes wait on the space for review.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Extension, ExtensionHost } from '@kothar/extension-api'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAdapter, type FakeStep } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import { openCore } from './core.ts'
import { WORKER_CHECKOUT_RULES } from './instructions.ts'
import { CHANGES_WAITING } from './memory.ts'
import type { ClientMessage, CoreMessage, SessionOptions } from './shared.ts'
import { until } from './test-wait.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-worker-trees-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim()
const gitRepo = () => {
  const dir = join(tempDir(), 'app')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(dir, 'README.md'), 'committed\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'first')
  return dir
}
const branchesOf = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n')

// A core on the fake engine. Each session's options are kept; a worker's session (its task as its first message)
// writes `edit` into its folder, as an agent's edit would.
function start(edit?: { file: string; text: string }) {
  const garage = tempDir()
  const sessions: SessionOptions[] = []
  const script = (options: SessionOptions): FakeStep[] => {
    sessions.push(options)
    if (edit && options.cwd.includes(`${join('workers', '')}`)) writeFileSync(join(options.cwd, edit.file), edit.text)
    return [{ type: 'text.completed', text: 'Done' }]
  }
  let host: ExtensionHost | undefined
  const extension: Extension = {
    id: 'test',
    name: 'Test',
    description: '',
    enabledByDefault: true,
    onChatCreated: (_chat, context) => void (host = context.host),
  }
  const core = openCore({ garage, adapters: [createFakeAdapter(script, 0)], defaultEngine: 'fake', machine: sandboxingMachine, extensions: [extension] })
  cleanups.push(() => core.close(true))
  const messages: CoreMessage[] = []
  core.onMessage((m) => messages.push(m))
  const handle = (m: ClientMessage) => core.handle(m, () => {})
  handle({ type: 'engine.setEnabled', engine: 'fake', enabled: true })
  handle({ type: 'workFolder.set', path: join(garage, 'work') })
  const chat = (id: string) => core.chats().find((c) => c.id === id)
  const space = (folders: string[]) => {
    handle({ type: 'chat.create', name: 'App', folders })
    return core.chats().findLast((c) => c.name === 'App')!.id
  }
  // Starts a worker and waits for its report to reach the space and the space's own turn on it to end.
  const work = async (spaceId: string, spec: { checkout?: 'own' | 'shared' } = {}) => {
    const { id } = host!.createChat({ parentId: spaceId, task: 'Fix the bug', ...spec })
    await until(() => !chat(id))
    await until(() => chat(spaceId)!.status === 'idle' && chat(spaceId)!.entries.some((e) => e.type === 'worker.report' && e.chatId === id))
    const report = chat(spaceId)!.entries.find((e) => e.type === 'worker.report' && e.chatId === id)
    const session = sessions.find((s) => s.instructions?.includes('Fix the bug') || s.cwd.includes(id))
    return { id, report: report as Extract<typeof report, { type: 'worker.report' }>, session }
  }
  return { core, garage, messages, handle, chat, space, work, sessions }
}

describe("workers' own worktrees", () => {
  it('runs a worker in a worktree of its own, with the setup script run there first, and its changes wait for review', async () => {
    const t = start({ file: 'fix.txt', text: 'fixed\n' })
    const repo = gitRepo()
    const spaceId = t.space([repo])
    t.handle({ type: 'chat.setSetupScript', chatId: spaceId, script: 'echo ready > setup.txt' })
    expect(t.chat(spaceId)?.setupScript).toBe('echo ready > setup.txt')

    const { id, report } = await t.work(spaceId)
    const workDir = join(t.garage, 'work', spaceId)
    const tree = join(workDir, 'workers', id, basename(repo))
    const session = t.sessions.find((s) => s.cwd === tree)!
    expect(session).toBeDefined()
    expect(session.instructions).toContain(WORKER_CHECKOUT_RULES)
    expect(readFileSync(join(tree, 'setup.txt'), 'utf8')).toBe('ready\n')

    await until(() => t.chat(spaceId)!.workerBranches?.[id]?.state === 'review')
    const branch = t.chat(spaceId)!.workerBranches![id]!
    expect(branch).toMatchObject({ name: 'Fix the bug', state: 'review', repos: [{ folder: repo, path: tree }] })
    expect(branch.repos[0]!.into).toBe(t.chat(spaceId)!.worktrees![repo]!.branch)
    // setup.txt and fix.txt, both uncommitted.
    expect(branch.changes).toEqual([{ folder: repo, files: 2, added: 0, removed: 0, uncommitted: 2, commits: 0 }])
    expect(report.changes).toEqual([expect.stringContaining(`- ${repo}: 2 files changed`)])
    // The space's own checkout never saw the worker's edit.
    expect(existsSync(join(t.chat(spaceId)!.worktrees![repo]!.path, 'fix.txt'))).toBe(false)
  })

  it("tells the lead about its changes in the report it reads", async () => {
    const t = start({ file: 'fix.txt', text: 'fixed\n' })
    const spaceId = t.space([gitRepo()])
    await t.work(spaceId)
    const leadTurn = t.sessions.findLast((s) => s.cwd === t.chat(spaceId)!.worktrees![Object.keys(t.chat(spaceId)!.worktrees!)[0]!]!.path)
    expect(leadTurn).toBeDefined()
    // The lead's prompt carries the report; its memory keeps the same text.
    const report = t.chat(spaceId)!.entries.find((e) => e.type === 'worker.report')!
    expect(report).toMatchObject({ changes: [expect.stringContaining('on branch kothar-worker/app/')] })
    expect(CHANGES_WAITING).toMatch(/merge, squash, discard or keep/)
  })

  it('leaves nothing behind for a worker that changed nothing', async () => {
    const t = start()
    const repo = gitRepo()
    const spaceId = t.space([repo])
    const { id, report } = await t.work(spaceId)
    await until(() => !t.chat(spaceId)!.workerBranches)
    expect(report.changes).toBeUndefined()
    expect(existsSync(join(t.garage, 'work', spaceId, 'workers', id, basename(repo)))).toBe(false)
    expect(branchesOf(repo).some((b) => b.startsWith('kothar-worker/'))).toBe(false)
  })

  it("shares the space's checkout when asked, or when Settings → Workers says so", async () => {
    const t = start({ file: 'fix.txt', text: 'fixed\n' })
    const spaceId = t.space([gitRepo()])
    await t.work(spaceId, { checkout: 'shared' })
    t.handle({ type: 'workers.set', ownCheckouts: false })
    expect(t.core.workers().ownCheckouts).toBe(false)
    await t.work(spaceId)
    expect(t.sessions.some((s) => s.cwd.includes(join('workers', '')))).toBe(false)
    expect(t.chat(spaceId)!.workerBranches).toBeUndefined()
  })

  it("stops a worker whose setup script fails and tells its lead why", async () => {
    const t = start()
    const spaceId = t.space([gitRepo()])
    t.handle({ type: 'chat.setSetupScript', chatId: spaceId, script: 'echo broken >&2; exit 4' })
    const { report } = await t.work(spaceId)
    expect(report.error).toMatch(/setup script failed .*\(exit 4\): broken/)
  })

  it('clears the setup script when it is emptied', () => {
    const t = start()
    const spaceId = t.space([])
    t.handle({ type: 'chat.setSetupScript', chatId: spaceId, script: 'npm ci' })
    t.handle({ type: 'chat.setSetupScript', chatId: spaceId, script: '  ' })
    expect(t.chat(spaceId)).not.toHaveProperty('setupScript')
  })

  it("deleting the space removes its workers' worktrees but keeps a branch that holds work", async () => {
    const t = start({ file: 'fix.txt', text: 'fixed\n' })
    const repo = gitRepo()
    const spaceId = t.space([repo])
    const { id } = await t.work(spaceId)
    const { branch, path } = t.chat(spaceId)!.workerBranches![id]!.repos[0]!
    t.handle({ type: 'chat.delete', chatId: spaceId })
    await until(() => !existsSync(path))
    await until(() => git(repo, 'show', `${branch}:fix.txt`) === 'fixed')
  })
})
