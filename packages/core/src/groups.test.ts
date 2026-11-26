import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GROUPS_FILE, openGroups, parseGroups } from './groups.ts'
import { MAX_GROUP_NAME, type CoreMessage } from './shared.ts'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const garage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kothar-groups-'))
  dirs.push(dir)
  return dir
}

describe('parseGroups', () => {
  it('reads groups in order and skips what isn’t one', () => {
    const text = JSON.stringify({
      groups: [{ id: 'a1', name: ' Work ' }, { id: 'a1', name: 'Again' }, { id: 'Bad id', name: 'X' }, { id: 'b2', name: '' }, 3, { id: 'c3', name: 'Play' }],
    })
    expect(parseGroups(text)).toEqual([
      { id: 'a1', name: 'Work' },
      { id: 'c3', name: 'Play' },
    ])
    expect(parseGroups('[{"id":"x","name":"Y"}]')).toEqual([{ id: 'x', name: 'Y' }])
    expect(parseGroups('not json')).toEqual([])
    expect(parseGroups(undefined)).toEqual([])
  })
})

describe('openGroups', () => {
  it('creates, renames, moves and removes groups in groups.json, telling everyone', () => {
    const dir = garage()
    const sent: CoreMessage[] = []
    const groups = openGroups({ garage: dir, broadcast: (m) => sent.push(m) })
    const a = groups.create('A')
    const b = groups.create('B')
    groups.move(b.id, 0)
    groups.rename(a.id, ' Renamed ')
    expect(groups.list().map((g) => g.name)).toEqual(['B', 'Renamed'])
    expect(sent.at(-1)).toEqual({ type: 'groups.updated', groups: groups.list() })
    expect(JSON.parse(readFileSync(join(dir, GROUPS_FILE), 'utf8'))).toEqual({ groups: groups.list() })
    expect(() => groups.create(' ')).toThrow(/name/)
    expect(() => groups.create('x'.repeat(MAX_GROUP_NAME + 1))).toThrow(/characters/)
    expect(() => groups.move(a.id, 0.5)).toThrow(/number/)
    expect(() => groups.remove('nope')).toThrow(/group/)
    groups.remove(b.id)
    expect(groups.has(b.id)).toBe(false)
    expect(openGroups({ garage: dir, broadcast: () => {} }).list()).toEqual([{ id: a.id, name: 'Renamed' }])
  })

  it('starts empty from a broken file', () => {
    const dir = garage()
    writeFileSync(join(dir, GROUPS_FILE), '{oops')
    expect(openGroups({ garage: dir, broadcast: () => {} }).list()).toEqual([])
  })
})
