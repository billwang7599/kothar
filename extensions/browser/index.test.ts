import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ChatDetail, ExtensionHost, ExtensionTool, ExtensionWait } from '@kothar/extension-api'
import { until as waitUntil } from '@kothar/core/test-wait'
import { createAgent } from './chrome-extension/agent.js'
import browser, {
  BROWSER_INSTRUCTIONS,
  createBrowserExtension,
  HAND_OFF_TOOL,
  OLD_PROFILE_FOLDERS,
  SHOW_TOOL,
  YOUR_CHROME_INSTRUCTIONS,
} from './index.ts'
import { EXTENSION_DIR, extensionId, NOT_CONNECTED } from './relay.ts'
import { fakeChrome, socketWith } from './test-chrome.ts'
import { BROWSER_TOOL_NAMES } from './tools.ts'

const dirs: string[] = []
const tempDir = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}
const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
const until = (check: () => boolean | Promise<boolean>, ms = 3000) => waitUntil(check, { tries: ms / 10, everyMs: 10 })

const ORIGIN = `chrome-extension://${extensionId()}`
const defaults = Object.fromEntries(browser.settings!.map((setting) => [setting.key, setting.default]))
const detail = (id: string, more: Partial<ChatDetail> = {}): ChatDetail =>
  ({ id, name: id, engine: 'fake', status: 'running', archived: false, keepsContext: true, folders: [], files: [], createdAt: '', ...more }) as ChatDetail

// The Browser extension started on a host as the core gives one, its relay on a spare port, and a fake Chrome with the
// Kothar extension in it, not yet paired.
async function started(storage = tempDir('kothar-browser-')) {
  const { extension, cdpUrl } = createBrowserExtension({ relay: { port: 0, origin: ORIGIN } })
  const chats: ChatDetail[] = []
  const waits = new Map<string, ExtensionWait>()
  const notified: { chatId?: string; title: string; body?: string }[] = []
  const host = {
    notify: (n: { chatId?: string; title: string; body?: string }) => void notified.push(n),
    chats: () => chats,
    space: (chatId: string) => {
      const chat = chats.find((c) => c.id === chatId)
      const id = chat?.parentId ?? chat?.id
      return id ? { id, name: id === 'sales' ? 'Sales' : id, folders: [], checkouts: [] } : undefined
    },
    wait: (chatId: string, wait: ExtensionWait) => void waits.set(chatId, wait),
    endWait: (chatId: string) => void waits.delete(chatId),
    processesChanged: () => {},
    storage: { dir: storage },
  } as unknown as ExtensionHost
  const values = { ...defaults }
  await extension.onStart!({ values, host })
  cleanups.push(() => extension.onStop!({ values, host }))
  const fake = fakeChrome()
  const agent = createAgent({ chrome: fake.chrome, WebSocket: socketWith(ORIGIN), setTimer: () => 0 })
  cleanups.push(() => agent.unpair())
  const view = () => JSON.stringify(extension.settingsView!.render({ values, host }))
  const pair = async () => {
    await agent.pair(/KOTHAR:\d+:[\w-]+/.exec(view())![0])
    await until(() => view().includes('"Connected"'))
  }
  const chat = (id: string, more: Partial<ChatDetail> = {}) => {
    const made = detail(id, more)
    chats.push(made)
    return made
  }
  const tool = (name: string) => extension.tools!.find((t) => t.name === name) as ExtensionTool
  const context = { values, host }
  // A tab in the space's group, as the browser tools open one.
  const openTab = async (spaceId: string, url: string) => {
    const version = await (await fetch(`${await cdpUrl(spaceId)}/json/version/`)).json()
    const ws = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve) => ws.once('open', resolve))
    const made = new Promise<any>((resolve) => ws.once('message', (d) => resolve(JSON.parse(String(d)))))
    ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url } }))
    const { result } = await made
    ws.close()
    return result.targetId as string
  }
  return { extension, cdpUrl, host, values, context, waits, notified, fake, agent, view, pair, chat, tool, openTab, storage }
}

it('runs only in your own Chrome: one setting, and saved profile and idle settings go when it migrates', () => {
  expect(browser.settings!.map((s) => s.key)).toEqual(['askEachAction'])
  expect(browser.settingsVersion).toBe(4)
  // Version 3's Kothar's own profile or your Chrome, and its idle close, go quietly whichever was picked.
  expect(browser.migrateSettings!({ profile: 'kothar', idleMinutes: 5, askEachAction: true }, 3, {})).toEqual({ askEachAction: true })
  expect(browser.migrateSettings!({ profile: 'kothar-extension' }, 3, {})).toEqual({})
  expect(browser.migrateSettings!({ profile: 'chrome:Default', profileFolder: '/x', engine: 'chromium' }, 2, {})).toEqual({})
  const old = { browser: 'chrome', port: 9333, extensionToken: 'x', background: true, askEachAction: true }
  expect(browser.migrateSettings!(old, 0, {})).toEqual({ askEachAction: true })
  expect(browser.migrateSettings!({ askEachAction: false }, 4, {})).toEqual({ askEachAction: false })
})

it('has no browser before it starts', async () => {
  const { extension, cdpUrl } = createBrowserExtension()
  expect(extension.tools!.find((t) => t.name === 'browser_open')!.offered(detail('a'))).toBe(false)
  await expect(cdpUrl('a')).rejects.toThrow(NOT_CONNECTED)
})

it('tells agents to use the tools, close tabs, and hand sign-ins to the user in their own Chrome, never asking for passwords', () => {
  const chat = detail('a', { status: 'idle' })
  const text = browser.instructions!({ chat, tools: true }, { values: defaults, host: {} as never })!
  expect(text).toBe(`${BROWSER_INSTRUCTIONS} ${YOUR_CHROME_INSTRUCTIONS}`)
  for (const word of ['browser_open', 'snapshot', 'cursor', 'screenshot', 'browser_cdp', 'Close', HAND_OFF_TOOL, SHOW_TOOL]) {
    expect(text).toContain(word)
  }
  expect(text).toContain("user's own Chrome")
  expect(text).toContain('Never ask them for passwords')
  expect(text).not.toMatch(/headless|Kothar's own profile|plain window/i)
  expect(browser.instructions!({ chat, tools: false }, { values: defaults, host: {} as never })).toBeUndefined()
  const handOff = browser.tools!.find((t) => t.name === HAND_OFF_TOOL)!
  expect(handOff.description).toContain("user's own Chrome")
  expect(handOff.description).toContain('Never ask for passwords')
  expect(browser.tools!.map((t) => t.name)).toEqual([...BROWSER_TOOL_NAMES, HAND_OFF_TOOL, SHOW_TOOL])
  // No MCP server of its own: the tools are Kothar's.
  expect(browser.mcpServers).toBeUndefined()
})

it('offers the browser tools in a space and its workers, and while not connected they fail at once saying how to fix it', async () => {
  const { extension, chat, tool, context, cdpUrl } = await started()
  const space = chat('sales')
  const worker = chat('worker', { parentId: 'sales', worker: true })
  for (const t of extension.tools!) {
    expect(t.offered(space)).toBe(true)
    expect(t.offered(worker)).toBe(true)
    expect(t.offered(detail('nowhere'))).toBe(false)
  }
  await expect(cdpUrl('sales')).rejects.toThrow(NOT_CONNECTED)
  const began = Date.now()
  await expect(Promise.resolve(tool('browser_open').run({ url: 'https://example.com' }, { caller: space, ...context }))).rejects.toThrow(NOT_CONNECTED)
  await expect(Promise.resolve(tool(HAND_OFF_TOOL).run({ reason: 'Sign in' }, { caller: space, ...context }))).rejects.toThrow(NOT_CONNECTED)
  expect(Date.now() - began).toBeLessThan(1000)
  expect(NOT_CONNECTED).toContain('Settings → Extensions → Browser')
  // The tool list stays short: about 1,000 tokens.
  const listed = JSON.stringify(extension.tools!.filter((t) => BROWSER_TOOL_NAMES.includes(t.name)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })))
  expect(listed.length).toBeLessThan(4_500)
})

it('Settings walks through installing and pairing the extension, and pairing turns it Connected', async () => {
  const { view, pair, extension, values } = await started()
  expect(view()).toContain('Not connected')
  expect(view()).toContain('Load unpacked')
  expect(view()).toContain('chrome://extensions')
  expect(view()).toContain(EXTENSION_DIR.replaceAll('\\', '\\\\'))
  expect(view()).toContain('fail and say so')
  expect(await extension.setup!.check(async () => ({ code: 0, stdout: '', stderr: '' }), values)).toMatchObject({ ready: true })
  await pair()
  expect(view()).not.toContain('Load unpacked')
  expect(await extension.setup!.check(async () => ({ code: 0, stdout: '', stderr: '' }), values)).toEqual({ ready: true, message: 'Your Chrome is connected' })
})

it("the browser tools get the space's endpoint on the relay, and the tab opens in the user's window in the background", async () => {
  const { pair, chat, tool, context, fake, openTab, cdpUrl } = await started()
  const space = chat('sales')
  const userTab = fake.addTab({ url: 'https://mail.example', active: true })
  await pair()
  expect(await cdpUrl('sales')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/sales$/)
  expect(await openTab('sales', 'https://example.com')).toMatch(/^T\d+$/)
  const group = [...fake.groups.values()][0]!
  expect(group).toMatchObject({ title: 'Kothar · Sales', color: 'blue', windowId: userTab.windowId })
  expect(fake.created).toEqual([])
  expect(fake.focused).toEqual([])
  expect(fake.tabs.get(userTab.id)!.active).toBe(true)
  // The agent's browser_tabs reaches the same tab through the relay.
  expect(String(await tool('browser_tabs').run({ action: 'list' }, { caller: space, ...context }))).toBe('0: https://example.com')
})

it("show_browser brings the space's tabs forward in Chrome and waits for Done, which ends the wait at once", async () => {
  const { pair, chat, tool, context, fake, waits, extension, openTab, notified } = await started()
  const space = chat('sales')
  fake.addTab({ url: 'https://mail.example', active: true })
  await pair()
  // No tabs yet: the agent hears to open the page first.
  await expect(Promise.resolve(tool(SHOW_TOOL).run({ reason: 'Look' }, { caller: space, ...context }))).rejects.toThrow(/no tabs/)
  await openTab('sales', 'https://example.com')

  let returned: string | undefined
  void Promise.resolve(tool(SHOW_TOOL).run({ reason: 'The chart is empty' }, { caller: space, ...context })).then((t) => (returned = String(t)))
  await until(() => waits.has('sales'))
  const group = [...fake.groups.values()][0]!
  expect(fake.focused).toEqual([group.windowId])
  expect(notified.at(-1)).toMatchObject({ chatId: 'sales', title: 'An agent wants to show you something', body: 'The chart is empty' })
  expect(waits.get('sales')!.buttons.map((b) => b.label)).toEqual(['Show tab', 'Done'])
  expect(waits.get('sales')!.buttons.find((b) => b.id === 'done')).toMatchObject({ closes: true })
  // Show tab brings it forward again.
  await extension.onWaitAction!(space, { button: 'open' }, context)
  await until(() => fake.focused.length === 2)
  await extension.onWaitAction!(space, { button: 'done' }, context)
  await until(() => returned !== undefined)
  expect(returned).toContain('The user is done.')
  expect(returned).toContain("Kothar tab group in the user's Chrome")
  expect(returned).toContain('https://example.com')
  expect(waits.has('sales')).toBe(false)
})

it("ask_user_in_browser shows the asking chat's own tab, and a message or stopping the chat ends it", async () => {
  const { pair, chat, tool, context, fake, waits, extension, openTab } = await started()
  const space = chat('sales')
  fake.addTab({ url: 'https://mail.example', active: true })
  await pair()
  // Two tabs in the group; the chat's own is the second, which it switched to.
  await openTab('sales', 'https://other.example')
  await openTab('sales', 'https://github.com/login')
  expect(String(await tool('browser_tabs').run({ action: 'list' }, { caller: space, ...context }))).toContain('1: https://github.com/login')
  // The fake Chrome has no page to snapshot, so the switch's snapshot fails; the switch itself has happened.
  await Promise.resolve(tool('browser_tabs').run({ action: 'switch', tab: 1 }, { caller: space, ...context })).catch(() => {})
  const mine = [...fake.tabs.values()].find((t) => t.url === 'https://github.com/login')!
  for (const t of fake.tabs.values()) if (t.groupId !== -1) t.active = false

  let returned: string | undefined
  void Promise.resolve(tool(HAND_OFF_TOOL).run({ reason: 'Sign in to GitHub' }, { caller: space, ...context })).then((t) => (returned = String(t)))
  await until(() => waits.has('sales'))
  expect(mine!.active).toBe(true)
  expect([...fake.tabs.values()].find((t) => t.url === 'https://other.example')?.active).toBe(false)
  await extension.onWaitAction!(space, { message: 'done, signed in' }, context)
  await until(() => returned !== undefined)
  expect(returned).toContain('sent you a message')

  returned = undefined
  void Promise.resolve(tool(HAND_OFF_TOOL).run({ reason: 'Again' }, { caller: space, ...context })).then((t) => (returned = String(t)))
  await until(() => waits.has('sales'))
  extension.onStatusChanged!(space, 'stopping', context)
  await until(() => returned !== undefined)
  expect(returned).toContain('The hand-off was stopped.')
})

it("queues two chats' hand-offs in one space, and drops a queued one whose chat stops", async () => {
  const { pair, chat, tool, context, waits, extension, openTab } = await started()
  const space = chat('sales')
  const worker = chat('worker', { parentId: 'sales', worker: true })
  const other = chat('other', { parentId: 'sales', worker: true })
  await pair()
  await openTab('sales', 'https://example.com')
  const answers: Record<string, string> = {}
  const ask = (caller: ChatDetail) =>
    void Promise.resolve(tool(HAND_OFF_TOOL).run({ reason: `For ${caller.id}` }, { caller, ...context })).then((t) => (answers[caller.id] = String(t)))
  ask(space)
  await until(() => waits.has('sales'))
  ask(worker)
  ask(other)
  await new Promise((r) => setTimeout(r, 50))
  expect(waits.has('worker')).toBe(false)
  // The third stops before its turn: it never shows.
  extension.onStatusChanged!(other, 'idle', context)
  await until(() => answers.other !== undefined)
  expect(answers.other).toContain('nothing was shown')
  await extension.onWaitAction!(space, { button: 'done' }, context)
  await until(() => waits.has('worker'))
  await extension.onWaitAction!(worker, { button: 'done' }, context)
  await until(() => answers.worker !== undefined)
  expect(answers.sales).toContain('The user is done.')
  expect(answers.worker).toContain('The user is done.')
})

it('Show browser in the General tab is there while connected, and brings the space forward', async () => {
  const { extension, pair, chat, context, agent, view, fake, openTab } = await started()
  const space = chat('sales')
  const command = extension.commands!.find((c) => c.id === 'show-browser')!
  expect(extension.commands!.map((c) => c.id)).toEqual(['show-browser'])
  expect(command.shown!(space, context)).toBe(false)
  await pair()
  expect(command.shown!(space, context)).toBe(true)
  await openTab('sales', 'https://example.com')
  await command.run(chat('worker', { parentId: 'sales', worker: true }), context)
  await until(() => fake.focused.length === 1)
  await agent.unpair()
  await until(() => view().includes('Not connected'))
  expect(command.shown!(space, context)).toBe(false)
  // Kothar shows no Processes row: there's no browser of its own to stop.
  expect(extension.processes).toBeUndefined()
})

it("deletes the profiles and copies Kothar's own browser kept, logins and all, when it starts", async () => {
  const storage = tempDir('kothar-browser-')
  for (const folder of OLD_PROFILE_FOLDERS) {
    mkdirSync(join(storage, folder, 'space', 'Default'), { recursive: true })
    writeFileSync(join(storage, folder, 'space', 'Default', 'Cookies'), 'cookies')
  }
  writeFileSync(join(storage, 'chrome-extension.json'), JSON.stringify({ token: 'kept-token-kept-token-kept' }))
  const { view } = await started(storage)
  for (const folder of OLD_PROFILE_FOLDERS) expect(existsSync(join(storage, folder))).toBe(false)
  // The pairing stays.
  expect(view()).toContain('kept-token-kept-token-kept')
})
