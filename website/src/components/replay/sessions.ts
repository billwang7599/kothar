// Scripted demo sessions for the homepage's engine cards. These are a replay written by hand, not a recording of a real
// engine run; the page labels them as a replay.

export type Line =
  | { k: 'user'; text: string }
  | { k: 'task'; text: string }
  | { k: 'tool'; name: string; arg: string; out?: string; ms?: number }
  | { k: 'ask'; name: string; arg: string }
  | { k: 'text'; text: string }
  | { k: 'worker'; title: string; stat: string }

export interface Session {
  tag: string
  n: string
  engine: string
  /** Delay before this session's first loop, in ms, so the cards don't move in lockstep. */
  offset: number
  lines: Line[]
}

export const sessions: Session[] = [
  {
    tag: 'CC',
    n: '01',
    engine: 'Claude Code',
    offset: 0,
    lines: [
      { k: 'user', text: 'Pay charges twice on a double click.' },
      { k: 'tool', name: 'Grep', arg: 'submitPayment src/', out: '3 matches' },
      { k: 'text', text: 'Each click makes a new payment intent. I’ll key it by cart.' },
      { k: 'tool', name: 'Edit', arg: 'src/checkout/pay.ts' },
      { k: 'ask', name: 'Bash', arg: 'git push -u origin fix/double-charge' },
      { k: 'text', text: 'Pushed. Ready for a PR.' },
    ],
  },
  {
    tag: 'CX',
    n: '02',
    engine: 'Codex',
    offset: 500,
    lines: [
      { k: 'user', text: 'Receipts show UTC times.' },
      { k: 'tool', name: 'Read', arg: 'src/receipts/format.ts' },
      { k: 'text', text: '`formatDate` ignores the store’s timezone. Passing it through.' },
      { k: 'tool', name: 'Edit', arg: 'src/receipts/format.ts' },
      { k: 'tool', name: 'Bash', arg: 'npm test -- receipts', out: '12 passed', ms: 1500 },
      { k: 'text', text: 'Fixed. 12 tests pass.' },
    ],
  },
  {
    tag: 'OC',
    n: '03',
    engine: 'OpenCode',
    offset: 1000,
    lines: [
      { k: 'user', text: 'Document the new idempotency key.' },
      { k: 'tool', name: 'Read', arg: 'src/checkout/pay.ts' },
      { k: 'tool', name: 'Edit', arg: 'docs/checkout.md' },
      { k: 'text', text: 'Added a section on retries and why the cart version is part of the key.' },
    ],
  },
  {
    tag: 'PI',
    n: '04',
    engine: 'pi',
    offset: 250,
    lines: [
      { k: 'task', text: 'Worker task: add a regression test for the double charge.' },
      { k: 'tool', name: 'write', arg: 'src/checkout/pay.test.ts' },
      { k: 'tool', name: 'bash', arg: 'npm test -- checkout', out: '6 passed', ms: 1500 },
      { k: 'worker', title: 'Regression test for the double charge', stat: '2 files +32 −0' },
    ],
  },
  {
    tag: 'ACP',
    n: '05',
    engine: 'Any ACP agent',
    offset: 750,
    lines: [
      { k: 'user', text: 'Rename API_URL to PAYMENTS_URL.' },
      { k: 'tool', name: 'search', arg: 'API_URL', out: '7 matches in 4 files' },
      { k: 'tool', name: 'edit', arg: '4 files' },
      { k: 'text', text: 'Renamed in 4 files. `.env` is outside my folder, so I left it for you.' },
    ],
  },
]
