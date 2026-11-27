// Review of a worker's changes, under its report: what it changed on its own branch, and Merge, Squash, Keep or
// Discard. The core keeps the branches on the space (ChatInfo.workerBranches) and says what each action did in a
// note in the chat; once merged or discarded, the bar goes.
import { useEffect, useState } from 'react'
import type { ClientMessage, WorkerBranch } from '@kothar/core/shared'
import { Button, Hint } from '../controls.tsx'

type Action = 'merge' | 'squash' | 'discard' | 'keep'
// How long a button stays busy without an answer: an error comes as a message of its own, not a change to the bar.
const BUSY_MS = 8000

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function totalsOf(branch: WorkerBranch) {
  const sum = { files: 0, added: 0, removed: 0, commits: 0, uncommitted: 0 }
  for (const c of branch.changes ?? []) {
    sum.files += c.files
    sum.added += c.added
    sum.removed += c.removed
    sum.commits += c.commits
    sum.uncommitted += c.uncommitted
  }
  return sum
}

const HINTS: Record<Action, string> = {
  merge: 'Merge its branch into the space’s branch, committing what it left uncommitted first. A conflict is undone and reported.',
  squash: 'Add its changes to the space’s branch as one commit. A conflict is undone and reported.',
  keep: 'Leave its branch and worktree as they are, for later',
  discard: 'Remove its worktree and branch, and the changes on them',
}

type Props = { spaceId: string; workerId: string; branch: WorkerBranch; connected: boolean; send: (m: ClientMessage) => void }

export function WorkerReview({ spaceId, workerId, branch, connected, send }: Props) {
  const [busy, setBusy] = useState<Action>()
  const [confirming, setConfirming] = useState(false)
  // A fresh entry from the core (a conflict saved, Keep) ends the wait.
  const [seen, setSeen] = useState(branch)
  if (seen !== branch) {
    setSeen(branch)
    setBusy(undefined)
  }
  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setBusy(undefined), BUSY_MS)
    return () => clearTimeout(timer)
  }, [busy])
  if (branch.state === 'working') return null
  const t = totalsOf(branch)
  const act = (action: Action) => {
    setConfirming(false)
    setBusy(action)
    send({ type: 'worker.review', chatId: spaceId, workerId, action })
  }
  const where = branch.repos.map((r) => `${r.folder}: ${r.branch} → ${r.into}`).join('\n')
  const disabled = !connected || busy !== undefined
  const button = (action: Action, label: string, variant: 'default' | 'ghost' | 'danger' = 'ghost') => (
    <Hint text={HINTS[action]}>
      <Button size="small" variant={variant} disabled={disabled} onClick={() => (action === 'discard' ? setConfirming(true) : act(action))}>
        {busy === action ? `${label}…` : label}
      </Button>
    </Hint>
  )
  return (
    <div role="group" aria-label={`Changes of worker ${branch.name}`} className="flex flex-wrap items-center gap-x-8 gap-y-4 text-sm" data-worker-review>
      <Hint text={where} align="start">
        <span className="text-muted">
          {plural(t.files, 'file')} changed{' '}
          <span className="font-mono text-xs">
            <span className="text-green">+{t.added}</span> <span className="text-red">−{t.removed}</span>
          </span>
          {' · '}
          {plural(t.commits, 'commit')}
          {t.uncommitted > 0 && ` · ${t.uncommitted} uncommitted`}
          {branch.state === 'kept' && ' · kept'}
        </span>
      </Hint>
      {confirming ? (
        <span className="flex items-center gap-6">
          <span className="text-red">
            Discard {plural(t.files, 'file')}
            {t.uncommitted > 0 && `, ${t.uncommitted} uncommitted`}?
          </span>
          <Button size="small" variant="danger" disabled={disabled} onClick={() => act('discard')}>
            Discard
          </Button>
          <Button size="small" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-4">
          {button('merge', 'Merge', 'default')}
          {button('squash', 'Squash')}
          {branch.state !== 'kept' && button('keep', 'Keep')}
          {button('discard', 'Discard…')}
        </span>
      )}
    </div>
  )
}
