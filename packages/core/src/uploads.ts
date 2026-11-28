// Files the window sends ahead of their message, streamed over HTTP into <garage>/uploads/ instead of riding the
// WebSocket as base64 (server.ts POST /uploads). A message then names each by its id, and the core moves it into the
// chat's attachments (turn.ts sendMessage). Nothing is read into memory, so a file's size is limited only by the disk.
// Staged files a message never took (removed from the composer, a window closed) are swept after a day.
import { randomBytes } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const UPLOADS_DIR = 'uploads'
const ID = /^[0-9a-f]{32}$/
const STALE_MS = 24 * 60 * 60 * 1000

// A hard link where it can be made, else a copy (another disk); fails if dest exists, either way.
function linkOrCopy(source: string, dest: string) {
  try {
    linkSync(source, dest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(source, dest, 1 /* COPYFILE_EXCL */)
  }
}

export function openUploads(garage: string, now: () => Date = () => new Date()) {
  const dir = join(garage, UPLOADS_DIR)
  const pathOf = (id: unknown) => (typeof id === 'string' && ID.test(id) ? join(dir, id) : undefined)
  const newId = () => randomBytes(16).toString('hex')

  return {
    /** Streams body to a new staged file; its id and size once it's all on disk. */
    async receive(body: Readable): Promise<{ id: string; size: number }> {
      mkdirSync(dir, { recursive: true })
      const id = newId()
      const path = join(dir, id)
      try {
        await pipeline(body, createWriteStream(path, { flags: 'wx' }))
      } catch (error) {
        rmSync(path, { force: true })
        throw error
      }
      return { id, size: statSync(path).size }
    },
    /** A staged file's size, or undefined if there's no such upload. */
    sizeOf(id: unknown) {
      const path = pathOf(id)
      return path && existsSync(path) ? statSync(path).size : undefined
    },
    /** Moves a staged file to dest, which must not exist yet (EEXIST otherwise, as writeFileSync's 'wx'). */
    take(id: unknown, dest: string) {
      const path = pathOf(id)
      if (!path) throw new Error('Unknown upload')
      linkOrCopy(path, dest)
      rmSync(path, { force: true })
    },
    /** Stages a copy of a file already in the garage (a hard link, so nothing is copied), for the composer to send again. */
    stage(source: string): { id: string; size: number } {
      mkdirSync(dir, { recursive: true })
      const id = newId()
      linkOrCopy(source, join(dir, id))
      return { id, size: statSync(source).size }
    },
    drop(id: unknown) {
      const path = pathOf(id)
      if (path) rmSync(path, { force: true })
    },
    /** Removes staged files older than a day, which no message will take now. */
    sweep() {
      if (!existsSync(dir)) return
      const cutoff = now().getTime() - STALE_MS
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        try {
          if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true })
        } catch {}
      }
    },
  }
}

export type Uploads = ReturnType<typeof openUploads>
