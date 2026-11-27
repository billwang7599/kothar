import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalMachine } from './machine.ts'
import {
  PROCESSES_FILE,
  type ProcessRecord,
  type PsRow,
  readRecords,
  recordingMachine,
  stillOurs,
  stopLeftovers,
} from './process-records.ts'
import { cantPs, needs } from './test-env.ts'
import { until } from './test-wait.ts'

const dirs: string[] = []
const garage = () => {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-procs-')))
  dirs.push(made)
  return made
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const T = Date.parse('2026-11-26T12:00:00Z')
// A process from an earlier Kothar: its pid isn't this test's.
const OTHER = process.pid + 1
const record = (pgid: number, extra: Partial<ProcessRecord> = {}): ProcessRecord => ({
  pgid,
  command: '/usr/local/bin/claude',
  startedAt: T,
  owner: OTHER,
  ...extra,
})
const row = (pid: number, pgid: number, startedAt: number, command = 'claude -p --input-format stream-json'): PsRow => ({
  pid,
  pgid,
  startedAt,
  command,
})
const save = (dir: string, records: ProcessRecord[]) => writeFileSync(join(dir, PROCESSES_FILE), JSON.stringify(records))

describe('stillOurs', () => {
  it('takes a group whose leader runs the command and started when recorded', () => {
    const rows = [row(100, 100, T + 900), row(101, 100, T + 3000, 'bash -c ls')]
    expect(stillOurs(record(100), rows, T + 60_000)).toHaveLength(2)
  })

  it('leaves a reused pid alone: started at another time, or running something else', () => {
    expect(stillOurs(record(100), [row(100, 100, T + 3_600_000)], T + 7_200_000)).toEqual([])
    expect(stillOurs(record(100), [row(100, 100, T, 'vim notes.md')], T + 60_000)).toEqual([])
    expect(stillOurs(record(100), [row(200, 200, T)], T + 60_000)).toEqual([])
  })

  it('with its leader gone, takes what is left only if all of it started after the leader, before this start', () => {
    expect(stillOurs(record(100), [row(101, 100, T + 10_000, 'bash -c make')], T + 60_000)).toHaveLength(1)
    expect(stillOurs(record(100), [row(101, 100, T - 3_600_000, 'bash')], T + 60_000)).toEqual([])
    expect(stillOurs(record(100), [row(101, 100, T + 120_000, 'bash')], T + 60_000)).toEqual([])
  })
})

describe('stopLeftovers', () => {
  it("stops an earlier core's groups that are still its own, keeps this process's records, and forgets the rest", async () => {
    const dir = garage()
    const mine = record(300, { owner: process.pid })
    save(dir, [record(100), record(200), mine])
    const killed: [number, string][] = []
    let rows = [row(100, 100, T), row(200, 200, T + 3_600_000), row(300, 300, T)]
    const stopped = stopLeftovers(dir, {
      list: () => rows,
      kill: (pgid, signal) => killed.push([pgid, signal]) > 0,
      graceMs: 10,
      now: () => T + 60_000,
    })
    expect(stopped.map((r) => r.pgid)).toEqual([100])
    expect(killed).toEqual([[100, 'SIGTERM']])
    expect(readRecords(dir)).toEqual([mine])
    // Still there after the grace: killed outright.
    await until(() => killed.length === 2)
    expect(killed[1]).toEqual([100, 'SIGKILL'])
    rows = []
  })

  it('stops nothing and keeps the records when ps fails', () => {
    const dir = garage()
    save(dir, [record(100)])
    const stopped = stopLeftovers(dir, {
      list: () => {
        throw new Error('no ps')
      },
      kill: () => {
        throw new Error('must not kill')
      },
    })
    expect(stopped).toEqual([])
    expect(readRecords(dir)).toHaveLength(1)
  })

  it('reads a broken file as no records', () => {
    const dir = garage()
    writeFileSync(join(dir, PROCESSES_FILE), '[{"pgid": 1}, "x", {oops')
    expect(stopLeftovers(dir, { list: () => [], kill: () => true })).toEqual([])
  })
})

describe('recordingMachine', () => {
  it('records what it spawns until it exits, and a later start stops one a crashed core left running', async (context) => {
    needs(context, cantPs)
    const dir = garage()
    const machine = recordingMachine(dir, createLocalMachine({ killGraceMs: 50 }))
    const quick = machine.spawn('/bin/sh', ['-c', 'exit 0'], { cwd: dir })
    let quickDone = false
    quick.onExit(() => (quickDone = true))
    const sleeper = machine.spawn('/bin/sleep', ['30'], { cwd: dir })
    let exited = false
    sleeper.onExit(() => (exited = true))
    await until(() => quickDone)
    const records = readRecords(dir)
    expect(records).toMatchObject([{ pgid: sleeper.pid, command: '/bin/sleep', owner: process.pid }])

    // As though this process were a core that crashed: its records now look like another process's.
    save(dir, records.map((r) => ({ ...r, owner: OTHER })))
    const stopped = stopLeftovers(dir, { graceMs: 50 })
    expect(stopped.map((r) => r.pgid)).toEqual([sleeper.pid])
    await until(() => exited)
    expect(existsSync(join(dir, PROCESSES_FILE))).toBe(false)
  })
})
