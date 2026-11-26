import { randomBytes } from 'node:crypto'
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// How the kothar CLI (packages/cli) finds a running core and proves it may drive it. While a core runs, it keeps
// <garage>/cli.json: its port and a token of the CLI's own, readable only by the user (0600). The server takes that
// token only on a WebSocket with no Origin header. Browsers always send Origin on a WebSocket, so a web page can never
// use it, and the UI's own token (which lives in the window's URL and storage) is never written to disk. A program the
// user runs can read the file anyway; that's the point, and it could already read the garage itself.
// The core holds the garage alone (garage-lock.ts), so one core writes this file; it removes it on close while it's
// still its own.

export const CLI_FILE = 'cli.json'

export type CliAccess = { port: number; token: string; pid: number }

export const newCliToken = () => randomBytes(32).toString('base64url')

/** Writes the file for this core and returns its removal, which leaves a newer core's file alone. */
export function writeCliAccess(garage: string, access: CliAccess): () => void {
  const file = join(garage, CLI_FILE)
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(access) + '\n', { mode: 0o600 })
  // mode applies only to a new file; a temp file left by a crash keeps the mode it had.
  chmodSync(temp, 0o600)
  renameSync(temp, file)
  return () => {
    try {
      if (readCliAccess(garage)?.token === access.token) unlinkSync(file)
    } catch {}
  }
}

export function readCliAccess(garage: string): CliAccess | undefined {
  try {
    const { port, token, pid } = JSON.parse(readFileSync(join(garage, CLI_FILE), 'utf8'))
    if (!Number.isInteger(port) || typeof token !== 'string' || !token) return undefined
    return { port, token, pid: Number(pid) }
  } catch {
    return undefined
  }
}
