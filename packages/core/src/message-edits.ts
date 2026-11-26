// Deleting messages from a chat, and cutting it back to one of the user's messages to edit or undo it. The text really
// leaves the disk (users delete secrets they pasted by mistake): each removed entry becomes an entry.removed, keeping
// only when it was logged, and log.jsonl is written again whole. Indexes stay put, so an extension's marks (a pin) never
// move to another message, and the files only the removed messages used are deleted. Files the agent changed stay as
// they are.
import { readFileSync, rmSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { MessagesRemoved } from '@kothar/extension-api'
import type { Chat } from './chat.ts'
import { rewriteLog } from './chat-store.ts'
import { messagesOf } from './memory.ts'
import type { Attachment, ChatEntry, CoreMessage, QueuedMessage, Upload } from './shared.ts'
import { TOOL_IMAGES_DIR } from './tool-image-files.ts'

type Entry = ChatEntry
type Input = Extract<Entry, { type: 'user.message' | 'worker.report' }>

const isInput = (e: Entry | undefined): e is Input => e?.type === 'user.message' || e?.type === 'worker.report'
// The entries a turn's end leaves to say how it went. A deleted reply keeps them, so a chat whose last reply is deleted
// still reads as finished, not as quit mid-turn (quitMidTurn), and isn't run again at the next start.
const MARKERS = new Set<Entry['type']>(['turn.started', 'turn.completed', 'session.ended'])

/**
 * The entries one Delete takes: the user's message or a worker's report alone; or, for the agent's reply, everything
 * the agent did between the message before it and the one after (its thinking, tool calls, every reply text and
 * extensions' notes), except the turn's markers.
 */
export function entriesToDelete(entries: readonly Entry[], entry: number): number[] {
  const found = entries[entry]
  if (!found || found.type === 'entry.removed') throw new Error('That message is already gone')
  if (isInput(found)) return [entry]
  if (found.type !== 'text.completed') throw new Error('Only messages and replies can be deleted')
  let start = entry
  while (start > 0 && !isInput(entries[start - 1])) start--
  let end = entry + 1
  while (end < entries.length && !isInput(entries[end])) end++
  const taken: number[] = []
  for (let i = start; i < end; i++) if (entries[i]!.type !== 'entry.removed' && !MARKERS.has(entries[i]!.type)) taken.push(i)
  return taken
}

/** Every entry from `entry` on that isn't gone already: what Edit and Undo take. */
export function entriesFrom(entries: readonly Entry[], entry: number): number[] {
  const taken: number[] = []
  for (let i = entry; i < entries.length; i++) if (entries[i]!.type !== 'entry.removed') taken.push(i)
  return taken
}

// Where the running turn starts in the log: its message, or the report that woke it. A chat that isn't running has none.
export function runningFrom(chat: Pick<Chat, 'entries' | 'status' | 'held'>): number {
  if (chat.status === 'idle' && !chat.held) return chat.entries.length
  const starts = (e: Entry) => (e.type === 'user.message' && !e.midTurn) || (e.type === 'worker.report' && e.quiet !== true)
  const start = chat.entries.findLastIndex(starts)
  return start < 0 ? 0 : start
}

// The files an entry keeps in the chat's folder: a message's attachments and a tool result's pictures.
const filesOf = (entry: Entry): string[] => {
  if (entry.type === 'user.message') return (entry.attachments ?? []).map((a) => a.path)
  if (entry.type === 'tool.completed') return (entry.images ?? []).flatMap((image) => (image.path ? [image.path] : []))
  return []
}

export type MessageEditsDeps = {
  broadcast: (message: CoreMessage) => void
  // The latest page of the chat's log, as the UI shows a chat (shownState).
  shownLog: (chat: Chat) => { from: number; entries: Entry[] }
  attachmentsDirOf: (chat: Chat) => string
  // Tells the extensions that are on (onMessagesRemoved).
  removed: (chat: Chat, removed: Omit<MessagesRemoved, 'chat'>) => void
  // Queues a message as if the user had sent it (turn.ts enqueue): it runs at once on an idle chat.
  enqueue: (chat: Chat, message: Omit<QueuedMessage, 'id'>) => void
  checkActive: (chat: Chat) => void
}

export function openMessageEdits(deps: MessageEditsDeps) {
  // Replaces the entries at `taken` with entry.removed, writes the log again, deletes the files nothing else uses (keep:
  // ones the caller still needs), and tells the UI and extensions.
  const remove = (chat: Chat, taken: number[], keep: readonly string[] = []) => {
    if (!taken.length) return
    const first = taken[0]!
    const since = chat.entries[first]!.at
    const firstMessage = messagesOf(chat.entries.slice(0, first)).length
    const files = taken.flatMap((i) => filesOf(chat.entries[i]!))
    for (const i of taken) chat.entries[i] = { at: chat.entries[i]!.at, type: 'entry.removed' }
    rewriteLog(chat.dir, chat.entries)

    const used = new Set([
      ...keep,
      ...chat.entries.flatMap(filesOf),
      ...chat.queue.flatMap((q) => (q.attachments ?? []).map((a) => a.path)),
    ])
    // Only files Kothar saved in the chat's own folders, never a path a log names elsewhere.
    const ours = [deps.attachmentsDirOf(chat), join(chat.dir, TOOL_IMAGES_DIR)].map((dir) => dir + sep)
    for (const path of new Set(files)) {
      if (!used.has(path) && ours.some((dir) => path.startsWith(dir))) rmSync(path, { force: true })
    }

    const { from, entries } = deps.shownLog(chat)
    deps.broadcast({ type: 'chat.log', chatId: chat.info.id, from, entries })
    deps.removed(chat, { entries: taken, firstMessage, since })
  }

  const entryOf = (chat: Chat, raw: unknown) => {
    const entry = Number(raw)
    if (!Number.isInteger(entry) || entry < 0 || entry >= chat.entries.length) throw new Error('No message there')
    return entry
  }

  // The user's own message at entry, for Edit and Undo, on a chat that has stopped.
  const ownMessage = (chat: Chat, raw: unknown) => {
    const entry = entryOf(chat, raw)
    const found = chat.entries[entry]!
    if (found.type !== 'user.message' || found.text.startsWith('[subagent "')) throw new Error('Only your own messages can be edited')
    if (chat.status !== 'idle' || chat.held) throw new Error('Stop the chat first')
    deps.checkActive(chat)
    return { entry, message: found }
  }

  return {
    /** Deletes the message at entry: the user's, a report, or the agent's reply with its tool calls and thinking. */
    deleteMessage(chat: Chat, raw: unknown) {
      const entry = entryOf(chat, raw)
      const taken = entriesToDelete(chat.entries, entry)
      if (taken.some((i) => i >= runningFrom(chat))) throw new Error("That turn is still running. Stop it first, or wait for it to end")
      remove(chat, taken)
    },

    /** Replaces the user's message at entry with text and runs it again, after removing it and everything after it. */
    editMessage(chat: Chat, raw: unknown, rawText: unknown) {
      const { entry, message } = ownMessage(chat, raw)
      const text = typeof rawText === 'string' && rawText.trim() ? rawText : ''
      const attachments: Attachment[] = message.attachments ?? []
      if (!text && !attachments.length) throw new Error('Message is empty')
      remove(chat, entriesFrom(chat.entries, entry), attachments.map((a) => a.path))
      deps.enqueue(chat, { text, ...(attachments.length && { attachments }) })
    },

    /**
     * Removes the user's message at entry and everything after it, and gives back what it said and carried, for the
     * composer. Its attachments are read before they're deleted; the composer sends them again as new uploads.
     */
    undoMessage(chat: Chat, raw: unknown): Extract<CoreMessage, { type: 'chat.undone' }> {
      const { entry, message } = ownMessage(chat, raw)
      const attachments: Upload[] = (message.attachments ?? []).flatMap((a) => {
        try {
          return [{ name: a.name, mimeType: a.mimeType, base64: readFileSync(a.path).toString('base64') }]
        } catch {
          return []
        }
      })
      remove(chat, entriesFrom(chat.entries, entry))
      return { type: 'chat.undone', chatId: chat.info.id, text: message.text, attachments }
    },
  }
}
