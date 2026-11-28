import type { ExtensionDiffComment, ExtensionStorage } from '@kothar/extension-api'

// Review comments: the user's notes on lines of a diff in the Changes tab or its pop-out, kept as a plain JSON file in
// the space's folder until "Send N comments" hands them all to the space's agent in one message.

export const COMMENTS_FILE = 'review-comments.json'
// Each batch sent, appended, so a sent comment isn't lost.
export const SENT_FILE = 'review-sent.jsonl'

export type Group = 'uncommitted' | 'committed'

// Which lines a comment is on: numbers in the new file ('new', for added and unchanged lines) or, for a range of only
// removed lines, in the old one. quote: those lines as the diff showed them, so the agent sees what the user saw.
export type ReviewComment = {
  id: string
  // The checkout or worktree the diff is from (RepoState.target.path), and the file in it.
  path: string
  group: Group
  file: string
  side: 'new' | 'old'
  start: number
  end: number
  // The first and last line picked, by their numbers in the old and the new file (a removed line has only old, an added
  // one only new), to find them again in a diff drawn later.
  from: LineId
  to: LineId
  quote: string
  text: string
  at: string
}

export type LineId = { old?: number; new?: number }

export type DiffRow = { text: string; old?: number; new?: number; commentable: boolean }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

// The same lines and numbers the UI's diff view draws (diff-view.tsx diffLines), so its indexes mean the same here.
export function diffRows(text: string): DiffRow[] {
  let old = 0
  let now = 0
  let inHunk = false
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line): DiffRow => {
      const hunk = line.match(HUNK)
      if (hunk) {
        old = Number(hunk[1])
        now = Number(hunk[2])
        inHunk = true
        return { text: line, commentable: false }
      }
      if (!inHunk || line.startsWith('\\')) return { text: line, commentable: false }
      if (line.startsWith('diff --git')) {
        inHunk = false
        return { text: line, commentable: false }
      }
      if (line.startsWith('+')) return { text: line, new: now++, commentable: true }
      if (line.startsWith('-')) return { text: line, old: old++, commentable: true }
      return { text: line, old: old++, new: now++, commentable: true }
    })
}

// Where a comment the UI sent (diff line indexes) sits in the files, or undefined for lines that can't take one.
export function anchorOf(rows: DiffRow[], start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= rows.length) return undefined
  const picked = rows.slice(start, end + 1).filter((r) => r.commentable)
  if (!picked.length) return undefined
  const newLines = picked.filter((r) => r.new !== undefined).map((r) => r.new!)
  const side: 'new' | 'old' = newLines.length ? 'new' : 'old'
  const numbers = side === 'new' ? newLines : picked.map((r) => r.old!)
  const id = (r: DiffRow): LineId => ({ ...(r.old !== undefined && { old: r.old }), ...(r.new !== undefined && { new: r.new }) })
  return {
    side,
    from: id(picked[0]!),
    to: id(picked.at(-1)!),
    start: Math.min(...numbers),
    end: Math.max(...numbers),
    quote: rows.slice(start, end + 1).map((r) => r.text).join('\n'),
  }
}

// Back from file lines to the diff's indexes, to draw a comment under its lines; undefined once they've left the diff.
export function rowsOf(rows: DiffRow[], comment: Pick<ReviewComment, 'from' | 'to'>) {
  const at = (id: LineId) => rows.findIndex((r) => r.commentable && r.old === id.old && r.new === id.new)
  const first = at(comment.from)
  const last = at(comment.to)
  if (first < 0 || last < first) return undefined
  return { start: first, end: last }
}

export const lineLabel = (c: Pick<ReviewComment, 'file' | 'side' | 'start' | 'end'>) => {
  const lines = c.start === c.end ? `line ${c.start}` : `lines ${c.start}–${c.end}`
  return `${c.file}, ${lines}${c.side === 'old' ? ' (removed)' : ''}`
}

// The comments for a diff view: each drawn under its lines, or listed above the diff once its lines are gone.
export function viewComments(rows: DiffRow[], comments: ReviewComment[]): ExtensionDiffComment[] {
  return comments.map((c) => {
    const at = rowsOf(rows, c)
    return at ? { id: c.id, text: c.text, ...at } : { id: c.id, text: c.text, label: lineLabel(c) }
  })
}

export function loadComments(storage: ExtensionStorage): ReviewComment[] {
  try {
    const saved = JSON.parse(storage.read(COMMENTS_FILE) ?? '[]')
    return Array.isArray(saved) ? saved.filter((c) => typeof c?.id === 'string' && typeof c.text === 'string') : []
  } catch {
    return []
  }
}

export function saveComments(storage: ExtensionStorage, comments: ReviewComment[]) {
  if (comments.length) storage.write(COMMENTS_FILE, `${JSON.stringify(comments, null, 2)}\n`)
  else storage.remove(COMMENTS_FILE)
}

// What each checkout is, for the message: its folder's name, its branch, and whose it is.
export type ReviewTarget = { path: string; repo: string; branch?: string; worker?: string }

const quoteBlock = (text: string) => ['```diff', ...text.split('\n'), '```']

// One message to the space's agent with every comment, grouped by checkout and file, asking it to apply them all.
export function reviewMessage(comments: ReviewComment[], targets: ReviewTarget[]): string {
  const total = comments.length
  const lines = [
    `Please apply ${total === 1 ? 'this review comment' : `all ${total} of these review comments`} on the changes, then say briefly what you changed. Each one quotes the diff lines it's about.`,
  ]
  const byPath = new Map<string, ReviewComment[]>()
  for (const c of comments) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c])
  let n = 0
  for (const [path, list] of byPath) {
    const target = targets.find((t) => t.path === path)
    const branch = target?.branch ? ` on branch ${target.branch}` : ''
    const where = target?.worker
      ? `Worker "${target.worker}"'s ${target.repo} worktree${branch}, at ${path}. Make these changes there, on that branch, not in the space's own checkout.`
      : `${target?.repo ?? path}${branch}, at ${path}.`
    lines.push('', `## ${where}`)
    const ordered = [...list].sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start)
    for (const c of ordered) {
      n++
      const group = c.group === 'uncommitted' ? 'uncommitted change' : 'committed change'
      lines.push('', `${n}. ${lineLabel(c)} (${group}):`, ...quoteBlock(c.quote), c.text)
    }
  }
  return lines.join('\n')
}
