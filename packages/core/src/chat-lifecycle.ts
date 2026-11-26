// A chat's life: loaded from the garage at start, made (a space, or a worker below a chat), renamed, archived, moved in
// the sidebar, and deleted with every chat below it. The core holds the chats map and passes in what these need; the
// files themselves are read and written by chat-store.ts.
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatDetail, Extension, ExtensionContext, SpaceDetail } from '@kothar/extension-api'
import type { Chat } from './chat.ts'
import { quitMidTurn, readChat, storedChatIds } from './chat-store.ts'
import type { DeclaredChat } from './community-load.ts'
import { checkPath } from './context.ts'
import type { ExtensionHook } from './extensions.ts'
import { PARENT_VIEW_FILE } from './instruction-parts.ts'
import { messagesOf } from './memory.ts'
import type { openModels } from './models.ts'
import { readQueue } from './queue-store.ts'
import { WORKER_SETUP } from './setups.ts'
import {
  bySpaceOrder,
  UNPIN_NEIGHBOURS,
  type UnpinSpot,
  type ChatEntry,
  type ChatInfo,
  type ChatState,
  type CoreMessage,
  type MemoryMessage,
  type ModelRole,
  type NewChat,
  type QueuedMessage,
  type WorkerCheckout,
  type Setup,
} from './shared.ts'

// What createChat takes: a new space from the UI or an extension, or (parentId and worker) a worker below a chat.
export type ChatSpec = NewChat & {
  parentId?: string
  worker?: boolean
  role?: ModelRole
  setup?: string
  quiet?: boolean
  showReport?: boolean
  // A worker's checkouts: its own worktrees or the space's. Absent: Settings → Workers for an agent's or a shown
  // worker, the space's for a quiet one (an extension's own work, such as research, rarely edits a repo).
  checkout?: WorkerCheckout
}

export type ChatLifecycleDeps = {
  chats: Map<string, Chat>
  chatsDir: string
  home: string
  now: () => Date
  broadcast: (message: CoreMessage) => void
  // The chats extensions declare (Home), loaded first and named as declared.
  extensionChats: readonly DeclaredChat[]
  models: Pick<ReturnType<typeof openModels>, 'engineFor' | 'pinOn'>
  // Whether a child can be started on this role: Kothar's own, or one an extension that's on declares.
  liveRole: (role: unknown) => boolean
  checkEngine: (engine: string) => void
  checkEnabled: (engine: string) => void
  chatFor: (chatId: string) => Chat
  parentOf: (chat: Chat) => Chat | undefined
  familyOf: (chat: Chat) => Chat[]
  checkActive: (chat: Chat) => void
  setupOf: (chat: Chat) => Setup | undefined
  setupNamed: (name: unknown) => Setup | undefined
  saveChat: (chat: Chat) => void
  updateChat: (chat: Chat, change: Partial<ChatInfo>) => void
  append: (chat: Chat, entry: ChatEntry) => void
  shownState: (chat: Chat) => ChatState
  detailOf: (chat: Chat) => ChatDetail
  spaceOf: (chat: Chat) => SpaceDetail
  // A parent's memory as a new worker's frozen view of it.
  viewOf: (chat: Chat, messages: MemoryMessage[], tools: boolean) => string
  takesMcp: (engine: string) => boolean
  callExtensions: (hook: ExtensionHook, run: (extension: Extension, context: ExtensionContext) => unknown) => void
  // What ends with a removed chat: its session, its panels, its work folder.
  stopSession: (chat: Chat) => void
  forgetChat: (chatId: string) => void
  removeWorkDir: (chat: Chat) => Promise<void>
  // Adds a message to a chat's queue without sending it (it runs once the core resumes, turn.ts resumeQueues).
  queueMessage: (chat: Chat, message: Omit<QueuedMessage, 'id'>) => void
  // Whether a sidebar group with this id exists (groups.ts).
  hasGroup: (id: string | undefined) => boolean
  // Settings → Workers: whether a new worker gets worktrees of its own by default.
  ownCheckouts: () => boolean
}

// Why a worker Kothar's quit or crash cut off reported early, in its report to its lead.
export const CUT_OFF_BY_RESTART =
  'Kothar quit or restarted while it worked, so it was cut off. Its chat is kept: send it a message with send_message ' +
  'to carry on where it stopped, or start a new worker.'

export const checkName = (name: unknown) => {
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  if (!trimmed) throw new Error('A chat needs a name')
  return trimmed
}

const checkRemovable = (chat: Chat) => {
  if (chat.info.extension) throw new Error(`${chat.info.name} cannot be archived or deleted`)
  if (chat.status !== 'idle') throw new Error('Stop the running chat first')
}

// Where an unpinned space goes back in its place (the spaces it lands among, in order): next to the nearest of its old
// neighbours still there, closest first and the one above winning a tie; else its old index; with no spot saved (pinned
// before spots were kept, or a hand-edited chat.json), at the top.
export function unpinIndex(spot: UnpinSpot | undefined, place: Pick<ChatInfo, 'id'>[]): number {
  if (!spot || typeof spot !== 'object') return 0
  const ids = place.map((c) => c.id)
  const near = (list: unknown) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [])
  const [above, below] = [near(spot.above), near(spot.below)]
  for (let i = 0; i < Math.max(above.length, below.length); i++) {
    const up = ids.indexOf(above[i] ?? '')
    if (up >= 0) return up + 1
    const down = ids.indexOf(below[i] ?? '')
    if (down >= 0) return down
  }
  return Number.isInteger(spot.index) ? spot.index : 0
}

export function openChatLifecycle(deps: ChatLifecycleDeps) {
  const { chats, chatsDir, now, broadcast, models } = deps

  const loadChat = (dir: string, fallback: ChatInfo) => {
    const declared = deps.extensionChats.find((chat) => chat.id === fallback.id)
    const { info, context, entries, resave } = readChat(
      dir,
      fallback,
      declared && { name: declared.name, extension: declared.extension.id },
    )
    const chat: Chat = {
      info,
      dir,
      context,
      entries,
      status: 'idle',
      unsavedText: '',
      pendingRequests: new Map(),
      waits: new Map(),
      queue: readQueue(dir),
      turns: 0,
    }
    if (resave) deps.saveChat(chat)
    chats.set(info.id, chat)
    if (quitMidTurn(entries)) {
      deps.append(chat, { at: now().toISOString(), type: 'turn.completed', error: 'Kothar quit during this turn' })
    }
    return chat
  }

  const freshInfo = (id: string, name: string): ChatInfo => ({
    id,
    name,
    folders: [],
    files: [],
    engine: models.engineFor(),
    archived: false,
    createdAt: now().toISOString(),
  })

  // Once, as the core opens: extensions' chats first, then every chat in the garage, then the workers left over from
  // before (restartedWorker). Nothing runs yet: what this queues runs once the core resumes.
  const loadAll = () => {
    for (const { id, name } of deps.extensionChats) loadChat(join(chatsDir, id), freshInfo(id, name))
    for (const id of storedChatIds(chatsDir)) {
      if (chats.has(id)) continue
      loadChat(join(chatsDir, id), freshInfo(id, id))
    }
    for (const chat of [...chats.values()]) restartedWorker(chat)
  }

  // A worker is there for one task and goes once its lead has its report, so one still here at start was stopped by
  // Kothar quitting or crashing, or quit between reporting and going. Which, by its log and its lead's:
  // - its lead has read its report (in its log, after the worker's last entry): it's done, and goes. A report still
  //   queued for the lead keeps the worker as it is.
  // - its last turn ended well and wasn't reported (Kothar quit as it finished): it reports, as it would have, and goes.
  // - it was cut off mid-task: it stays, idle, with its log, and its lead gets a report saying so, which wakes it to
  //   carry the worker on with send_message or start another. Once that report is in the lead's log, the next start
  //   takes the worker away unless it has worked since.
  // A quiet worker (an extension's) goes as before: its extension, which hasn't started yet, owns its work. One that
  // never started (no log, as when it waited for a slot) stays, with its first message in its queue.
  const restartedWorker = (chat: Chat) => {
    if (!chat.info.worker || !chat.entries.length) return
    const parent = deps.parentOf(chat)
    const gone = () => {
      chats.delete(chat.info.id)
      rmSync(chat.dir, { recursive: true, force: true })
    }
    if (!parent || chat.info.quiet) return gone()
    const id = chat.info.id
    const lastAt = chat.entries.at(-1)!.at
    // Still queued for its lead, which hasn't read it yet: kept as it is, so the lead can carry it on.
    if (parent.queue.some((q) => q.report?.chatId === id)) return
    if (parent.entries.some((e) => e.type === 'worker.report' && e.chatId === id && e.at >= lastAt)) return gone()
    const asked = chat.entries.findLastIndex((e) => e.type === 'user.message')
    const reply = chat.entries.slice(asked + 1).findLast((e) => e.type === 'text.completed')
    const text = reply?.type === 'text.completed' ? reply.text : ''
    const ended = chat.entries.findLast((e) => e.type === 'turn.completed' || e.type === 'session.ended')
    const finished = !quitMidTurn(chat.entries) && ended?.type === 'turn.completed' && !ended.error
    const report = { chatId: id, name: chat.info.name, ...(!finished && { error: CUT_OFF_BY_RESTART }) }
    deps.queueMessage(parent, { text, report })
    if (finished) gone()
  }

  const createChat = (spec: ChatSpec) => {
    const name = checkName(spec.name)
    const parent = spec.worker ? deps.chatFor(spec.parentId ?? '') : undefined
    if (parent && spec.setup !== undefined) throw new Error(WORKER_SETUP)
    const setup = parent ? deps.setupOf(parent) : spec.setup === undefined ? undefined : deps.setupNamed(spec.setup)
    if (spec.engine !== undefined) {
      deps.checkEngine(spec.engine)
      deps.checkEnabled(spec.engine)
    }
    const role = parent ? (spec.role ?? 'workers') : undefined
    // Named engine: the chat's own pick of that engine's first model in its list, else the engine's default model.
    // Otherwise it follows its list (a worker: its role's, else Workers', else Chat's).
    const pin = spec.engine === undefined ? undefined : models.pinOn(spec.engine, role)
    const engine = spec.engine ?? models.engineFor(role, setup)
    if (parent) deps.checkActive(parent)
    // An agent's worker can't start workers itself (spawn_worker isn't offered to it), but an extension it uses can,
    // one level down, so research it runs doesn't wait for the slot its own worker holds. No deeper.
    if (parent?.info.worker && deps.parentOf(parent)?.info.worker) throw new Error("A worker's worker cannot start chats")
    const folders = [...new Set((spec.folders ?? []).map((path) => checkPath(path, 'folders', deps.home)))]
    const files = [...new Set((spec.files ?? []).map((path) => checkPath(path, 'files', deps.home)))]
    let id = randomBytes(4).toString('hex')
    while (chats.has(id)) id = randomBytes(4).toString('hex')
    const parentMessages = parent && messagesOf(parent.entries)
    const info: ChatInfo = {
      id,
      name,
      ...(parent && parentMessages && {
        parentId: parent.info.id,
        worker: true,
        role,
        parentMessages: parentMessages.length,
        ...(spec.quiet === true && { quiet: true as const }),
        ...(spec.quiet === true && spec.showReport === true && { showReport: true as const }),
        checkout: spec.checkout ?? (spec.quiet !== true && deps.ownCheckouts() ? 'own' : 'shared'),
      }),
      folders,
      files,
      engine,
      archived: false,
      createdAt: now().toISOString(),
      ...pin,
      ...(!parent && setup && { setup: setup.id }),
    }
    const chat = loadChat(join(chatsDir, id), info)
    if (parent && parentMessages?.length) {
      writeFileSync(join(chat.dir, PARENT_VIEW_FILE), deps.viewOf(parent, parentMessages, deps.takesMcp(engine)))
    }
    broadcast({ type: 'chat.added', chat: deps.shownState(chat) })
    deps.callExtensions('onChatCreated', (extension, context) => extension.onChatCreated!(deps.detailOf(chat), context))
    return chat.info
  }

  // A chat below another, for one task: what spawn_worker and an extension's host.createChat with a parentId both make.
  const createChild = (parentId: string, spec: NewChat & { role?: ModelRole; quiet?: boolean; showReport?: boolean; checkout?: WorkerCheckout }) => {
    if (spec.folders?.length || spec.files?.length) throw new Error('A child chat takes its folders from its space')
    if (spec.role !== undefined && !deps.liveRole(spec.role)) throw new Error(`Unknown role "${spec.role}"`)
    if (spec.checkout !== undefined && spec.checkout !== 'own' && spec.checkout !== 'shared') throw new Error('A checkout is "own" or "shared"')
    const quiet = spec.quiet === true
    return createChat({
      name: spec.name,
      engine: spec.engine,
      parentId,
      worker: true,
      role: spec.role,
      quiet,
      showReport: quiet && spec.showReport === true,
      ...(spec.checkout && { checkout: spec.checkout }),
    })
  }

  const renameChat = (chat: Chat, name: unknown) => {
    if (chat.info.extension) throw new Error(`${chat.info.name} cannot be renamed`)
    deps.updateChat(chat, { name: checkName(name) })
  }

  const archiveChat = (chat: Chat, archived: boolean) => {
    const parent = deps.parentOf(chat)
    if (!archived && parent?.info.archived) throw new Error(`Unarchive "${parent.info.name}" first`)
    const family = deps.familyOf(chat)
    family.forEach(checkRemovable)
    family.forEach((c) => deps.updateChat(c, { archived }))
    for (const c of family) {
      deps.callExtensions('onChatArchived', (extension, context) => extension.onChatArchived!(deps.detailOf(c), archived, context))
    }
  }

  // Moves a space to index among the pinned spaces or the others, renumbering that place's order. Unpinned spaces are
  // placed among the spaces in their own group (or the ungrouped ones); `group` moves the space into a group first
  // (null: out of any group). A pinned space keeps its group for when it's unpinned, and remembers its spot
  // (ChatInfo.unpinTo): unpinning with no index puts it back there.
  const moveChat = (chat: Chat, pinned: boolean, index: unknown, group?: unknown) => {
    if (chat.info.extension || chat.info.parentId) throw new Error('Only spaces can be moved or pinned')
    if (chat.info.archived) throw new Error('This chat is archived. Unarchive it first.')
    const restore = index === undefined && !pinned && !!chat.info.pinned
    if (!restore && (typeof index !== 'number' || !Number.isInteger(index))) {
      throw new Error('The place to move to must be a number')
    }
    if (group !== undefined && group !== null && (typeof group !== 'string' || !deps.hasGroup(group))) {
      throw new Error('No such group')
    }
    const groupOf = (info: ChatInfo) => (deps.hasGroup(info.group) ? info.group : undefined)
    const own = group === undefined ? groupOf(chat.info) : (group ?? undefined)
    // The active spaces in a place (Pinned, or a group's unpinned ones), in sidebar order.
    const spacesIn = (inPinned: boolean, inGroup: string | undefined) =>
      [...chats.values()]
        .map((c) => c.info)
        .filter(
          (c) =>
            !c.extension &&
            !c.parentId &&
            !c.archived &&
            !!c.pinned === inPinned &&
            (inPinned || groupOf(c) === inGroup),
        )
        .sort(bySpaceOrder)
    // Pinning: where it sits now, for Unpin.
    let spot: UnpinSpot | undefined
    if (pinned && !chat.info.pinned) {
      const before = spacesIn(false, groupOf(chat.info)).map((c) => c.id)
      const at = before.indexOf(chat.info.id)
      spot = {
        above: before.slice(Math.max(0, at - UNPIN_NEIGHBOURS), at).reverse(),
        below: before.slice(at + 1, at + 1 + UNPIN_NEIGHBOURS),
        index: at,
      }
    }
    const place = spacesIn(pinned, own).filter((c) => c.id !== chat.info.id)
    const at = restore ? unpinIndex(chat.info.unpinTo, place) : (index as number)
    place.splice(Math.max(0, Math.min(at, place.length)), 0, chat.info)
    place.forEach((info, order) => {
      const c = chats.get(info.id)!
      const change: Partial<ChatInfo> = {}
      if (c.info.order !== order) change.order = order
      if (!!c.info.pinned !== pinned) change.pinned = pinned || undefined
      if (c === chat && group !== undefined && c.info.group !== own) change.group = own
      if (c === chat && spot) change.unpinTo = spot
      // Unpinned, by Unpin or a drop at a place of the user's, the old spot is spent.
      if (c === chat && !pinned && c.info.unpinTo) change.unpinTo = undefined
      if (Object.keys(change).length) deps.updateChat(c, change)
    })
  }

  // Removes each chat with its folder, without checks: deleteChat, and a finished worker (turn.ts).
  const removeChats = (family: Chat[]) => {
    const spaces: SpaceDetail[] = []
    for (const c of family) {
      deps.stopSession(c)
      const detail = deps.detailOf(c)
      if (!c.info.parentId && !c.info.extension) spaces.push(deps.spaceOf(c))
      chats.delete(c.info.id)
      deps.forgetChat(c.info.id)
      rmSync(c.dir, { recursive: true, force: true })
      broadcast({ type: 'chat.removed', chatId: c.info.id })
      deps.removeWorkDir(c).catch((error) => broadcast({ type: 'error', message: String(error) }))
      deps.callExtensions('onChatRemoved', (extension, context) => extension.onChatRemoved!(detail, context))
    }
    for (const space of spaces) {
      deps.callExtensions('onSpaceRemoved', (extension, context) => extension.onSpaceRemoved!(space, context))
    }
  }

  const deleteChat = (chat: Chat) => {
    const family = deps.familyOf(chat)
    family.forEach(checkRemovable)
    removeChats(family)
  }

  return { loadAll, createChat, createChild, renameChat, archiveChat, moveChat, removeChats, deleteChat }
}
