// A chat's queued messages on disk (<chat>/queue.json), so a quit or a crash doesn't lose them: what the user queued
// with Option+Enter, a worker's report waiting for its busy lead, and a worker's first message waiting for a slot.
// turn.ts writes it whenever the queue changes (setQueue); the chat's loader reads it back. No file means none queued.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { QueuedMessage } from './shared.ts'

export const QUEUE_FILE = 'queue.json'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Writes a chat's queue, or removes the file when it's empty. Written beside it first, then renamed over it. */
export function saveQueue(dir: string, queue: readonly QueuedMessage[]) {
  const file = join(dir, QUEUE_FILE)
  if (!queue.length) return rmSync(file, { force: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(queue, null, 2) + '\n')
  renameSync(temp, file)
}

/**
 * A chat's saved queue. A steered message the old turn never took in goes back to plain queued, as unsteer does. A file
 * that isn't a list of messages reads as none, so a hand edit can't stop the chat from loading.
 */
export function readQueue(dir: string): QueuedMessage[] {
  const file = join(dir, QUEUE_FILE)
  if (!existsSync(file)) return []
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(saved)) return []
  return saved.flatMap((item): QueuedMessage[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string') return []
    const { steering: _, ...message } = item as QueuedMessage
    return [message]
  })
}
