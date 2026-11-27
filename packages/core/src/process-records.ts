// The processes a core started and hasn't seen end, in <garage>/processes.json, so a core that crashed doesn't leave
// engines (or extensions' processes) running unattended, still able to edit files. A quit stops them all
// (machine.stopAll), and the local machine kills its process groups as its process exits; neither runs when the core is
// killed (SIGKILL, a crash in Electron, a power cut). So each start, once the core holds the garage (garage-lock.ts),
// stops what an earlier core recorded and left running, if it's still the same process group.
//
// A record is a process group: its id (the leader's pid), the command asked for, when it started and which process
// started it. A pid can be reused once its process is gone, so a group is stopped only if its leader still runs the
// command and started when recorded (to the second, as ps tells it); with its leader gone, only if every process left
// in the group started after it did and before this core. Only the local machine's processes are recorded; a remote
// machine would keep its own.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { EngineProcess, Machine } from './shared.ts'

export const PROCESSES_FILE = 'processes.json'
// How far a process's start time, as ps gives it (whole seconds), may sit from when it was recorded.
export const START_SLACK_MS = 5000
export const LEFTOVER_KILL_GRACE_MS = 5000

export type ProcessRecord = { pgid: number; command: string; startedAt: number; owner: number }

// One line of ps: a process, its group, when it started and its command line.
export type PsRow = { pid: number; pgid: number; startedAt: number; command: string }

const isRecord = (value: unknown): value is ProcessRecord => {
  if (typeof value !== 'object' || value === null) return false
  const { pgid, command, startedAt, owner } = value as Record<string, unknown>
  return Number.isInteger(pgid) && (pgid as number) > 1 && typeof command === 'string' && typeof startedAt === 'number' && Number.isInteger(owner)
}

export function readRecords(garage: string): ProcessRecord[] {
  const file = join(garage, PROCESSES_FILE)
  if (!existsSync(file)) return []
  try {
    const saved: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(saved) ? saved.filter(isRecord) : []
  } catch {
    return []
  }
}

function writeRecords(garage: string, records: readonly ProcessRecord[]) {
  const file = join(garage, PROCESSES_FILE)
  if (!records.length) return rmSync(file, { force: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(records, null, 2) + '\n')
  renameSync(temp, file)
}

// Every process, from ps. lstart is the same 24 characters everywhere ("Thu Nov 26 21:58:33 2026") under the C locale.
export function listProcesses(): PsRow[] {
  const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,pgid=,lstart=,command='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$/.exec(line)
    if (!match) return []
    const startedAt = Date.parse(match[3]!.replace(/\s+/g, ' '))
    return Number.isNaN(startedAt) ? [] : [{ pid: Number(match[1]), pgid: Number(match[2]), startedAt, command: match[4]! }]
  })
}

/**
 * Whether a recorded group is still the one this record is about, from ps's rows: the processes in it, if so. The
 * command is matched by its file name anywhere in the leader's command line, as a sandboxed engine runs it through
 * sandbox-exec and a script through its interpreter.
 */
export function stillOurs(record: ProcessRecord, rows: readonly PsRow[], before: number): PsRow[] {
  const group = rows.filter((row) => row.pgid === record.pgid)
  if (!group.length) return []
  const near = (row: PsRow) => Math.abs(row.startedAt - record.startedAt) <= START_SLACK_MS
  const leader = group.find((row) => row.pid === record.pgid)
  if (leader) return near(leader) && leader.command.includes(basename(record.command)) ? group : []
  const after = (row: PsRow) => row.startedAt >= record.startedAt - START_SLACK_MS && row.startedAt <= before
  return group.every(after) ? group : []
}

const signalGroup = (pgid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}

/**
 * Stops the groups an earlier core recorded and left running, that are still the same groups (stillOurs): SIGTERM now,
 * SIGKILL after the grace for any still there. Records this process made are left alone: another core in this process
 * (a restart in place, tests) still runs them. Returns the groups it stopped. The file then keeps only this process's
 * records. Without ps, nothing is stopped and the records are kept for a start that has it.
 */
export function stopLeftovers(
  garage: string,
  options: { list?: () => PsRow[]; kill?: (pgid: number, signal: NodeJS.Signals) => boolean; graceMs?: number; now?: () => number } = {},
): ProcessRecord[] {
  const { list = listProcesses, kill = signalGroup, graceMs = LEFTOVER_KILL_GRACE_MS, now = Date.now } = options
  const records = readRecords(garage)
  const left = records.filter((record) => record.owner !== process.pid)
  if (!left.length) return []
  let rows: PsRow[]
  try {
    rows = list()
  } catch {
    return []
  }
  const before = now()
  const stopped = left.filter((record) => stillOurs(record, rows, before).length > 0)
  for (const { pgid } of stopped) kill(pgid, 'SIGTERM')
  if (stopped.length) {
    const timer = setTimeout(() => {
      let after: PsRow[] = []
      try {
        after = list()
      } catch {
        return
      }
      for (const record of stopped) if (stillOurs(record, after, before).length) kill(record.pgid, 'SIGKILL')
    }, graceMs)
    timer.unref?.()
  }
  writeRecords(garage, records.filter((record) => record.owner === process.pid))
  return stopped
}

/**
 * The machine a core runs on, recording each process group it spawns in the garage until its leader exits. A spawned
 * process the machine doesn't give a pid for (a remote or test machine) isn't recorded. Each change rewrites the file,
 * keeping other cores' records in it (a sibling core of this process).
 */
export function recordingMachine(garage: string, machine: Machine): Machine {
  const change = (update: (records: ProcessRecord[]) => ProcessRecord[]) => {
    try {
      writeRecords(garage, update(readRecords(garage)))
    } catch {
      // A garage that can't be written stops more than this; the process still runs, unrecorded.
    }
  }
  return {
    ...machine,
    spawn(command, args, options): EngineProcess {
      const proc = machine.spawn(command, args, options)
      const pgid = proc.pid
      if (pgid === undefined) return proc
      const record: ProcessRecord = { pgid, command, startedAt: Date.now(), owner: process.pid }
      change((records) => [...records.filter((r) => r.pgid !== pgid), record])
      proc.onExit(() => change((records) => records.filter((r) => !(r.pgid === pgid && r.owner === record.owner && r.startedAt === record.startedAt))))
      return proc
    },
  }
}
