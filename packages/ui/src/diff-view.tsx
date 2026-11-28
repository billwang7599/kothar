import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ExtensionAction, ExtensionDiffComment, ExtensionView } from '@kothar/extension-api'
import { Button } from './controls.tsx'

/**
 * An extension's diff view (ExtensionView 'diff'): a unified diff, its lines numbered from the hunk headers and wrapped
 * so it never scrolls sideways, with comments the user writes on a line or a range of lines. The extension keeps the
 * comments; this keeps only the one being written.
 */
type DiffNode = Extract<ExtensionView, { type: 'diff' }>
type Act = (action: ExtensionAction) => void

export type DiffLine = { text: string; kind: 'meta' | 'hunk' | 'add' | 'del' | 'context'; old?: number; new?: number }

const MAX_DIFF_LINES = 800
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** The diff's lines, as text.split('\n') counts them (a last newline dropped), with each one's line numbers. */
export function diffLines(text: string): DiffLine[] {
  let old = 0
  let now = 0
  let inHunk = false
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line): DiffLine => {
      const hunk = line.match(HUNK)
      if (hunk) {
        old = Number(hunk[1])
        now = Number(hunk[2])
        inHunk = true
        return { text: line, kind: 'hunk' }
      }
      if (!inHunk || line.startsWith('\\')) return { text: line, kind: 'meta' }
      if (line.startsWith('diff --git')) {
        inHunk = false
        return { text: line, kind: 'meta' }
      }
      if (line.startsWith('+')) return { text: line, kind: 'add', new: now++ }
      if (line.startsWith('-')) return { text: line, kind: 'del', old: old++ }
      return { text: line, kind: 'context', old: old++, new: now++ }
    })
}

const TONE: Record<DiffLine['kind'], string> = {
  meta: 'text-faint',
  hunk: 'text-accent',
  add: 'bg-green/10 text-green',
  del: 'bg-red/10 text-red',
  context: 'text-muted',
}

const commentable = (line: DiffLine) => line.kind === 'add' || line.kind === 'del' || line.kind === 'context'

// A comment half written survives the panel drawing again and the popup closing, until its diff's key changes.
type Draft = { start: number; end: number; text: string }
const drafts = new Map<string, Draft>()

function CommentBox({
  initial,
  label,
  onSave,
  onCancel,
  onChange,
}: {
  initial: string
  label: string
  onSave: (text: string) => void
  onCancel: () => void
  onChange?: (text: string) => void
}) {
  const [text, setText] = useState(initial)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => box.current?.focus(), [])
  const save = () => text.trim() && onSave(text.trim())
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 border-y bg-panel px-8 py-6 font-sans" data-comment-box>
      <textarea
        ref={box}
        aria-label={label}
        className="min-h-56 w-full min-w-0 resize-y px-8 py-6 text-sm leading-[1.5] focus:border-accent"
        placeholder="What should change here?"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange?.(e.target.value)
        }}
        onKeyDown={keys}
      />
      <div className="flex flex-wrap items-center gap-6">
        <Button size="small" variant="primary" disabled={!text.trim()} onClick={save}>
          Save
        </Button>
        <Button size="small" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Comment({ comment, node, act }: { comment: ExtensionDiffComment; node: DiffNode; act: Act }) {
  const [editing, setEditing] = useState(false)
  if (editing && node.comment) {
    return (
      <CommentBox
        initial={comment.text}
        label="Edit comment"
        onSave={(text) => {
          act({ name: node.comment!, value: { id: comment.id, text } })
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 border-y border-accent/30 bg-accent/5 px-8 py-6 font-sans text-sm text-text" data-comment={comment.id}>
      {comment.label && <span className="min-w-0 truncate text-xs text-faint" title={comment.label}>{comment.label}</span>}
      <p className="min-w-0 whitespace-pre-wrap wrap-anywhere">{comment.text}</p>
      {(node.comment || node.remove) && (
        <div className="flex items-center gap-4">
          {node.comment && (
            <Button size="small" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {node.remove && (
            <Button size="small" variant="ghost" onClick={() => act({ name: node.remove!, value: comment.id })}>
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function DiffView({ node, act }: { node: DiffNode; act: Act }) {
  const lines = diffLines(node.text)
  const max = node.maxLines ?? MAX_DIFF_LINES
  const shown = lines.slice(0, max)
  const cut = lines.length - shown.length
  const [draft, setDraftState] = useState<Draft | undefined>(() => drafts.get(node.key))
  const [anchor, setAnchor] = useState<number>()
  const [keyed, setKeyed] = useState(node.key)
  if (keyed !== node.key) {
    setKeyed(node.key)
    setDraftState(drafts.get(node.key))
    setAnchor(undefined)
  }
  const setDraft = (next: Draft | undefined) => {
    if (next) drafts.set(node.key, next)
    else drafts.delete(node.key)
    setDraftState(next)
  }
  const pick = (i: number, e: MouseEvent) => {
    if (!node.comment || !commentable(shown[i]!)) return
    // Selecting text to copy isn't a click on the line.
    if (window.getSelection()?.toString()) return
    const from = e.shiftKey && anchor !== undefined ? anchor : i
    const [start, end] = from <= i ? [from, i] : [i, from]
    setAnchor(e.shiftKey && anchor !== undefined ? anchor : i)
    setDraft({ start, end, text: drafts.get(node.key)?.text ?? '' })
  }
  const byEnd = new Map<number, ExtensionDiffComment[]>()
  const loose: ExtensionDiffComment[] = []
  for (const c of node.comments ?? []) {
    if (c.start === undefined || c.end === undefined || c.end >= shown.length) loose.push(c)
    else byEnd.set(c.end, [...(byEnd.get(c.end) ?? []), c])
  }
  const marked = (i: number) =>
    (draft && i >= draft.start && i <= draft.end) || (node.comments ?? []).some((c) => c.start !== undefined && i >= c.start && i <= c.end!)
  const gutter = Math.max(String(shown.reduce((n, l) => Math.max(n, l.new ?? l.old ?? 0), 0)).length, 2)
  const hint = node.comment ? 'Click a line to comment on it; Shift-click another to take the lines between' : undefined
  return (
    <div
      className={`scroll-inset scroll-inset-tight flex min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded border bg-bg font-mono text-xs leading-[1.5] ${node.fill ? 'min-h-0 flex-1' : 'max-h-480'}`}
      data-diff={node.key}
    >
      {loose.length > 0 && (
        <div className="flex flex-col gap-2 py-4">
          <span className="px-8 font-sans text-xs text-faint">On lines no longer in this diff</span>
          {loose.map((c) => (
            <Comment key={c.id} comment={c} node={node} act={act} />
          ))}
        </div>
      )}
      <div className="py-4" role="list" aria-label="Diff">
        {shown.map((line, i) => {
          const can = !!node.comment && commentable(line)
          const number = line.new ?? line.old
          return (
            <div key={i} role="listitem" className="min-w-0">
              <div
                className={`flex min-w-0 ${TONE[line.kind]} ${marked(i) ? 'outline outline-1 -outline-offset-1 outline-accent/50' : ''} ${can ? 'cursor-pointer hover:brightness-125' : ''}`}
                title={can ? hint : undefined}
                data-line={i}
                onClick={can ? (e) => pick(i, e) : undefined}
              >
                <span aria-hidden="true" className="shrink-0 px-4 text-right text-faint select-none" style={{ width: `${gutter + 1}ch` }}>
                  {number ?? ''}
                </span>
                <span className="min-w-0 flex-1 pr-8 whitespace-pre-wrap break-all">{line.text || ' '}</span>
              </div>
              {byEnd.get(i)?.map((c) => <Comment key={c.id} comment={c} node={node} act={act} />)}
              {draft && draft.end === i && node.comment && (
                <CommentBox
                  key={`${draft.start}:${draft.end}`}
                  initial={draft.text}
                  label={draft.start === draft.end ? 'Comment on this line' : 'Comment on these lines'}
                  onChange={(text) => drafts.set(node.key, { ...draft, text })}
                  onSave={(text) => {
                    act({ name: node.comment!, value: { start: draft.start, end: draft.end, text } })
                    setDraft(undefined)
                    setAnchor(undefined)
                  }}
                  onCancel={() => {
                    setDraft(undefined)
                    setAnchor(undefined)
                  }}
                />
              )}
            </div>
          )
        })}
        {cut > 0 && <div className="px-8 text-faint">{cut} more lines</div>}
      </div>
    </div>
  )
}
