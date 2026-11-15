// Pictures a reply shows inline: file-links.ts image, which finds them only in the chat's places, and the server's
// token-checked GET /chats/<id>/image route.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAdapter } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import type { Chat } from './chat.ts'
import { openCore } from './core.ts'
import { MAX_CHAT_IMAGE_BYTES, openFileLinks } from './file-links.ts'
import { startServer } from './server.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-chat-images-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const write = (path: string, data: string | Buffer = PNG) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
}

function space() {
  const root = tempDir()
  const folder = join(root, 'code', 'app')
  const workDir = join(root, 'work', 'space')
  const checkout = join(workDir, 'app')
  const dir = join(root, 'garage', 'chats', 'space')
  const elsewhere = join(root, 'elsewhere')
  for (const d of [folder, checkout, dir, elsewhere]) mkdirSync(d, { recursive: true })
  const chat = {
    dir,
    info: { id: 'space', folders: [folder], files: [], workDir, worktrees: { [folder]: { path: checkout, branch: 'kothar/app' } } },
  } as unknown as Chat
  const links = openFileLinks({
    home: root,
    machine: { run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    now: () => new Date(0),
    chainOf: (c) => [c],
    terminalRoots: () => [folder, workDir, checkout],
    openTerminalAt: async () => {},
    editor: () => ({}),
  })
  return { root, folder, workDir, checkout, dir, elsewhere, chat, image: (path: unknown) => links.image(chat, path) }
}

describe('a chat image', () => {
  it('is found by absolute, ~, file:// and relative paths in the chat’s places', () => {
    const t = space()
    write(join(t.workDir, 'chart.png'))
    write(join(t.folder, 'docs', 'shot.JPG'))
    write(join(t.dir, 'attachments', 'pasted.webp'))
    write(join(t.checkout, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(t.image(join(t.workDir, 'chart.png'))).toEqual({ path: join(t.workDir, 'chart.png'), mimeType: 'image/png', size: PNG.length })
    expect(t.image('~/work/space/chart.png')).toMatchObject({ path: join(t.workDir, 'chart.png') })
    expect(t.image(pathToFileURL(join(t.workDir, 'chart.png')).href)).toMatchObject({ path: join(t.workDir, 'chart.png') })
    expect(t.image('chart.png')).toMatchObject({ path: join(t.workDir, 'chart.png') })
    expect(t.image('docs/shot.JPG')).toMatchObject({ mimeType: 'image/jpeg' })
    expect(t.image('attachments/pasted.webp')).toMatchObject({ mimeType: 'image/webp' })
    expect(t.image('logo.svg')).toMatchObject({ path: join(t.checkout, 'logo.svg'), mimeType: 'image/svg+xml' })
  })

  it('is refused outside the chat’s places, through .. and symlinks, without saying whether it exists', () => {
    const t = space()
    write(join(t.elsewhere, 'secret.png'))
    symlinkSync(join(t.elsewhere, 'secret.png'), join(t.workDir, 'link.png'))
    symlinkSync(t.elsewhere, join(t.workDir, 'out'))
    expect(t.image(join(t.elsewhere, 'secret.png'))).toEqual({ error: 'not-found' })
    expect(t.image('../../elsewhere/secret.png')).toEqual({ error: 'not-found' })
    expect(t.image(join(t.workDir, '..', '..', 'elsewhere', 'secret.png'))).toEqual({ error: 'not-found' })
    expect(t.image('link.png')).toEqual({ error: 'not-found' })
    expect(t.image('out/secret.png')).toEqual({ error: 'not-found' })
    expect(t.image(join(t.workDir, 'missing.png'))).toEqual({ error: 'not-found' })
    expect(t.image(42)).toEqual({ error: 'not-image' })
    expect(t.image('file://host/%zz.png')).toEqual({ error: 'not-found' })
  })

  it('is only a picture type, by the real file’s name too, and at most 25 MB', () => {
    const t = space()
    write(join(t.workDir, 'notes.txt'), 'hi')
    symlinkSync(join(t.workDir, 'notes.txt'), join(t.workDir, 'notes.png'))
    mkdirSync(join(t.workDir, 'folder.png'))
    write(join(t.workDir, 'huge.png'))
    truncateSync(join(t.workDir, 'huge.png'), MAX_CHAT_IMAGE_BYTES + 1)
    expect(t.image('notes.txt')).toEqual({ error: 'not-image' })
    expect(t.image(join(t.workDir, 'page.html'))).toEqual({ error: 'not-image' })
    expect(t.image('notes.png')).toEqual({ error: 'not-image' })
    expect(t.image('folder.png')).toEqual({ error: 'not-found' })
    expect(t.image('huge.png')).toEqual({ error: 'too-big' })
  })
})

it("opens a picture with the system's default app when asked, whatever editor is set", async () => {
  const t = space()
  write(join(t.workDir, 'chart.png'))
  const ran: string[][] = []
  const links = openFileLinks({
    home: t.root,
    platform: 'darwin',
    machine: { run: async (command, args) => (ran.push([command, ...args]), { code: 0, stdout: '', stderr: '' }) },
    now: () => new Date(0),
    chainOf: (c) => [c],
    terminalRoots: () => [t.folder, t.workDir, t.checkout],
    openTerminalAt: async () => {},
    editor: () => ({ choice: 'custom', command: 'myedit {file}' }),
  })
  await links.openFile(t.chat, join(t.workDir, 'chart.png'))
  await links.openFile(t.chat, join(t.workDir, 'chart.png'), undefined, undefined, 'default')
  expect(ran).toEqual([
    ['myedit', join(t.workDir, 'chart.png')],
    ['open', join(t.workDir, 'chart.png')],
  ])
})

describe('GET /chats/<id>/image', () => {
  const origin = 'http://localhost:4318'
  const token = 'test-token-0123456789'

  async function start() {
    const garage = tempDir()
    const folder = tempDir()
    const core = openCore({ garage, adapters: [createFakeAdapter(undefined, 0)], defaultEngine: 'fake', machine: sandboxingMachine })
    cleanups.push(() => core.close(true))
    core.handle({ type: 'workFolder.set', path: join(garage, 'work') }, () => {})
    core.handle({ type: 'chat.create', name: 'Space', folders: [folder] }, () => {})
    const chatId = core.chats().find((c) => c.name === 'Space')!.id
    const server = await startServer({ core, port: 0, uiOrigin: origin, token })
    cleanups.push(() => server.close())
    const get = (path: string, init: { token?: string; method?: string } = {}) =>
      fetch(
        `http://127.0.0.1:${server.port}/chats/${encodeURIComponent(chatId)}/image?path=${encodeURIComponent(path)}&token=${init.token ?? token}`,
        { method: init.method ?? 'GET' },
      )
    return { garage, folder, chatId, get }
  }

  it('serves a picture from the chat’s folders with the token, and nothing without it', async () => {
    const t = await start()
    write(join(t.folder, 'plot.png'))
    const response = await t.get(join(t.folder, 'plot.png'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
    expect((await t.get('plot.png')).status).toBe(200)
    expect((await t.get('plot.png', { method: 'HEAD' })).status).toBe(200)
    expect((await t.get('plot.png', { token: 'wrong' })).status).toBe(401)
    expect((await t.get('plot.png', { method: 'POST' })).status).toBe(405)
  })

  it('serves SVG under a CSP that runs nothing', async () => {
    const t = await start()
    write(join(t.folder, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const response = await t.get('x.svg')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain('sandbox')
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('script-src')
  })

  it('answers 404 outside the chat, 415 for other types, 413 when too big, and 404 for an unknown chat', async () => {
    const t = await start()
    write(join(t.folder, 'notes.txt'), 'hi')
    write(join(t.folder, 'big.png'))
    truncateSync(join(t.folder, 'big.png'), MAX_CHAT_IMAGE_BYTES + 1)
    write(join(t.garage, 'settings-copy.png'))
    expect((await t.get('/etc/hosts.png')).status).toBe(404)
    expect((await t.get('../../../etc/x.png')).status).toBe(404)
    expect((await t.get(join(t.garage, 'settings-copy.png'))).status).toBe(404)
    expect((await t.get('notes.txt')).status).toBe(415)
    expect((await t.get('big.png')).status).toBe(413)
    const response = await fetch(`http://127.0.0.1:${(new URL((await t.get('notes.txt')).url)).port}/chats/nope/image?path=x.png&token=${token}`)
    expect(response.status).toBe(404)
  })
})
