// Composer modes (Extension.composerToggles): one at a time, one-shot, and open to any extension, installed ones too.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Extension, ExtensionHost, ExtensionManifest } from '@kothar/extension-api'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAdapter } from './adapters/fake.ts'
import { sandboxingMachine } from './adapters/test-machine.ts'
import { openCore } from './core.ts'
import { loadCommunityExtensions } from './extensions.ts'
import { communityDir } from './marketplace.ts'
import type { ClientMessage, CoreMessage } from './shared.ts'
import { until } from './test-wait.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-modes-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A Kothar on the fake engine with these built-in extensions (and any community ones), keeping every prompt sent.
function start(extensions: Extension[], options: { garage?: string; community?: Parameters<typeof openCore>[0]['community'] } = {}) {
  const garage = options.garage ?? tempDir()
  const base = createFakeAdapter([{ type: 'text.completed', text: 'Done' }], 0)
  const prompts: string[] = []
  let onPrompt: (() => void) | undefined
  const adapter: typeof base = {
    ...base,
    start(machine, sessionOptions, emit) {
      const session = base.start(machine, sessionOptions, emit)
      return { ...session, prompt: (text, images) => (prompts.push(text), onPrompt?.(), session.prompt(text, images)) }
    },
  }
  const core = openCore({ garage, adapters: [adapter], defaultEngine: 'fake', machine: sandboxingMachine, extensions, community: options.community })
  cleanups.push(() => core.close(true))
  const messages: CoreMessage[] = []
  core.onMessage((m) => messages.push(m))
  const replies: CoreMessage[] = []
  const handle = (m: ClientMessage) => core.handle(m, (r) => replies.push(r)) as unknown as Promise<void> | undefined
  handle({ type: 'engine.setEnabled', engine: 'fake', enabled: true })
  handle({ type: 'workFolder.set', path: join(garage, 'work') })
  const create = (name = 'Space') => {
    handle({ type: 'chat.create', name })
    return core.chats().findLast((c) => c.name === name)!.id
  }
  const chat = (id: string) => core.chats().find((c) => c.id === id)!
  const send = async (chatId: string, text = 'Go') => {
    handle({ type: 'chat.send', chatId, text })
    await until(() => chat(chatId).status === 'idle' && !chat(chatId).queue.length)
  }
  // The modes the picker was last told the chat has, as extension/id and whether picked.
  const listed = (chatId: string) => {
    handle({ type: 'context.get', chatId })
    const found = replies.findLast((m) => m.type === 'chat.extensions' && m.chatId === chatId)
    return found?.type === 'chat.extensions' ? (found.toggles ?? []).map((t) => `${t.extension}/${t.id}${t.on ? ' on' : ''}`) : undefined
  }
  const pick = (chatId: string, extension: string, toggle: string, on = true) =>
    handle({ type: 'extension.toggle', chatId, extension, toggle, on })
  return { core, garage, handle, create, chat, send, listed, pick, prompts, messages, whenPrompted: (run: () => void) => void (onPrompt = run) }
}

// A built-in extension with one mode that puts a word before the message it's sent with.
function stock(id: string, toggle: string, word: string, change: Partial<Extension> = {}): Extension & { host?: ExtensionHost } {
  const extension: Extension & { host?: ExtensionHost } = {
    id,
    name: `Extension ${id}`,
    description: '',
    enabledByDefault: true,
    composerToggles: [{ id: toggle, label: word, icon: 'bolt' }],
    transformMessage: (text, chat, { host }) => (host.toggled(chat.id, toggle) ? `${word}: ${text}` : text),
    onStart: (context) => void (extension.host = context.host),
    onChatCreated: (_chat, context) => void (extension.host = context.host),
    ...change,
  }
  return extension
}

describe('composer modes', () => {
  it('are one at a time: picking one turns any other off, across extensions, and onChange hears of both', async () => {
    const heard: string[] = []
    const a = stock('a', 'research', 'RESEARCH')
    a.composerToggles![0]!.onChange = (on) => void heard.push(`a ${on}`)
    const b = stock('b', 'plan', 'PLAN')
    b.composerToggles![0]!.onChange = (on) => void heard.push(`b ${on}`)
    const t = start([a, b])
    const id = t.create()
    expect(t.listed(id)).toEqual(['a/research', 'b/plan'])
    await t.pick(id, 'a', 'research')
    await t.pick(id, 'b', 'plan')
    expect(t.listed(id)).toEqual(['a/research', 'b/plan on'])
    expect(heard).toEqual(['a true', 'a false', 'b true'])
    // An extension turning its own on does the same.
    a.host!.setToggle(id, 'research', true)
    expect(t.listed(id)).toEqual(['a/research on', 'b/plan'])
    expect(b.host!.toggled(id, 'plan')).toBe(false)
    // Clearing it leaves none.
    await t.pick(id, 'a', 'research', false)
    expect(t.listed(id)).toEqual(['a/research', 'b/plan'])
  })

  it('are one-shot: the message sent takes the mode, the picker goes back to none, and the next message is left alone', async () => {
    const a = stock('a', 'research', 'RESEARCH')
    const t = start([a])
    const id = t.create()
    await t.pick(id, 'a', 'research')
    let during: boolean | undefined
    let picker: string[] | undefined
    t.whenPrompted(() => {
      during = a.host!.toggled(id, 'research')
      picker = t.chat(id).toggles?.a && Object.entries(t.chat(id).toggles!.a!).map(([k, v]) => `${k} ${v}`)
    })
    await t.send(id, 'Why is the sky blue?')
    // On for the turn the message started, as the extension's hooks see it; already off in the composer.
    expect(during).toBe(true)
    expect(picker).toEqual(['research false'])
    expect(t.listed(id)).toEqual(['a/research'])
    expect(a.host!.toggled(id, 'research')).toBe(false)
    t.whenPrompted(() => {})
    await t.send(id, 'Thanks')
    expect(t.prompts.filter((p) => p.includes('RESEARCH: Why is the sky blue?'))).toHaveLength(1)
    expect(t.prompts.some((p) => p.includes('RESEARCH: Thanks'))).toBe(false)
  })

  it('go with a message queued behind a running turn, and only that message', async () => {
    const a = stock('a', 'research', 'RESEARCH')
    const t = start([a])
    const id = t.create()
    t.handle({ type: 'chat.send', chatId: id, text: 'First' })
    expect(t.chat(id).status).toBe('running')
    await t.pick(id, 'a', 'research')
    t.handle({ type: 'chat.send', chatId: id, text: 'Second' })
    expect(t.listed(id)).toEqual(['a/research'])
    expect(t.chat(id).queue.map((q) => q.modes)).toEqual([['a\nresearch']])
    await until(() => t.chat(id).status === 'idle' && !t.chat(id).queue.length)
    expect(t.prompts.some((p) => p.includes('RESEARCH: First'))).toBe(false)
    expect(t.prompts.some((p) => p.includes('RESEARCH: Second'))).toBe(true)
  })

  it('stay picked when the message could not be sent', async () => {
    const t = start([stock('a', 'research', 'RESEARCH')])
    const id = t.create()
    await t.pick(id, 'a', 'research')
    t.handle({ type: 'engine.setEnabled', engine: 'fake', enabled: false })
    await expect(Promise.resolve().then(() => t.handle({ type: 'chat.send', chatId: id, text: 'Go' }))).rejects.toThrow()
    expect(t.listed(id)).toEqual(['a/research on'])
  })

  it('from two extensions may share an id: each is its own, told apart by extension', async () => {
    const t = start([stock('a', 'go', 'ALPHA'), stock('b', 'go', 'BETA')])
    const id = t.create()
    expect(t.listed(id)).toEqual(['a/go', 'b/go'])
    await t.pick(id, 'b', 'go')
    expect(t.listed(id)).toEqual(['a/go', 'b/go on'])
    await t.send(id, 'Hello')
    expect(t.prompts.some((p) => p.includes('BETA: Hello'))).toBe(true)
    expect(t.prompts.some((p) => p.includes('ALPHA: Hello'))).toBe(false)
  })

  it('of an extension that is off are not shown, and a picked one waits, not taken, until it is back', async () => {
    const t = start([stock('a', 'research', 'RESEARCH'), stock('b', 'plan', 'PLAN')])
    const id = t.create()
    await t.pick(id, 'a', 'research')
    t.handle({ type: 'extension.setEnabled', extensionId: 'a', enabled: false })
    expect(t.listed(id)).toEqual(['b/plan'])
    await t.send(id, 'Hello')
    expect(t.prompts.some((p) => p.includes('RESEARCH'))).toBe(false)
    t.handle({ type: 'extension.setEnabled', extensionId: 'a', enabled: true })
    expect(t.listed(id)).toEqual(['a/research on', 'b/plan'])
  })

  it('come from an installed extension through the same public API, and change the message sent with them', async () => {
    const garage = tempDir()
    const dir = join(communityDir(garage), 'shouty')
    mkdirSync(dir, { recursive: true })
    const manifest: ExtensionManifest = { id: 'shouty', name: 'Shouty', version: '1.0.0', author: 'Someone', description: 'Shouts.', api: 1, uses: ['commands'] }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(
      join(dir, 'main.mjs'),
      `export default {
        id: 'shouty', name: 'Shouty', description: 'Shouts.', enabledByDefault: true,
        composerToggles: [{ id: 'shout', label: 'Shout', icon: 'bolt', hint: 'The reply comes in capitals', prefix: 'Reply in capitals.' }],
      }\n`,
    )
    writeFileSync(join(dir, 'installed.json'), JSON.stringify({ source: 'marketplace', repo: 'someone/shouty', tag: 'v1', version: '1.0.0', installedAt: '', sha256: {} }))
    writeFileSync(join(garage, 'settings.json'), JSON.stringify({ communityExtensions: true, extensions: { shouty: { enabled: true } } }))
    const t = start([stock('plan', 'plan', 'PLAN')], { garage, community: await loadCommunityExtensions(garage, () => true) })
    const id = t.create()
    expect(t.listed(id)).toEqual(['plan/plan', 'shouty/shout'])
    await t.pick(id, 'shouty', 'shout')
    await t.send(id, 'hello')
    expect(t.prompts.some((p) => p.includes('Reply in capitals.\n\nhello'))).toBe(true)
    expect(t.chat(id).entries.findLast((e) => e.type === 'user.message')).toMatchObject({ text: 'hello' })
    expect(t.listed(id)).toEqual(['plan/plan', 'shouty/shout'])
  })
})
