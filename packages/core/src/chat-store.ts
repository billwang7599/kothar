// The garage's plain files for settings and chats (design rule 9): settings.json, and each chat's chat.json and
// log.jsonl, with the renames older installs need. Only reads and writes; the core keeps chats in memory and decides
// when to save.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelSettings } from './models.ts'
import type { AcpAgent, ChatEntry, ChatInfo, ContextSection, PermissionSwitches } from './shared.ts'
import type { SavedEngineTools } from './engine-tools.ts'
import { moveWorkersSettings, type SavedWorkers } from './workers.ts'

export type Settings = PermissionSwitches &
  ModelSettings & {
    context?: Partial<Record<ContextSection, boolean>>
    extensions?: Record<string, Record<string, unknown>>
    // The version of each extension's saved settings (Extension.settingsVersion), once one has been migrated.
    extensionVersions?: Record<string, number>
    workFolder?: string
    // The master switch for community extensions; off unless the user turned it on.
    communityExtensions?: boolean
    // The terminal Open in Terminal uses: 'auto' or absent for the system's, else one of MAC_TERMINALS by id.
    terminal?: string
    // What file links open with: absent for the system's default app, 'custom' for editorCommand, else an EDITORS id.
    editor?: string
    // The user's own command for files, with {file}, {line} and {col}.
    editorCommand?: string
    // The largest attachment in bytes, 0 for no limit; absent, the default (shared.ts attachmentLimitOf).
    attachmentLimit?: number
    // The user's edits of extensions' prompts, by extension and prompt id (prompts.ts).
    prompts?: Record<string, Record<string, { text: string; base: string }>>
    // Settings → Workers (workers.ts).
    workers?: SavedWorkers
    // The user's edits of Kothar's own prompts (core-prompts.ts), by id.
    corePrompts?: Record<string, { text: string; base: string }>
    // Settings → Engines → Tools: the master switches and each engine's tool choices (engine-tools.ts).
    engineTools?: SavedEngineTools
    // Settings → Engines → Add ACP agent (acp-agents.ts).
    acpAgents?: AcpAgent[]
  }

/** The garage's settings.json, read once; save writes the same object back. Older settings are moved and saved. */
export function openSettings(garage: string) {
  const file = join(garage, 'settings.json')
  const settings: Settings = { engines: {}, ...readJson(file) }
  const save = () => writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  if (moveWorkersSettings(settings)) save()
  return { settings, save }
}

/** Writes a chat's chat.json: its info, and its context switches if any are set. */
export const saveChatFile = (dir: string, info: ChatInfo, context: Record<string, boolean>) => {
  const file = { ...info, ...(Object.keys(context).length ? { context } : {}) }
  writeFileSync(join(dir, 'chat.json'), JSON.stringify(file, null, 2) + '\n')
}

/** Adds one entry to a chat's log.jsonl. */
export const appendEntry = (dir: string, entry: ChatEntry) =>
  appendFileSync(join(dir, 'log.jsonl'), JSON.stringify(entry) + '\n')

/**
 * Writes a chat's whole log.jsonl again, as after the user deletes messages: to a file beside it first, then renamed
 * over it, so a crash leaves the old log or the new one, never half of one. Appends are synchronous too, so none lands
 * in between.
 */
export const rewriteLog = (dir: string, entries: ChatEntry[]) => {
  const file = join(dir, 'log.jsonl')
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, entries.map((entry) => JSON.stringify(entry) + '\n').join(''))
  renameSync(temp, file)
}

/** The ids of the chats stored under chatsDir: each folder with a chat.json. */
export const storedChatIds = (chatsDir: string) =>
  readdirSync(chatsDir).filter((id) => existsSync(join(chatsDir, id, 'chat.json')))

/**
 * A chat's saved files, made if missing. fallback fills what chat.json lacks; declared is an extension's own chat,
 * whose name and extension are its declaration's and which keeps no folders or files. resave says chat.json should be
 * written again: it's new, an extension's, or in an older form.
 */
export const readChat = (dir: string, fallback: ChatInfo, declared?: { name: string; extension: string }) => {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat.json')
  const raw = readJson(file)
  const { context = {}, title, parentId, extension, ...saved } = raw
  const info: ChatInfo = {
    ...fallback,
    ...(title !== undefined && { name: title }),
    ...saved,
    id: fallback.id,
    ...(saved.worker && parentId !== undefined && { parentId }),
    ...(declared && { name: declared.name, extension: declared.extension, folders: [], files: [] }),
  }
  const logFile = join(dir, 'log.jsonl')
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  const entries: ChatEntry[] = log
    .split('\n')
    .filter(Boolean)
    .map((line) => renameEntry(JSON.parse(line)))
  const resave = !existsSync(file) || !!declared || (parentId !== undefined && !info.parentId)
  return { info, context: context as Record<string, boolean>, entries, resave }
}

/**
 * A logged entry under today's type. Logs are append-only history, so entries written before workers and extensions
 * got their names keep the old types: `subagent.report` is `worker.report`, and `mod.note` (with `mod`)
 * `extension.note`.
 */
export function renameEntry<T extends { type: string }>(entry: T): T {
  if (entry.type === 'subagent.report') return { ...entry, type: 'worker.report' }
  if (entry.type !== 'mod.note') return entry
  const { mod, ...rest } = entry as T & { mod?: string }
  return { ...rest, type: 'extension.note', ...(mod !== undefined && { extension: mod }) } as unknown as T
}

/** Whether a chat's log ends inside a turn, as when Kothar quit while it ran. */
export const quitMidTurn = (entries: ChatEntry[]) => {
  const lastTurnEvent = entries.findLast((e) => ['turn.started', 'turn.completed', 'session.ended'].includes(e.type))
  const lastType = entries.at(-1)?.type
  const last = entries.at(-1)
  const lastReport = last?.type === 'worker.report' && last.quiet !== true
  return lastTurnEvent?.type === 'turn.started' || lastType === 'user.message' || lastReport
}

export const readJson = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})
