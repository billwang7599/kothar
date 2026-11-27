import type { Extension } from '@kothar/extension-api'
import { describe, expect, it } from 'vitest'
import { declaredRoles, openModelRoles } from './model-roles.ts'

const extension = (id: string, modelRoles: unknown): Extension =>
  ({ id, name: id[0]!.toUpperCase() + id.slice(1), description: '', enabledByDefault: true, modelRoles }) as Extension

describe('model roles', () => {
  it("keeps each extension's valid roles, and says why the others were left out", () => {
    const plan = extension('plan', [
      { id: 'planning', label: ' Planning ', description: ' Plans. ' },
      { id: 'planning', label: 'Again' },
      { id: 'Bad Id', label: 'Bad' },
      { id: 'chat', label: 'Chat' },
      { id: 'quiet', label: ' ' },
    ])
    const other = extension('other', [{ id: 'planning', label: 'Mine' }, { id: 'other-review', label: 'Review' }])
    const broken = extension('broken', 'planning')
    const { roles, problems } = declaredRoles([plan, other, broken, extension('none', undefined)])
    expect(roles.map(({ extension, ...role }) => ({ ...role, by: extension.id }))).toEqual([
      { id: 'planning', label: 'Planning', description: 'Plans.', by: 'plan' },
      { id: 'other-review', label: 'Review', by: 'other' },
    ])
    expect(problems.get('plan')).toBe(
      'Model role "planning" was left out: it is declared twice. ' +
        'Model role "Bad Id" was left out: its id must be lowercase letters, digits and dashes. ' +
        'Model role "chat" was left out: it\'s one of Kothar\'s own. ' +
        'Model role "quiet" was left out: it needs a label',
    )
    expect(problems.get('other')).toBe('Model role "planning" was left out: Plan declares it')
    expect(problems.get('broken')).toBe('modelRoles must be a list')
    expect(problems.has('none')).toBe(false)
  })

  it("knows Kothar's roles and every declared one, but runs only those of extensions that are on", () => {
    const plan = extension('plan', [{ id: 'planning', label: 'Planning' }])
    const research = extension('research', [{ id: 'searching', label: 'Searching', description: 'Research.' }])
    const on = new Set(['plan'])
    const roles = openModelRoles([plan, research], (e) => on.has(e.id))
    for (const role of ['chat', 'workers', 'planning', 'searching']) expect(roles.known(role)).toBe(true)
    expect(roles.known('nope')).toBe(false)
    expect(roles.known(3)).toBe(false)
    expect(['chat', 'workers', 'planning', 'searching', 'nope'].map(roles.live)).toEqual([true, true, true, false, false])
    expect(['chat', 'workers', 'searching', 'nope'].map(roles.label)).toEqual(['Chat', 'Workers', 'Searching', 'nope'])
    expect(roles.of(research)).toEqual([{ id: 'searching', label: 'Searching', description: 'Research.' }])
    expect(roles.for((e) => e.id === 'research').map((r) => r.id)).toEqual(['searching'])
    on.add('research')
    expect(roles.live('searching')).toBe(true)
  })
})
