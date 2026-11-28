// The update notice at the top of the chat pane (updates.ts): Kothar X.Y.Z is available, with Update and Not now; then
// the download's progress; then Restart, or Restart later, which installs on the next quit. The desktop shell decides
// when it shows, at most once per version.
import { Button } from './controls.tsx'
import { releaseNotesUrl, updateNotice, updatesBridge, type UpdateInfo } from './updates.ts'

export function UpdateNotice({ info, running }: { info: UpdateInfo | undefined; running: number }) {
  const notice = updateNotice(info, running)
  const updates = updatesBridge()
  if (!notice || !updates) return null
  return (
    <div
      role="status"
      aria-label="Update"
      className="flex min-h-32 flex-wrap items-center gap-x-8 gap-y-4 border-b bg-panel py-4 pr-12 pl-16 text-sm text-accent before:size-7 before:shrink-0 before:rounded-full before:bg-current"
    >
      <span className="min-w-0 flex-1 text-text">
        {notice.text}{' '}
        {notice.actions === 'offer' && (
          <a className="text-accent hover:underline" href={releaseNotesUrl(notice.version)} target="_blank" rel="noreferrer">
            What’s new
          </a>
        )}
        {notice.warning && <span className="text-amber"> {notice.warning}</span>}
      </span>
      {notice.actions === 'offer' && (
        <span className="flex gap-4">
          <Button variant="primary" size="small" onClick={() => updates.download()}>
            Update
          </Button>
          <Button variant="ghost" size="small" onClick={() => updates.decline()}>
            Not now
          </Button>
        </span>
      )}
      {notice.actions === 'restart' && (
        <span className="flex gap-4">
          <Button variant="primary" size="small" onClick={() => updates.restart()}>
            Restart
          </Button>
          <Button variant="ghost" size="small" onClick={() => updates.later()}>
            Restart later
          </Button>
        </span>
      )}
    </div>
  )
}
