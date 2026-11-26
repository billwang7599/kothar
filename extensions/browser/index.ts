import { join } from 'node:path'
import { rmSync } from 'node:fs'
import type { ChatDetail, Extension, ExtensionHost, ExtensionSetting, ExtensionTool, ExtensionView } from '@kothar/extension-api'
import { EXTENSION_DIR, NOT_CONNECTED, type Relay, type RelayOptions, type RelayTab, startRelay } from './relay.ts'
import { createBrowserTools } from './tools.ts'

// Agents browse in the user's own Chrome, through the Kothar Chrome extension (relay.ts): each space has a blue
// "Kothar · <space>" tab group in the window the user last used, its tabs opened in the background, and each chat a tab
// of its own there. Agents drive their tabs with Kothar's own browser tools (tools.ts), over CDP through the relay.
// When a page needs the user (a sign-in, CAPTCHA, payment), ask_user_in_browser brings the chat's tab to the front in
// their Chrome; they do it there, with their own logins, and click Done in the chat. Kothar runs no browser of its own.

export const HAND_OFF_TOOL = 'ask_user_in_browser'
export const SHOW_TOOL = 'show_browser'

// One of this extension's prompts as the user left it in Settings (host.prompt), else its default, as with a host
// that has no prompts (a test's).
const promptOf = (host: { prompt?: (id: string) => string } | undefined, id: string, fallback: string) =>
  typeof host?.prompt === 'function' ? host.prompt(id) : fallback

export const BROWSER_INSTRUCTIONS =
  'Browser (the browser_* tools): open a page with browser_open and read it from the snapshot it returns; act on it ' +
  'with browser_act and browser_type by the refs in the snapshot (e12), and each returns only what changed. A long ' +
  'page comes in parts: call browser_snapshot with the cursor it gives. Take a screenshot only when how it looks ' +
  "matters. browser_cdp sends a DevTools command to your tab for what the other tools can't do. You get a tab of your " +
  "own; other chats in this space have theirs, so leave tabs browser_tabs marks as another chat's alone. Close the " +
  'tabs you opened when you are done with them. Your tabs stay open between messages. When a page needs the user (a ' +
  `sign-in, CAPTCHA, 2FA, payment, or anything you shouldn't do for them), call ${HAND_OFF_TOOL}: they do it ` +
  'themselves in their own Chrome. Never ask them for passwords or codes, in the chat or anywhere else. To show them ' +
  `something on a page, call ${SHOW_TOOL}.`

export const YOUR_CHROME_INSTRUCTIONS =
  "The browser is the user's own Chrome: your tabs are in this space's blue Kothar tab group there, with the user's " +
  "logins, and you can't see or touch their other tabs. If a site wants a sign-in, the user signs in there themselves " +
  `through ${HAND_OFF_TOOL}, and you carry on signed in.`

export const HAND_OFF_DESCRIPTION =
  "Brings your tab to the front in the user's own Chrome, for what only they can or should do: sign in, solve a " +
  'CAPTCHA, enter a 2FA code, pay, confirm. They do it there, with their own logins, and this call waits until they ' +
  'click Done (or send you a message). Never ask for passwords or codes yourself. Then this returns the open tabs; ' +
  'take a browser_snapshot before acting again, as the page may have changed. If another chat in this space is ' +
  'waiting on the user, this waits its turn.'

export const SHOW_DESCRIPTION =
  "Brings your tab to the front in the user's own Chrome so they can look at something: a page, a result, a problem " +
  'you want them to see. This call waits until they click Done (or send you a message), then returns the open tabs. ' +
  `For something they must do (sign in, pay, confirm), use ${HAND_OFF_TOOL} instead.`

export const BASE_SETTINGS: ExtensionSetting[] = [
  {
    key: 'askEachAction',
    label: 'Ask before each browser action',
    description:
      'Each browser tool call waits for your approval. Off, the agent browses without asking. pi never asks.',
    type: 'boolean',
    default: false,
  },
]

// What Kothar's own profile mode kept in the extension's folder: a profile per space for each browser it ran on, and
// copies of the user's profiles before that. Logins and cookies, so they go when the extension starts.
export const OLD_PROFILE_FOLDERS = ['chrome-profiles', 'edge-profiles', 'brave-profiles', 'arc-profiles', 'chromium-profiles', 'profiles', 'mirrors']

export type BrowserExtensionOptions = {
  // Tests start the relay on a spare port, with the fake extension's Origin.
  relay?: Partial<RelayOptions>
  // How long the browser tools wait for a quiet network after an action.
  settleMs?: number
}

type HowEnded = 'done' | 'message' | 'stopped'

export function createBrowserExtension(options: BrowserExtensionOptions = {}) {
  let host: ExtensionHost | undefined

  // Listed in the chat's Activity (the Inspector); a host without activity (a test's) skips it.
  const activityOf = (chatId: string, title: string, detail?: string) => {
    try {
      if (typeof host?.activity === 'function') host.activity({ kind: 'browser', chatId, title, ...(detail && { detail }) })
    } catch {
      // The chat is gone: nothing to list it under.
    }
  }

  const spaceIdOf = (chatId: string) => host?.space(chatId)?.id

  // The relay to the Kothar Chrome extension, from start to stop.
  let relay: Relay | undefined
  let relayStarting: Promise<Relay | undefined> | undefined
  const startTheRelay = async () => {
    if (!host) return
    relayStarting ??= startRelay({
      stateFile: join(host.storage.dir, 'chrome-extension.json'),
      nameOf: (spaceId) => host?.space(spaceId)?.name,
      onChange: () => host?.refresh?.(),
      ...options.relay,
    })
      .then((started) => {
        relay = started
        host?.refresh?.()
        return started
      })
      .catch(() => (relayStarting = undefined))
    await relayStarting
  }

  // The space's DevTools endpoint on the relay; fails at once, saying why, while the extension isn't connected.
  const cdpUrl = async (spaceId: string) => {
    if (!relay?.connected) throw new Error(NOT_CONNECTED)
    return relay.cdpUrl(spaceId)
  }
  const browserTools = createBrowserTools({
    host: () => host,
    spaceIdOf,
    endpointOf: cdpUrl,
    activity: (chatId, title, detail) => activityOf(chatId, title, detail),
    ready: () => !!relay,
    ...(options.settleMs !== undefined && { settleMs: options.settleMs }),
  })

  // Brings the space's group to the front in the user's Chrome, with the chat's own tab showing when it has one.
  const focus = (spaceId: string, chatId?: string) => {
    if (!relay) return Promise.reject(new Error(NOT_CONNECTED))
    return relay.focus(spaceId, chatId === undefined ? undefined : browserTools.tabOf(chatId))
  }

  // Chats waiting on the user in their Chrome, and how each ended.
  const chromeWaits = new Map<string, (how: HowEnded) => void>()
  // Each space's line of hand-offs (its last one's end), and the chats waiting in a line, by how to drop each, so the
  // user is asked one thing at a time per space.
  const handOffs = new Map<string, Promise<void>>()
  const queued = new Map<string, Set<() => void>>()
  const dropQueued = (chatId: string) => {
    for (const drop of queued.get(chatId) ?? []) drop()
  }

  const resultText = (how: HowEnded, tabs: RelayTab[]) => {
    const said = {
      done: 'The user is done.',
      message: 'The user sent you a message instead of clicking Done; it follows this result.',
      stopped: 'The hand-off was stopped.',
    }[how]
    const list = tabs.length
      ? tabs.map((t) => `${t.active ? '* ' : '- '}${t.title ? `${t.title} — ` : ''}${t.url}`).join('\n')
      : '(no tabs)'
    return `${said} Your tabs are still in this space's Kothar tab group in the user's Chrome. Open tabs (* is the one in front):\n${list}`
  }

  // Shows the user the chat's tab in their Chrome and waits for Done.
  const inYourChrome = async (spaceId: string, chatId: string, reason: string, tool: string) => {
    if (!relay?.connected) throw new Error(NOT_CONNECTED)
    if (chromeWaits.has(chatId)) throw new Error('This chat is already waiting on the user in Chrome')
    if (!(await focus(spaceId, chatId))) {
      throw new Error("This space has no tabs in the user's Chrome yet; open the page first, then call this again")
    }
    const ended = new Promise<HowEnded>((resolve) => chromeWaits.set(chatId, resolve))
    const title = tool === SHOW_TOOL ? 'An agent wants to show you something' : 'Chrome needs you'
    try {
      host?.notify?.({ chatId, title, body: reason })
    } catch {}
    host?.wait(chatId, {
      text: `Chrome: ${reason}`,
      buttons: [
        { id: 'open', label: 'Show tab', hint: 'Bring this chat’s tab to the front in Chrome' },
        { id: 'done', label: 'Done', primary: true, closes: true, hint: 'The agent carries on' },
      ],
    })
    activityOf(chatId, tool === SHOW_TOOL ? 'Showed you its tab in Chrome' : 'Asked you to take over in Chrome', `Why: ${reason}`)
    const how = await ended
    chromeWaits.delete(chatId)
    try {
      host?.endWait(chatId)
    } catch {}
    const tabs = await relay?.tabs(spaceId).catch(() => [])
    const text = resultText(how, tabs ?? [])
    activityOf(chatId, 'Carried on in Chrome', text)
    return text
  }

  const handOffTool = (name: string, description: string, example: string): ExtensionTool => ({
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', minLength: 1, description: `What the user should do or look at, shown to them, e.g. ${example}` },
      },
      required: ['reason'],
    },
    offered: (caller) => !!relay && !!spaceIdOf(caller.id),
    async run(input, { caller }) {
      const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : 'Your turn'
      const spaceId = spaceIdOf(caller.id)
      if (!spaceId) throw new Error('This chat has no browser')
      if (!relay?.connected) throw new Error(NOT_CONNECTED)
      // One hand-off at a time per space: a chat that asks while another waits on the user waits its turn. Stopping
      // the chat meanwhile drops it from the line.
      const before = handOffs.get(spaceId) ?? Promise.resolve()
      let release!: () => void
      let drop!: () => void
      const turn = new Promise<void>((resolve) => (release = resolve))
      const line = before.then(() => turn)
      handOffs.set(spaceId, line)
      try {
        const dropped = await Promise.race([
          before.then(() => false),
          new Promise<boolean>((resolve) => {
            drop = () => resolve(true)
            queued.set(caller.id, (queued.get(caller.id) ?? new Set()).add(drop))
          }),
        ])
        if (dropped) return 'The chat was stopped while waiting for its turn with the user; nothing was shown to them.'
        return await inYourChrome(spaceId, caller.id, reason, name)
      } finally {
        queued.get(caller.id)?.delete(drop)
        if (!queued.get(caller.id)?.size) queued.delete(caller.id)
        release()
        if (handOffs.get(spaceId) === line) handOffs.delete(spaceId)
      }
    },
  })

  // Settings → Extensions → Browser: setting up the Kothar extension in the user's Chrome, and whether it's connected.
  const settingsView = (): ExtensionView => {
    const children: ExtensionView[] = [{ type: 'heading', text: 'Your Chrome' }]
    if (!relay) return { type: 'stack', gap: 'tight', children: [...children, { type: 'text', text: 'Starting…', tone: 'muted' }] }
    const connected = relay.connected
    children.push(
      {
        type: 'row',
        children: [
          { type: 'text', text: 'Kothar extension' },
          { type: 'badge', text: connected ? 'Connected' : 'Not connected', tone: connected ? 'success' : 'warning' },
        ],
      },
      {
        type: 'text',
        text:
          'Agents work in a blue “Kothar · space” tab group per space, in the Chrome window you last used, with your ' +
          'logins. Their tabs open in the background, so your own tab stays in front. When a site needs you to sign ' +
          'in, the agent brings its tab forward and you sign in there yourself. They can’t see or touch your other ' +
          'tabs; drag a tab out of the group to take it back. While they work, Chrome shows “Kothar started ' +
          'debugging this browser”.',
        small: true,
        tone: 'muted',
      },
    )
    if (!connected) {
      children.push(
        { type: 'text', text: 'Until it’s connected, agents’ browser calls fail and say so. To set it up:', small: true, tone: 'warning' },
        { type: 'text', text: '1. In Chrome, open chrome://extensions and turn on Developer mode.', small: true },
        { type: 'text', text: '2. Click Load unpacked and pick this folder:', small: true },
        { type: 'text', text: EXTENSION_DIR, mono: true, small: true, tone: 'muted', copy: true },
        { type: 'text', text: '3. Click the Kothar extension’s icon and paste this code:', small: true },
      )
    } else {
      children.push({ type: 'text', text: 'Pairing code', small: true, tone: 'faint' })
    }
    children.push(
      { type: 'text', text: relay.code, mono: true, small: true, tone: 'muted', copy: true },
      {
        type: 'row',
        children: [
          {
            type: 'button',
            label: 'New code',
            action: { name: 'repair' },
            hint: 'Makes a new pairing code. The extension disconnects until you paste the new one into it.',
            confirm: { text: 'Make a new pairing code?', body: 'Your Chrome disconnects until you paste the new code.', ok: 'New code' },
          },
        ],
      },
    )
    return { type: 'stack', gap: 'tight', children }
  }

  const extension: Extension = {
    id: 'browser',
    name: 'Browser',
    description:
      'Agents browse in your own Chrome, with your logins, through the Kothar Chrome extension: a blue tab group per ' +
      'space in the window you last used, its tabs opened in the background so nothing takes focus. When a page needs ' +
      'you (a sign-in, CAPTCHA, payment) or the agent wants to show you something, its tab comes to the front, you do ' +
      'it there, and the agent carries on when you click Done.',
    enabledByDefault: false,
    prompts: [
      { id: 'browser', label: 'How to use the browser', text: BROWSER_INSTRUCTIONS, where: 'instructions' },
      { id: 'your-chrome', label: 'Your own Chrome', text: YOUR_CHROME_INSTRUCTIONS, where: 'instructions' },
    ],
    settingsVersion: 4,
    // Version 0 had a picker of where the browser ran (your Chrome, a debugging port, the Playwright Extension, a
    // window, a copy of your Chrome's logins). Version 1 had a Browser picker (installed Chrome or a bundled Chromium).
    // Version 2 could run a copy of one of the user's profiles. Version 3 picked Kothar's own profile per space or the
    // user's Chrome, and closed an idle space's browser. The user's Chrome is the only way now, so all of those go.
    migrateSettings(saved, from) {
      if (from >= 4) return saved
      const {
        engine: _engine,
        profileFolder: _folder,
        profile: _profile,
        idleMinutes: _idle,
        browser: _browser,
        port: _port,
        extensionToken: _token,
        background: _background,
        ...kept
      } = saved
      return kept
    },
    settings: BASE_SETTINGS,

    settingsView: {
      render: () => settingsView(),
      onAction(action) {
        if (action.name === 'repair') relay?.repair()
      },
    },

    setup: {
      description: 'Agents use your own Chrome through the Kothar extension: load it into Chrome and pair it below.',
      // Always ready, so the tools are offered and say what's wrong while the extension isn't connected.
      async check() {
        return { ready: true, message: relay?.connected ? 'Your Chrome is connected' : 'Your Chrome isn’t connected yet: see the steps below' }
      },
      // Nothing Kothar installs: the extension goes into the user's Chrome by hand (Settings shows how).
      async install() {},
    },

    // Sessions that take MCP servers get the browser, so they get this too.
    instructions: ({ tools }, { host: h }) => {
      if (!tools) return undefined
      return `${promptOf(h, 'browser', BROWSER_INSTRUCTIONS)} ${promptOf(h, 'your-chrome', YOUR_CHROME_INSTRUCTIONS)}`
    },

    async onStart({ host: given }) {
      host = given
      // Kothar's own profiles, logins and all, and copies of the user's profiles, that an older Kothar made.
      for (const folder of OLD_PROFILE_FOLDERS) rmSync(join(host.storage.dir, folder), { recursive: true, force: true })
      await startTheRelay()
    },

    async onStop() {
      await browserTools.stop()
      for (const end of chromeWaits.values()) end('stopped')
      for (const chatId of [...queued.keys()]) dropQueued(chatId)
      const closing = relayStarting
      relayStarting = undefined
      relay = undefined
      await (await closing)?.close()
    },

    tools: [
      ...browserTools.tools,
      handOffTool(HAND_OFF_TOOL, HAND_OFF_DESCRIPTION, '"Sign in to GitHub"'),
      handOffTool(SHOW_TOOL, SHOW_DESCRIPTION, '"The chart on this page is empty"'),
    ],

    // From the chat's General tab, at any time: the space's tabs in front in Chrome.
    commands: [
      {
        id: 'show-browser',
        label: 'Show browser',
        hint: 'Bring this space’s Kothar tab group to the front in Chrome',
        shown: (chat) => !!relay?.connected && !!spaceIdOf(chat.id),
        run: (chat) => {
          const spaceId = spaceIdOf(chat.id)
          if (spaceId) return void focus(spaceId, chat.id).catch(() => {})
        },
      },
    ],

    onWaitAction(chat, answer) {
      const waiting = chromeWaits.get(chat.id)
      if (!waiting) return
      if ('message' in answer) return waiting('message')
      if (answer.button === 'open') return void focus(spaceIdOf(chat.id) ?? '', chat.id).catch(() => {})
      if (answer.button === 'done') return waiting('done')
    },

    onStatusChanged(chat: ChatDetail, status) {
      if (status === 'stopping' || status === 'idle') {
        chromeWaits.get(chat.id)?.('stopped')
        dropQueued(chat.id)
      }
    },

    onChatArchived(chat, archived) {
      if (archived) {
        browserTools.forget(chat.id)
        dropQueued(chat.id)
      }
    },

    onChatRemoved(chat) {
      browserTools.forget(chat.id)
      dropQueued(chat.id)
    },
  }

  return { extension, cdpUrl }
}

export default createBrowserExtension().extension
