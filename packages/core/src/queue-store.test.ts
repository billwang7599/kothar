import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { QUEUE_FILE, readQueue, saveQueue } from './queue-store.ts'

const dirs: string[] = []
const dir = () => {
  const made = mkdtempSync(join(tmpdir(), 'kothar-queue-'))
  dirs.push(made)
  return made
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

it('saves a queue as plain JSON and reads it back, a steered message as plain queued', () => {
  const d = dir()
  saveQueue(d, [
    { id: 'a', text: 'one', modes: ['x:y'] },
    { id: 'b', text: 'two', steering: true },
    { id: 'c', text: '', report: { chatId: 'w', name: 'W', error: 'cut off' } },
  ])
  expect(JSON.parse(readFileSync(join(d, QUEUE_FILE), 'utf8'))).toHaveLength(3)
  expect(readQueue(d)).toEqual([
    { id: 'a', text: 'one', modes: ['x:y'] },
    { id: 'b', text: 'two' },
    { id: 'c', text: '', report: { chatId: 'w', name: 'W', error: 'cut off' } },
  ])
})

it('removes the file once the queue is empty, and reads none from a missing or broken file', () => {
  const d = dir()
  saveQueue(d, [{ id: 'a', text: 'one' }])
  saveQueue(d, [])
  expect(existsSync(join(d, QUEUE_FILE))).toBe(false)
  expect(readQueue(d)).toEqual([])
  writeFileSync(join(d, QUEUE_FILE), '{ not json')
  expect(readQueue(d)).toEqual([])
  writeFileSync(join(d, QUEUE_FILE), JSON.stringify([{ id: 1 }, 'x', { id: 'ok', text: 'kept' }]))
  expect(readQueue(d)).toEqual([{ id: 'ok', text: 'kept' }])
})
