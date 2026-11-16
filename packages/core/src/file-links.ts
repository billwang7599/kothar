// File links in a chat: which paths a message mentions really exist where the chat works, and opening one in the
// user's editor or a terminal at its folder. Only paths inside the chat's own places count: its folders, checkouts,
// work folder and files, and its folder in the garage (attachments). Anything else is refused, checked through
// symlinks, so a link can't point the user's apps anywhere else.
import { existsSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Chat } from './chat.ts'
import { editorLaunch, type FileSpot } from './editors.ts'
import { realOr } from './folder-access.ts'
import type { Machine } from './shared.ts'
import { within } from './util.ts'

// How long a check's answer is kept: files come and go while agents work, but a transcript asks about the same paths
// every time it renders.
const CHECK_TTL_MS = 10_000
// The most paths one check answers, and the longest path it looks at.
export const MAX_CHECKED = 200
const MAX_PATH = 1024
const OPEN_TIMEOUT_MS = 15_000

// Pictures a reply may show inline (GET /chats/<id>/image?path=…, server.ts), by extension. SVG is served under a
// CSP that runs nothing, and the window only ever shows it through <img>, where scripts never run anyway.
export const CHAT_IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}
export const MAX_CHAT_IMAGE_BYTES = 25 * 1024 * 1024

/** Why a chat's image wasn't served: each becomes its own HTTP status, which the window turns into a message. */
export type ChatImageRefusal = 'not-found' | 'not-image' | 'too-big'
export type ChatImage = { path: string; mimeType: string; size: number } | { error: ChatImageRefusal }

export type FileLinkDeps = {
  home: string
  platform?: NodeJS.Platform
  machine: Pick<Machine, 'run'>
  now: () => Date
  chainOf: (chat: Chat) => Chat[]
  // A chat's folders, its space's work folder and the checkouts (folder-access.ts).
  terminalRoots: (chat: Chat) => string[]
  openTerminalAt: (dir: string) => Promise<void>
  // settings.json's editor and its custom command, read each time.
  editor: () => { choice?: string; command?: string }
  exists?: (path: string) => boolean
}

export function openFileLinks(deps: FileLinkDeps) {
  const { home, platform = process.platform, exists = existsSync } = deps
  const cache = new Map<string, { path: string | null; at: number }>()

  // Where a relative path may be, in the order it's looked for: checkouts first, where agents edit, then the work
  // folder, the folders themselves and the chat's own folder in the garage.
  const bases = (chat: Chat) => {
    const chain = deps.chainOf(chat)
    return [
      ...chain.flatMap(({ info }) => Object.values(info.worktrees ?? {}).map((w) => w.path)),
      ...chain.flatMap(({ info }) => (info.workDir ? [info.workDir] : [])),
      ...chain.flatMap(({ info }) => (info.extension ? [] : info.folders)),
      ...chain.map((c) => c.dir),
    ]
  }
  const roots = (chat: Chat) => [
    ...deps.terminalRoots(chat),
    ...deps.chainOf(chat).flatMap((c) => [c.dir, ...(c.info.extension ? [] : c.info.files)]),
  ]
  const inRoots = (chat: Chat, path: string) => {
    const real = realOr(path)
    return roots(chat).some((root) => within(real, realOr(root)))
  }

  const expand = (path: string) => path.replace(/^~(?=$|\/)/, home)

  // The absolute path a mention means in this chat, if it's there.
  const find = (chat: Chat, raw: string): string | null => {
    const path = expand(raw.trim())
    if (!path || path.length > MAX_PATH || path.includes('\0')) return null
    const candidates = isAbsolute(path) ? [resolve(path)] : [...new Set(bases(chat))].map((base) => join(base, path))
    return candidates.find((candidate) => exists(candidate) && inRoots(chat, candidate)) ?? null
  }

  // Which of paths exist for this chat: each to its absolute path, or null.
  const checkPaths = (chat: Chat, rawPaths: unknown): Record<string, string | null> => {
    const paths = Array.isArray(rawPaths) ? rawPaths.filter((p): p is string => typeof p === 'string') : []
    const now = deps.now().getTime()
    const found: Record<string, string | null> = {}
    for (const path of paths.slice(0, MAX_CHECKED)) {
      const key = `${chat.info.id}\0${path}`
      const cached = cache.get(key)
      if (cached && now - cached.at < CHECK_TTL_MS) {
        found[path] = cached.path
        continue
      }
      found[path] = find(chat, path)
      cache.set(key, { path: found[path], at: now })
    }
    if (cache.size > 5_000) for (const [key, { at }] of cache) if (now - at >= CHECK_TTL_MS) cache.delete(key)
    return found
  }

  // A path the UI got from checkPaths, checked again: it must still be there and inside the chat's places.
  const checked = (chat: Chat, rawPath: unknown) => {
    const path = typeof rawPath === 'string' ? expand(rawPath) : ''
    if (!isAbsolute(path) || !inRoots(chat, path)) {
      throw new Error(`${path || 'That'} isn't in this chat's folders, checkouts or work folder`)
    }
    if (!exists(path)) throw new Error(`${path} doesn't exist`)
    return realOr(path)
  }

  const lineOf = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined

  // Opens a file (or folder) with the editor in settings, at its line where the editor can.
  // app: 'default' opens it with the system's default app instead (a picture in Preview), whatever the setting.
  const openFile = async (chat: Chat, rawPath: unknown, rawLine?: unknown, rawCol?: unknown, app?: 'default') => {
    const file = checked(chat, rawPath)
    const line = lineOf(rawLine)
    const col = line === undefined ? undefined : lineOf(rawCol)
    const spot: FileSpot = { file, ...(line !== undefined && { line }), ...(col !== undefined && { col }) }
    const { choice, command } = app === 'default' ? { choice: undefined, command: undefined } : deps.editor()
    const launch = editorLaunch(spot, { choice, command, platform, home, exists })
    const { code, stderr } = await deps.machine
      .run(launch.command, launch.args, { cwd: dirname(file), timeoutMs: OPEN_TIMEOUT_MS })
      .catch((error: NodeJS.ErrnoException) => {
        if (error?.code === 'ENOENT') throw new Error(`Couldn't find ${launch.command}`)
        throw error
      })
    if (code !== 0) throw new Error(stderr.trim() || `Couldn't open ${file}`)
  }

  // Opens the user's terminal at a file's folder (or at the folder itself).
  const openTerminalAtFile = async (chat: Chat, rawPath: unknown) => {
    const path = checked(chat, rawPath)
    await deps.openTerminalAt(statSync(path).isDirectory() ? path : dirname(path))
  }

  // A picture a reply shows inline: an absolute path, ~/…, file://… or a path relative to the chat's places, found
  // as a file link is. Only inside the chat's places, through symlinks, and only picture types (by the real file's
  // name too, so a link named .png can't serve another kind of file). Outside the chat's places reads as not found,
  // so the answer doesn't tell what exists elsewhere.
  const image = (chat: Chat, rawPath: unknown): ChatImage => {
    let path = typeof rawPath === 'string' ? rawPath.trim() : ''
    if (/^file:\/\//i.test(path)) {
      try {
        path = fileURLToPath(path)
      } catch {
        return { error: 'not-found' }
      }
    }
    const mimeType = CHAT_IMAGE_TYPES[extname(path).toLowerCase()]
    if (!mimeType) return { error: 'not-image' }
    const found = find(chat, path)
    if (!found) return { error: 'not-found' }
    const real = realOr(found)
    if (CHAT_IMAGE_TYPES[extname(real).toLowerCase()] !== mimeType) return { error: 'not-image' }
    let stat
    try {
      stat = statSync(real)
    } catch {
      return { error: 'not-found' }
    }
    if (!stat.isFile()) return { error: 'not-found' }
    if (stat.size > MAX_CHAT_IMAGE_BYTES) return { error: 'too-big' }
    return { path: real, mimeType, size: stat.size }
  }

  return { checkPaths, openFile, openTerminalAtFile, image }
}
