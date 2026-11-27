import { expect, it } from 'vitest'
import type { Settings } from './chat-store.ts'
import { openWorkers, WORKER_INSTRUCTIONS } from './workers.ts'

const open = (settings: Settings) => openWorkers({ settings, saveSettings: () => {}, broadcast: () => {} })

it('the default instructions carry no one user’s working habits', () => {
  expect(WORKER_INSTRUCTIONS).not.toMatch(/stack PR|merge conflicts|worktree/)
})

it('an edit made against an older default keeps its text, and says the default changed', () => {
  const older = `${WORKER_INSTRUCTIONS} Make a stack PR.`
  const workers = open({ engines: {}, workers: { instructions: { text: 'My own way.', base: older } } })
  expect(workers.instructions()).toBe('My own way.')
  expect(workers.info().instructions).toMatchObject({ text: 'My own way.', default: WORKER_INSTRUCTIONS, edited: true, updatedDefault: true })
})

it('with no edit, chats get the current default', () => {
  const workers = open({ engines: {} })
  expect(workers.instructions()).toBe(WORKER_INSTRUCTIONS)
  expect(workers.info().instructions).not.toHaveProperty('updatedDefault')
})
