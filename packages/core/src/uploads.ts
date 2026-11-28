// Files the window sends ahead of their message, streamed over HTTP into <garage>/uploads/ instead of riding the
// WebSocket as base64 (server.ts POST /uploads). A message then names each by its id, and the core moves it into the
// chat's attachments (turn.ts sendMessage). Nothing is read into memory; a file's size is limited by the user's largest
// attachment (Settings), if any, and the disk.
// Staged files a message never took (removed from the composer, a window closed) are swept after a day.
import { randomBytes } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { formatBytes } from './shared.ts'

export const UPLOADS_DIR = 'uploads'

/** A streamed file past the user's largest attachment (Settings): refused, and nothing of it kept. */
export class UploadTooBig extends Error {
  constructor(limit: number, size?: number) {
    super(
      `${size === undefined ? 'The file is' : `The file is ${formatBytes(size)},`} bigger than the largest attachment, ` +
        `${formatBytes(limit)} (change it in Settings).`,
    )
  }
}

// Passes bytes through until more than limit have come, then fails, so a file over the limit stops streaming at once.
const capped = (limit: number) => {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length
      callback(seen > limit ? new UploadTooBig(limit) : null, seen > limit ? undefined : chunk)
    },
  })
}
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
    /**
     * Streams body to a new staged file; its id and size once it's all on disk. limit (bytes; undefined for none):
     * a body that says it's bigger (declaredSize) is refused before anything is written, and one that grows past it is
     * stopped there and deleted (UploadTooBig either way).
     */
    async receive(body: Readable, limit?: number, declaredSize?: number): Promise<{ id: string; size: number }> {
      if (limit !== undefined && declaredSize !== undefined && declaredSize > limit) throw new UploadTooBig(limit, declaredSize)
      mkdirSync(dir, { recursive: true })
      const id = newId()
      const path = join(dir, id)
      try {
        const write = createWriteStream(path, { flags: 'wx' })
        if (limit === undefined) await pipeline(body, write)
        else {
          // Piped by hand, not through pipeline, so a refusal leaves body (the request) open for the 413 that says why.
          const cap = capped(limit)
          body.pipe(cap)
          body.once('error', (error) => cap.destroy(error))
          await pipeline(cap, write).catch((error) => {
            body.unpipe(cap)
            body.pause()
            throw error
          })
        }
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
