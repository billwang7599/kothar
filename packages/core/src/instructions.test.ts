import { describe, expect, it } from 'vitest'
import { BROWSER_LAUNCH_RULES, buildInstructions, CHECKOUT_RULES, contextTextOf, FILE_RULES, FOLDER_RULES, type InstructionParts, NO_COMMITS_RULES, WRITE_RULES } from './instructions.ts'
import type { ContextItem } from './shared.ts'

const item = (section: ContextItem['section'], path: string, text: string, more: Partial<ContextItem> = {}): ContextItem => ({
  section,
  path,
  from: 'chat',
  enabled: true,
  text,
  ...more,
})

const EMPTY: InstructionParts = { checkouts: [], folders: [], extensions: [], memory: [], items: [] }

describe('buildInstructions', () => {
  it('joins every part in order: role, rules, extensions, memory, setup, context items', () => {
    const instructions = buildInstructions({
      role: 'ROLE',
      workDir: '/work/space',
      checkouts: [
        { folder: '/code/a', path: '/work/space/a', branch: 'space/a' },
        { folder: '/code/b', path: '/work/space/b', branch: 'space/b' },
      ],
      folders: [
        { path: '/docs', mode: 'edit' },
        { path: '/ref', mode: 'readOnly' },
        { path: '/garage/x', mode: 'readOnly', blocked: "it holds Kothar's own data" },
      ],
      extensions: ['EXTENSION ONE', 'EXTENSION TWO'],
      workers: 'WORKERS',
      memory: ['MEMORY'],
      parentView: 'PARENT VIEW',
      setup: { name: 'Review', instructions: 'SETUP' },
      items: [item('agents', '/garage/AGENTS.md', 'GLOBAL\n'), item('files', '/code/a/notes.md', 'FILE\n\n')],
    })
    expect(instructions.split('\n\n')).toEqual([
      'ROLE',
      `${WRITE_RULES}\nYour work folder: /work/space\n${BROWSER_LAUNCH_RULES}`,
      `${CHECKOUT_RULES}\n- /code/a: /work/space/a (branch space/a)\n- /code/b: /work/space/b (branch space/b)`,
      `${FOLDER_RULES}\n- /docs: Edit in place. Write in it directly.\n- /ref: Read only.\n` +
        "- /garage/x: Read only, since it holds Kothar's own data.",
      FILE_RULES,
      'EXTENSION ONE',
      'EXTENSION TWO',
      'WORKERS',
      'MEMORY',
      "Your parent chat's memory when it started you:",
      'PARENT VIEW',
      'Instructions from the setup "Review":',
      'SETUP',
      'GLOBAL',
      '<file path="/code/a/notes.md">\nFILE\n</file>',
    ])
  })

  it('names the git folders with no commits yet, before their folder modes', () => {
    const instructions = buildInstructions({
      ...EMPTY,
      folders: [
        { path: '/new', mode: 'edit', unborn: true },
        { path: '/docs', mode: 'readOnly' },
      ],
    })
    expect(instructions.split('\n\n')).toEqual([
      `${NO_COMMITS_RULES}\n- /new`,
      `${FOLDER_RULES}\n- /new: Edit in place. Write in it directly.\n- /docs: Read only.`,
      FILE_RULES,
    ])
  })

  it('leaves out what is absent', () => {
    expect(buildInstructions(EMPTY)).toBe(FILE_RULES)
    expect(buildInstructions({ ...EMPTY, role: '', parentView: '', setup: { name: 'Plain' } })).toBe(FILE_RULES)
    expect(buildInstructions({ ...EMPTY, items: [item('agents', '/c/AGENTS.md', 'RULES')] })).toBe(`${FILE_RULES}\n\nRULES`)
  })

  it('keeps the workers instructions even when empty, as before', () => {
    expect(buildInstructions({ ...EMPTY, workers: '', memory: ['MEMORY'] })).toBe(`${FILE_RULES}\n\n\n\nMEMORY`)
  })

  it('tells every session, with Kothar tools or not, to link the files it makes and show its images', () => {
    expect(FILE_RULES).toContain('[name](</absolute/path>)')
    expect(FILE_RULES).toContain('![caption](</absolute/path.png>)')
    expect(FILE_RULES).toContain('in your folders')
    expect(buildInstructions(EMPTY)).toContain(FILE_RULES)
    const withTools = buildInstructions({ ...EMPTY, toolbox: 'TOOLBOX' }).split('\n\n')
    expect(withTools).toEqual([FILE_RULES, 'TOOLBOX'])
  })
})

describe('contextTextOf', () => {
  it('skips switched-off and blank items, notes binary files and tags pasted files', () => {
    expect(
      contextTextOf([
        item('agents', '/c/AGENTS.md', '  RULES  '),
        item('agents', '/c/off.md', 'OFF', { enabled: false }),
        item('files', '/c/blank.md', '  \n'),
        item('files', '/c/logo.png', '', { binary: true }),
      ]),
    ).toEqual([
      'RULES',
      "The file /c/logo.png is not text, so it isn't pasted here. Open it with your tools when you need it.",
    ])
  })
})
