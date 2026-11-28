import { describe, expect, it } from 'vitest'
import { anchorOf, diffRows, lineLabel, reviewMessage, rowsOf, viewComments, type ReviewComment } from './review.ts'

const DIFF = [
  'diff --git a/a.txt b/a.txt',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
].join('\n')

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  path: '/work/app',
  group: 'uncommitted',
  file: 'a.txt',
  side: 'new',
  start: 2,
  end: 2,
  from: { new: 2 },
  to: { new: 2 },
  quote: '+TWO',
  text: 'Lower case',
  at: '2026-11-28T00:00:00.000Z',
  ...over,
})

describe('diff lines', () => {
  it('numbers lines from the hunk header, and only lines in a hunk take a comment', () => {
    const rows = diffRows(DIFF)
    expect(rows.map((r) => [r.old, r.new, r.commentable])).toEqual([
      [undefined, undefined, false],
      [undefined, undefined, false],
      [undefined, undefined, false],
      [undefined, undefined, false],
      [1, 1, true],
      [2, undefined, true],
      [undefined, 2, true],
      [3, 3, true],
    ])
  })

  it('anchors a range by its lines in the files, and finds it again in a later diff', () => {
    const rows = diffRows(DIFF)
    const at = anchorOf(rows, 5, 6)!
    expect(at).toEqual({ side: 'new', start: 2, end: 2, from: { old: 2 }, to: { new: 2 }, quote: '-two\n+TWO' })
    // Only removed lines: numbered in the old file.
    expect(anchorOf(rows, 5, 5)).toMatchObject({ side: 'old', start: 2, end: 2 })
    expect(anchorOf(rows, 3, 3)).toBeUndefined()
    expect(anchorOf(rows, 6, 99)).toBeUndefined()
    // A line added above moves it down; it's still found.
    const moved = diffRows(DIFF.replace('@@ -1,3 +1,3 @@\n one', '@@ -1,3 +1,4 @@\n+zero\n one'))
    expect(rowsOf(moved, { from: { old: 2 }, to: { new: 3 } })).toEqual({ start: 6, end: 7 })
    // Lines no longer in the diff: listed above it with where they were.
    const gone = viewComments(diffRows('diff --git a/a.txt b/a.txt'), [comment({})])
    expect(gone).toEqual([{ id: 'c1', text: 'Lower case', label: 'a.txt, line 2' }])
    expect(lineLabel(comment({ side: 'old', start: 4, end: 6 }))).toBe('a.txt, lines 4–6 (removed)')
  })
})

describe('the message', () => {
  it("asks the agent to apply every comment, saying which worker's worktree each is about", () => {
    const text = reviewMessage(
      [
        comment({ id: 'c2', file: 'b.ts', start: 10, end: 12, quote: '+x\n+y\n+z', text: 'Name these', group: 'committed' }),
        comment({ path: '/work/workers/w1/app', text: 'Fix here' }),
        comment({}),
      ],
      [
        { path: '/work/app', repo: 'app', branch: 'kothar/space' },
        { path: '/work/workers/w1/app', repo: 'app', branch: 'kothar-worker/w1', worker: 'Fix login' },
      ],
    )
    expect(text).toBe(
      [
        'Please apply all 3 of these review comments on the changes, then say briefly what you changed. Each one quotes the diff lines it\'s about.',
        '',
        '## app on branch kothar/space, at /work/app.',
        '',
        '1. a.txt, line 2 (uncommitted change):',
        '```diff',
        '+TWO',
        '```',
        'Lower case',
        '',
        '2. b.ts, lines 10–12 (committed change):',
        '```diff',
        '+x',
        '+y',
        '+z',
        '```',
        'Name these',
        '',
        '## Worker "Fix login"\'s app worktree on branch kothar-worker/w1, at /work/workers/w1/app. Make these changes there, on that branch, not in the space\'s own checkout.',
        '',
        '3. a.txt, line 2 (uncommitted change):',
        '```diff',
        '+TWO',
        '```',
        'Fix here',
      ].join('\n'),
    )
    expect(reviewMessage([comment({})], [])).toMatch(/^Please apply this review comment/)
  })
})
