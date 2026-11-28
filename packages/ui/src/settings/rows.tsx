// What every Settings page is built from: a row (label left, control right), a titled section, the collapsed Advanced
// part each page keeps its rarely needed settings in, and plain text with its links made clickable.
import { useState, type ReactNode } from 'react'
import { Chevron, GROUP, Hint } from '../controls.tsx'

type RowProps = {
  /** The anchor search and kothar:settings links jump to. */
  id?: string
  name: ReactNode
  /** The explanation, shown on hover over the name. */
  hint?: ReactNode
  /** One muted line under the name: a value or status, not an explanation. */
  description?: ReactNode
  children?: ReactNode
  below?: ReactNode
}

export function SettingRow({ id, name, hint, description, children, below }: RowProps) {
  return (
    <div id={id} className="flex scroll-mt-12 flex-wrap items-center gap-x-16 gap-y-6 rounded-sm py-10 transition-[background-color,box-shadow] not-first:border-t">
      <div className="flex min-w-[min(180px,100%)] flex-1 flex-col gap-2 wrap-anywhere">
        {hint ? (
          <Hint text={hint}>
            <span className="self-start">{name}</span>
          </Hint>
        ) : (
          name
        )}
        {description && <div className="text-sm text-muted">{description}</div>}
      </div>
      {children && <div className="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-6">{children}</div>}
      {below && <div className="min-w-0 basis-full">{below}</div>}
    </div>
  )
}

type SectionProps = {
  id?: string
  title: ReactNode
  hint?: ReactNode
  /** Controls at the right of the title, such as Reset to defaults. */
  action?: ReactNode
  /** Children drawn as they are, not in a card (lists and editors with their own layout). */
  plain?: boolean
  children: ReactNode
}

/** A titled part of a page; its rows sit in one card. */
export function Section({ id, title, hint, action, plain, children }: SectionProps) {
  return (
    <section id={id} aria-label={!plain && typeof title === 'string' ? title : undefined} className="flex scroll-mt-12 flex-col rounded pt-24 transition-colors first:pt-0">
      <div className="flex min-h-26 flex-wrap items-center gap-8 pb-8">
        {/* A mono kicker, like the website's section labels. */}
        <h3 className="min-w-0 flex-1 label-k text-muted">
          {hint ? (
            <Hint text={hint}>
              <span>{title}</span>
            </Hint>
          ) : (
            title
          )}
        </h3>
        {action}
      </div>
      {plain ? children : <div className={GROUP}>{children}</div>}
    </section>
  )
}

const advancedKey = (page: string) => `kothar.settings.advanced.${page}`

/**
 * The page's rarely needed settings, folded away. Closed by default; it remembers being opened or closed per page.
 * Search and kothar:settings links open it (revealSetting) without changing what it remembers.
 */
export function Advanced({ page, note, children }: { page: string; note?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => localStorage.getItem(advancedKey(page)) === 'true')
  return (
    <details
      className="group mt-24 border-t pt-12"
      data-advanced={page}
      open={open}
      onToggle={(e) => {
        const details = e.currentTarget
        if (details.open === open) return
        setOpen(details.open)
        if ('revealed' in details.dataset) delete details.dataset.revealed
        else localStorage.setItem(advancedKey(page), String(details.open))
      }}
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-6 text-sm text-muted hover:text-text">
        <Chevron />
        Advanced
        {note && <span className="text-faint">{note}</span>}
      </summary>
      <div className="flex flex-col pt-16">{children}</div>
    </details>
  )
}

// An extension's text is plain; its web addresses become links.
export const linked = (text: string) =>
  text.split(/(https:\/\/[^\s)]*[^\s).,;:])/).map((part, i) =>
    i % 2 ? (
      <a key={i} className="text-accent underline" href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  )
