import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatDetail, ExtensionContext, ExtensionHost, ExtensionView, SpaceDetail } from '@kothar/extension-api'
import { createFakeAdapter, type FakeStep } from '@kothar/core/fake'
import { startCore } from '@kothar/core/main'
import type { ClientMessage, CoreMessage, Machine, SessionOptions } from '@kothar/core/shared'
import { sandboxingMachine } from '@kothar/core/test-machine'
import {
  checksOf,
  createGitExtension,
  FILES_MAX,
  LIVE_REFRESH_MS,
  noteText,
  parseNumstat,
  PR_TTL_MS,
  repoState,
  repoView,
  targetsOf,
  type RepoState,
} from './index.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-git-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function until(check: () => boolean) {
  for (let i = 0; i < 600 && !check(); i++) await new Promise((r) => setTimeout(r, 5))
  if (!check()) throw new Error('timed out')
}

const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })

function repo() {
  const dir = tempDir()
  sh(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'b.txt'), 'bee\n')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'first')
  return dir
}

type Gh = (args: string[]) => { code: number | null; stdout: string; stderr: string }
const noGh: Gh = () => ({ code: null, stdout: '', stderr: 'spawn gh ENOENT' })

// A core on the fake engine with the Git extension on. `work` runs at each session's start, in its checkout, as the
// agent.
async function start(work: (cwd: string) => void = () => {}, gh: Gh = noGh, clock = { now: 0 }, garage = tempDir()) {
  const ghCalls: string[][] = []
  const gitCalls: string[][] = []
  const machine: Machine = {
    ...sandboxingMachine,
    run: (command, args, options) => {
      if (command === 'git') gitCalls.push(args)
      if (command !== 'gh') return sandboxingMachine.run(command, args, options)
      ghCalls.push(args)
      return Promise.resolve(gh(args))
    },
  }
  const script = (options: SessionOptions): FakeStep[] => {
    work(options.cwd)
    return [{ type: 'text.completed', text: 'Done' }]
  }
  const extension = createGitExtension({ now: () => clock.now })
  const env = { KOTHAR_ENGINE: 'fake', KOTHAR_GARAGE: garage, KOTHAR_WORK: join(garage, 'work'), KOTHAR_PORT: '0' }
  const kothar = await startCore({ env, adapters: [createFakeAdapter(script, 0)], extensions: [extension], machine })
  cleanups.push(() => kothar.close(true))
  const { core } = kothar
  const messages: CoreMessage[] = []
  core.onMessage((m) => messages.push(m))
  const replies: CoreMessage[] = []
  const handle = (m: ClientMessage) => core.handle(m, (r) => replies.push(r))
  handle({ type: 'extension.setEnabled', extensionId: 'git', enabled: true })
  const create = (name: string, folders: string[] = []) => {
    handle({ type: 'chat.create', name, folders })
    return core.chats().findLast((c) => c.name === name)!.id
  }
  const chat = (id: string) => core.chats().find((c) => c.id === id)!
  const send = async (chatId: string) => {
    handle({ type: 'chat.send', chatId, text: 'Go' })
    await until(() => chat(chatId).status === 'idle' && chat(chatId).entries.some((e) => e.type === 'turn.completed'))
  }
  const tabs = (chatId: string) => {
    handle({ type: 'context.get', chatId })
    const listed = replies.findLast((m) => m.type === 'chat.extensions' && m.chatId === chatId)
    return listed?.type === 'chat.extensions' ? listed.panels.filter((p) => p.placement !== 'popup').map((p) => p.title) : []
  }
  const views = () => messages.filter((m) => m.type === 'extension.panel')
  type Action = Pick<Extract<ClientMessage, { type: 'extension.panel.action' }>, 'action'>
  const panel = async (chatId: string, message?: Action, id = 'changes') => {
    const seen = views().length
    if (message) handle({ type: 'extension.panel.action', chatId, extension: 'git', panel: id, ...message })
    else handle({ type: 'extension.panel.get', chatId, extension: 'git', panel: id })
    await until(() => views().slice(seen).some((v) => v.type === 'extension.panel' && v.panel === id))
    const shown = views().findLast((v) => v.type === 'extension.panel' && v.panel === id)
    if (shown?.type !== 'extension.panel') throw new Error('no view')
    if (shown.error) throw new Error(shown.error)
    return shown.view!
  }
  return { core, garage, handle, create, chat, send, tabs, panel, ghCalls, gitCalls, messages, close: () => kothar.close(true) }
}

// Every piece of text in a view, in order, for checking what the tab says.
function textOf(view: ExtensionView): string[] {
  switch (view.type) {
    case 'stack':
    case 'row':
      return view.children.flatMap(textOf)
    case 'card':
      return [view.title, ...(view.badges ?? []).map((b) => b.text), ...view.children.flatMap(textOf)]
    case 'section':
      return [
        view.title,
        ...(view.badges ?? []).map((b) => b.text),
        ...(view.buttons ?? []).flatMap(textOf),
        ...view.children.flatMap(textOf),
      ]
    case 'split':
      return [...textOf(view.side), ...textOf(view.main)]
    case 'diff':
      return [view.text]
    case 'list':
      return view.items.flatMap((i) => [i.label, ...(i.detail ? [i.detail] : [])])
    case 'heading':
    case 'text':
    case 'badge':
    case 'empty':
    case 'code':
      return [view.text]
    case 'link':
      return [view.text]
    case 'button':
      return [view.label]
    default:
      return []
  }
}

describe('the Changes tab', () => {
  it('shows only for spaces with a git folder', async () => {
    const t = await start()
    expect(t.tabs(t.create('Plain', [tempDir()]))).toEqual([])
    expect(t.tabs(t.create('Repo', [repo()]))).toEqual(['Changes'])
    t.handle({ type: 'extension.setEnabled', extensionId: 'git', enabled: false })
    expect(t.tabs(t.create('Off', [repo()]))).toEqual([])
  })

  it('shows the folder itself before the first message checks it out', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    const t = await start()
    const id = t.create('Repo', [dir])
    expect(textOf(await t.panel(id))).toEqual([
      'Pop out',
      'Refresh',
      basename(dir),
      'main',
      'Not pushed',
      'Uncommitted',
      'a.txt',
      '+0 −1',
    ])
  })

  it("lists a checkout's committed and uncommitted changes, opens a file's diff, and notes the turn", async () => {
    const dir = repo()
    const t = await start((cwd) => {
      writeFileSync(join(cwd, 'b.txt'), 'bee\nsee\n')
      sh(cwd, 'commit', '-q', '-am', 'more')
      writeFileSync(join(cwd, 'a.txt'), 'one\n2\n')
      writeFileSync(join(cwd, 'new.txt'), 'fresh\n')
    })
    const id = t.create('Repo', [dir])
    await t.send(id)
    await until(() => t.chat(id).entries.some((e) => e.type === 'extension.note'))
    const branch = t.chat(id).worktrees![dir]!.branch
    expect(t.chat(id).entries.findLast((e) => e.type === 'extension.note')).toMatchObject({
      text: `3 files changed on ${branch}`,
      extension: 'git',
      panel: 'changes',
    })
    const view = await t.panel(id)
    expect(textOf(view)).toEqual([
      'Pop out',
      'Refresh',
      basename(dir),
      branch,
      'Not pushed',
      'Uncommitted',
      'a.txt',
      '+1 −1',
      'new.txt',
      'new',
      'Committed since main',
      'b.txt',
      '+1 −0',
    ])
    const open = { name: 'open', value: { path: t.chat(id).worktrees![dir]!.path, group: 'committed', file: 'b.txt' } }
    const opened = await t.panel(id, { action: open })
    const diff = textOf(opened).find((text) => text.startsWith('diff --git'))
    expect(diff).toContain('+see')
    const closed = await t.panel(id, { action: open })
    expect(textOf(closed).some((text) => text.startsWith('diff --git'))).toBe(false)
  })

  it('notes nothing after a turn that changed no files', async () => {
    const t = await start()
    const id = t.create('Repo', [repo()])
    await t.send(id)
    await new Promise((r) => setTimeout(r, 100))
    expect(t.chat(id).entries.some((e) => e.type === 'extension.note')).toBe(false)
  })

  it("shows the branch's pull request and CI when gh has one, and keeps it a while", async () => {
    const clock = { now: 0 }
    const pr = {
      number: 7,
      title: 'Fix it',
      state: 'OPEN',
      url: 'https://github.com/o/r/pull/7',
      statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }],
    }
    const t = await start(() => {}, () => ({ code: 0, stdout: JSON.stringify(pr), stderr: '' }), clock)
    const id = t.create('Repo', [repo()])
    const view = await t.panel(id)
    expect(textOf(view)).toEqual(expect.arrayContaining(['#7 Fix it', 'open', 'CI running']))
    expect(t.ghCalls).toEqual([['pr', 'view', 'main', '--json', 'number,title,state,url,statusCheckRollup']])
    await t.panel(id)
    expect(t.ghCalls).toHaveLength(1)
    clock.now += PR_TTL_MS
    await t.panel(id)
    expect(t.ghCalls).toHaveLength(2)
    await t.panel(id, { action: { name: 'refresh' } })
    expect(t.ghCalls).toHaveLength(3)
  })

  it('shows no pull request, and no error, without gh', async () => {
    const t = await start()
    const id = t.create('Repo', [repo()])
    const view = await t.panel(id)
    expect(textOf(view)).toEqual(['Pop out', 'Refresh', expect.any(String), 'main', 'Not pushed', 'No changes'])
  })
})

describe('the Changes tab, polished', () => {
  it('opens a diff without reading every repo again, and closes a file that left its group', async () => {
    const dir = repo()
    const t = await start()
    const id = t.create('Repo', [dir])
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\n')
    await t.panel(id)
    const before = t.gitCalls.length
    const open = { name: 'open', value: { path: dir, group: 'uncommitted', file: 'a.txt' } }
    const opened = await t.panel(id, { action: open })
    expect(textOf(opened).find((text) => text.startsWith('diff --git'))).toContain('+TWO')
    // Only the diff itself: the repo's state is the one the tab already shows.
    expect(t.gitCalls.slice(before).map((args) => args.slice(2, 3))).toEqual([['diff']])
    // The agent commits the file: it leaves Uncommitted, and its diff closes rather than show nothing.
    sh(dir, 'commit', '-q', '-am', 'two')
    const after = await t.panel(id, { action: { name: 'refresh' } })
    expect(textOf(after).some((text) => text.startsWith('diff --git'))).toBe(false)
    expect(textOf(after)).toContain('No changes')
    writeFileSync(join(dir, 'a.txt'), 'one\nthree\n')
    const again = await t.panel(id, { action: { name: 'refresh' } })
    expect(textOf(again).some((text) => text.startsWith('diff --git'))).toBe(false)
  })

})

describe('reading git, edge cases', () => {
  const run = sandboxingMachine.run.bind(sandboxingMachine) as never

  it('reads a repo with no commits yet: its branch and its new files', async () => {
    const dir = tempDir()
    sh(dir, 'init', '-q', '-b', 'trunk')
    writeFileSync(join(dir, 'first.txt'), 'hi\n')
    const state = await repoState(run, { folder: dir, path: dir })
    expect(state.error).toBeUndefined()
    expect(state).toMatchObject({ branch: 'trunk', uncommitted: [{ path: 'first.txt', untracked: true }] })
  })

  it('says plainly when a folder is gone or is no repo', async () => {
    const dir = tempDir()
    expect((await repoState(run, { folder: dir, path: dir })).error).toBe(`Not a git repository: ${dir}`)
    const gone = join(dir, 'gone')
    expect((await repoState(run, { folder: gone, path: gone })).error).toBe(`Folder not found: ${gone}`)
    expect(textOf(repoView(await repoState(run, { folder: gone, path: gone })))).toEqual(['gone', `Folder not found: ${gone}`])
  })

  it('names the commit of a detached checkout instead of calling it HEAD', async () => {
    const dir = repo()
    const sha = sh(dir, 'rev-parse', '--short=7', 'HEAD').trim()
    sh(dir, 'checkout', '-q', '--detach')
    const state = await repoState(run, { folder: dir, path: dir })
    expect(state.detached).toBe(sha)
    expect(textOf(repoView(state))).toContain(`detached at ${sha}`)
    expect(textOf(repoView(state))).not.toContain('HEAD')
  })

  it('lists at most FILES_MAX files a group, and says how many more', () => {
    const files = Array.from({ length: FILES_MAX + 5 }, (_, i) => ({ path: `out/${i}.js`, untracked: true }))
    const state: RepoState = { target: { folder: '/r', path: '/r' }, branch: 'main', committed: [], uncommitted: files }
    const view = repoView(state)
    expect(textOf(view).filter((text) => text.startsWith('out/'))).toHaveLength(FILES_MAX)
    expect(textOf(view)).toContain('and 5 more files')
  })

  it("shows a diff git couldn't read as an error, not as a diff", () => {
    const state: RepoState = {
      target: { folder: '/r', path: '/r' },
      branch: 'main',
      committed: [],
      uncommitted: [{ path: 'a.txt', added: 1, removed: 0 }],
    }
    const view = repoView(state, { path: '/r', group: 'uncommitted', file: 'a.txt' }, { error: 'Couldn’t read the diff: x' })
    const find = (v: ExtensionView): ExtensionView[] =>
      'children' in v && Array.isArray(v.children) ? v.children.flatMap(find) : [v]
    expect(find(view)).toContainEqual({ type: 'text', text: 'Couldn’t read the diff: x', tone: 'error', small: true })
    expect(find(view).some((v) => v.type === 'code')).toBe(false)
  })
})

describe('during a turn', () => {
  it("draws the tab again after the agent's shell commands and edits, at most every LIVE_REFRESH_MS", async () => {
    vi.useFakeTimers()
    cleanups.push(() => void vi.useRealTimers())
    const extension = createGitExtension({ now: () => Date.now() })
    const refreshed: (string | undefined)[] = []
    const chat = { id: 's1', keepsContext: true } as ChatDetail
    const host = { refresh: (id?: string) => refreshed.push(id), chat: () => chat }
    const context = { host } as unknown as ExtensionContext
    const tool = (toolId: string, kind: 'shell' | 'edit' | 'read') => {
      extension.onEvent!(chat, { type: 'tool.started', toolId, name: 'T', kind, summary: '', input: {} }, context)
      extension.onEvent!(chat, { type: 'tool.completed', toolId, output: '', isError: false }, context)
    }
    tool('r1', 'read')
    expect(refreshed).toEqual([])
    tool('t1', 'shell')
    expect(refreshed).toEqual(['s1'])
    tool('t2', 'edit')
    tool('t3', 'shell')
    expect(refreshed).toEqual(['s1'])
    vi.advanceTimersByTime(LIVE_REFRESH_MS)
    expect(refreshed).toEqual(['s1', 's1'])
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 2)
    expect(refreshed).toEqual(['s1', 's1'])
  })
})

describe('reading git', () => {
  it('counts commits ahead of and behind the upstream', async () => {
    const origin = tempDir()
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    const dir = repo()
    sh(dir, 'remote', 'add', 'origin', origin)
    sh(dir, 'push', '-q', '-u', 'origin', 'main')
    const other = tempDir()
    execFileSync('git', ['clone', '-q', origin, other])
    writeFileSync(join(other, 'c.txt'), 'c\n')
    sh(other, 'add', '.')
    sh(other, 'commit', '-q', '-m', 'theirs')
    sh(other, 'push', '-q')
    sh(dir, 'fetch', '-q')
    sh(dir, 'commit', '-q', '--allow-empty', '-m', 'mine')
    sh(dir, 'commit', '-q', '--allow-empty', '-m', 'mine again')
    const state = await repoState(sandboxingMachine.run.bind(sandboxingMachine) as never, { folder: dir, path: dir })
    expect(state).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
  })

  it('reads numstat, CI rollups and the note', () => {
    expect(parseNumstat('3\t1\ta.ts\n-\t-\timg.png\n')).toEqual([
      { path: 'a.ts', added: 3, removed: 1 },
      { path: 'img.png', binary: true },
    ])
    expect(checksOf([])).toBeUndefined()
    expect(checksOf([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }])).toBe('passing')
    expect(checksOf([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('failing')
    expect(checksOf([{ state: 'PENDING' }])).toBe('running')
    expect(noteText([{ branch: 'feat/x', files: 0 }])).toBeUndefined()
    expect(noteText([{ branch: 'feat/x', files: 1 }])).toBe('1 file changed on feat/x')
    expect(noteText([
      { branch: 'feat/x', files: 3 },
      { branch: 'other', files: 0 },
      { branch: 'feat/y', files: 2 },
    ])).toBe('3 files changed on feat/x, 2 on feat/y')
  })
})

describe("workers' own checkouts", () => {
  it('lists them after the space’s, labelled, and shows a worker only its own', () => {
    const [mine, theirs, space] = [tempDir(), tempDir(), tempDir()]
    const detail: SpaceDetail = {
      id: 's1',
      name: 'App',
      folders: [{ path: '/repo', git: true }],
      checkouts: [{ folder: '/repo', path: space, branch: 'kothar/app' }],
      workerCheckouts: [
        { folder: '/repo', path: mine, branch: 'kothar-worker/app/w1-a', from: 'kothar/app', worker: 'w1', name: 'A', state: 'working' },
        { folder: '/repo', path: theirs, branch: 'kothar-worker/app/w2-b', from: 'kothar/app', worker: 'w2', name: 'B', state: 'review' },
        { folder: '/repo', path: join(theirs, 'gone'), branch: 'x', from: 'kothar/app', worker: 'w3', name: 'C', state: 'kept' },
      ],
    }
    const host = { space: () => detail } as unknown as ExtensionHost
    expect(targetsOf(host, 's1').map((t) => [t.path, t.label])).toEqual([
      [space, undefined],
      [mine, 'repo · worker A'],
      [theirs, 'repo · worker B (to review)'],
    ])
    expect(targetsOf(host, 'w1')).toEqual([
      { folder: '/repo', path: mine, checkout: { folder: '/repo', path: mine, branch: 'kothar-worker/app/w1-a', from: 'kothar/app' }, label: 'repo · worker A' },
    ])
  })
})

// Every view in a tree, depth first.
function viewsIn(view: ExtensionView): ExtensionView[] {
  const kids =
    view.type === 'stack' || view.type === 'row' || view.type === 'card'
      ? view.children
      : view.type === 'section'
        ? [...(view.buttons ?? []), ...view.children]
        : view.type === 'split'
          ? [view.side, view.main]
          : []
  return [view, ...kids.flatMap(viewsIn)]
}
const diffIn = (view: ExtensionView) => viewsIn(view).find((v) => v.type === 'diff') as Extract<ExtensionView, { type: 'diff' }> | undefined
const buttonsIn = (view: ExtensionView) => viewsIn(view).flatMap((v) => (v.type === 'button' ? [v.label] : []))

describe('review comments', () => {
  it('adds, edits and deletes comments on diff lines, kept in a file that outlives the core', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\nthree\n')
    const t = await start()
    const id = t.create('Repo', [dir])
    await t.panel(id)
    const opened = await t.panel(id, { action: { name: 'open', value: { path: dir, group: 'uncommitted', file: 'a.txt' } } })
    const diff = diffIn(opened)!
    expect(diff).toMatchObject({ comment: 'comment', remove: 'uncomment', comments: [] })
    const lines = diff.text.split('\n')
    const added = lines.indexOf('+TWO')
    // Two lines: the removed "two" and the added "TWO".
    await t.panel(id, { action: { name: 'comment', value: { start: added - 1, end: added, text: 'Keep it lower case' } } })
    const commented = await t.panel(id)
    expect(diffIn(commented)!.comments).toEqual([{ id: expect.any(String), text: 'Keep it lower case', start: added - 1, end: added }])
    expect(textOf(commented)).toEqual(expect.arrayContaining(['Send 1 comment', '1 comment']))
    const file = join(t.garage, 'chats', id, 'review-comments.json')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved).toEqual([
      expect.objectContaining({ path: dir, group: 'uncommitted', file: 'a.txt', side: 'new', start: 2, end: 2, quote: '-two\n+TWO', text: 'Keep it lower case' }),
    ])
    const commentId = saved[0].id
    // A line that's only context can take one too; a hunk header can't.
    await t.panel(id, { action: { name: 'comment', value: { start: added + 1, end: added + 1, text: 'And this' } } })
    const header = lines.findIndex((l) => l.startsWith('@@'))
    await t.panel(id, { action: { name: 'comment', value: { start: header, end: header, text: 'No' } } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(2)
    await t.panel(id, { action: { name: 'comment', value: { id: commentId, text: 'Lower case, please' } } })
    const second = JSON.parse(readFileSync(file, 'utf8'))[1].id
    await t.panel(id, { action: { name: 'uncomment', value: second } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([expect.objectContaining({ id: commentId, text: 'Lower case, please' })])

    // A new core on the same garage, as after a restart or a reload, still has it.
    await t.close()
    const again = await start(() => {}, noGh, { now: 0 }, t.garage)
    await again.panel(id)
    const back = await again.panel(id, { action: { name: 'open', value: { path: dir, group: 'uncommitted', file: 'a.txt' } } })
    expect(diffIn(back)!.comments).toEqual([expect.objectContaining({ id: commentId, text: 'Lower case, please' })])
  })

  it("sends every comment to the space's agent in one message, then clears them", async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\n')
    writeFileSync(join(dir, 'b.txt'), 'bee\nsee\n')
    const t = await start()
    const id = t.create('Repo', [dir])
    await t.panel(id)
    for (const [file, line, text] of [['a.txt', '+TWO', 'Lower case'], ['b.txt', '+see', 'Spell it "sea"']] as const) {
      const opened = await t.panel(id, { action: { name: 'open', value: { path: dir, group: 'uncommitted', file } } })
      const at = diffIn(opened)!.text.split('\n').indexOf(line)
      await t.panel(id, { action: { name: 'comment', value: { start: at, end: at, text } } })
    }
    expect(buttonsIn(await t.panel(id))).toContain('Send 2 comments')
    await t.panel(id, { action: { name: 'send' } })
    await until(() => t.chat(id).entries.some((e) => e.type === 'user.message'))
    const sent = t.chat(id).entries.filter((e) => e.type === 'user.message')
    expect(sent).toHaveLength(1)
    const text = sent[0]!.type === 'user.message' ? sent[0]!.text : ''
    expect(text).toContain('Please apply all 2 of these review comments')
    expect(text).toContain(`${basename(dir)} on branch main, at ${dir}.`)
    expect(text).toContain('1. a.txt, line 2 (uncommitted change):\n```diff\n+TWO\n```\nLower case')
    expect(text).toContain('2. b.txt, line 2 (uncommitted change):\n```diff\n+see\n```\nSpell it "sea"')
    expect(existsSync(join(t.garage, 'chats', id, 'review-comments.json'))).toBe(false)
    expect(readFileSync(join(t.garage, 'chats', id, 'review-sent.jsonl'), 'utf8')).toContain('Spell it')
    await until(() => t.chat(id).status === 'idle')
    expect(buttonsIn(await t.panel(id))).not.toContain('Send 2 comments')
  })

  it('pops out on the file open in the tab, and keeps a file open there', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\n')
    writeFileSync(join(dir, 'b.txt'), 'bee\nsee\n')
    const t = await start()
    const id = t.create('Repo', [dir])
    // Nothing open in the tab: the pop-out shows the first file.
    const first = await t.panel(id, undefined, 'changes-review')
    expect(first.type).toBe('split')
    expect(diffIn(first)).toMatchObject({ fill: true })
    expect(diffIn(first)!.text).toContain('+TWO')
    await t.panel(id)
    await t.panel(id, { action: { name: 'open', value: { path: dir, group: 'uncommitted', file: 'b.txt' } } })
    await t.panel(id, { action: { name: 'popout' } })
    const popped = await t.panel(id, undefined, 'changes-review')
    expect(diffIn(popped)!.text).toContain('+see')
    const open = { name: 'open', value: { path: dir, group: 'uncommitted', file: 'b.txt' } }
    expect(diffIn(await t.panel(id, { action: open }, 'changes-review'))!.text).toContain('+see')
  })
})
