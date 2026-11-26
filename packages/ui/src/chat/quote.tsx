// Quote: selecting text in the transcript shows a small Quote button above it; clicking puts the text in the message
// box as a Markdown blockquote, to reply to that part.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { m } from 'motion/react'
import { MOTION } from '../controls.tsx'

// Gap between the selection and the button, and the least the button keeps from the window's edges.
const GAP_PX = 6
const EDGE_PX = 8
// Until the button is measured: roughly its size.
const GUESS = { width: 76, height: 28 }

/**
 * The selected text as a blockquote block: `> ` before every line (a bare `>` on an empty one), then a blank line.
 * Trailing whitespace and blank lines at either end go. No cap on length: the user picked exactly this much, and the
 * message box scrolls, so cutting it would only quote something they didn't mean.
 */
export function quoteBlock(selected: string) {
  const lines = selected
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
  while (lines.length && !lines[0]!.trim()) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  if (!lines.length) return ''
  return `${lines.map((line) => (line ? `> ${line}` : '>')).join('\n')}\n\n`
}

/**
 * The message box's text with the quote put in at the caret (or over what's selected in it), each quote its own
 * block: a blank line between it and text before it. Returns the new text and where the caret goes, after the quote.
 */
export function withQuote(value: string, start: number, end: number, quote: string) {
  const block = quoteBlock(quote)
  if (!block) return { value, caret: end }
  const before = value.slice(0, start)
  const after = value.slice(end)
  const gap = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const head = before + gap + block
  return { value: head + after.replace(/^\n+/, ''), caret: head.length }
}

type Place = { x: number; y: number; below: boolean }

/** The text selected inside `within` (outside an edit box or a text field), with where it sits; undefined otherwise. */
function selectedIn(within: HTMLElement | null) {
  const selection = typeof window === 'undefined' ? null : window.getSelection()
  if (!within || !selection || selection.isCollapsed || !selection.rangeCount) return undefined
  const { anchorNode, focusNode } = selection
  if (!anchorNode || !focusNode || !within.contains(anchorNode) || !within.contains(focusNode)) return undefined
  const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement)
  const editing = (node: Node) => !!elementOf(node)?.closest('[data-edit-box],textarea,input,[contenteditable="true"]')
  if (editing(anchorNode) || editing(focusNode)) return undefined
  const text = selection.toString()
  if (!text.trim()) return undefined
  const range = selection.getRangeAt(0)
  const rects = typeof range.getClientRects === 'function' ? [...range.getClientRects()].filter((r) => r.width || r.height) : []
  const box = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : undefined
  return { text, first: rects[0] ?? box, last: rects.at(-1) ?? box, box }
}

/** Above the selection's first line, centred on it; below its last line when there's no room above. Kept in the window. */
export function placeQuote(
  first: { top: number; left: number; width: number },
  last: { bottom: number; left: number; width: number },
  size: { width: number; height: number },
  view: { top: number; width: number; height: number },
): Place {
  const below = first.top - GAP_PX - size.height < view.top + EDGE_PX
  const line = below ? last : first
  const half = size.width / 2
  const x = Math.min(Math.max(line.left + line.width / 2, EDGE_PX + half), view.width - EDGE_PX - half)
  const y = below ? Math.min(last.bottom + GAP_PX, view.height - EDGE_PX - size.height) : first.top - GAP_PX - size.height
  return { x, y, below }
}

export function QuoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3 9.2C3 6.6 4.4 4.6 6.6 3.8l.5 1c-1.3.6-2 1.6-2.2 2.9H6.7V12H3zm6.3 0c0-2.6 1.4-4.6 3.6-5.4l.5 1c-1.3.6-2 1.6-2.2 2.9H13V12H9.3z" />
    </svg>
  )
}

type Props = {
  /** The transcript's scrolling list: only text selected inside it is quoted, and the button hides when the
   * selection scrolls out of it. */
  within: RefObject<HTMLElement | null>
  /** False while the message box can't take text (disconnected, archived): no button. */
  enabled: boolean
  /** Puts the quote in the message box. */
  quote: (text: string) => void
}

/** The floating Quote button. Lives in a portal, fixed to the window, so the transcript's transforms can't move it. */
export function QuoteSelection({ within, enabled, quote }: Props) {
  const [found, setFound] = useState<ReturnType<typeof selectedIn>>()
  const [size, setSize] = useState(GUESS)
  const pressing = useRef(false)
  // Escape hides the button for the selection it was shown for; selecting anything else brings it back.
  const dismissed = useRef<string | undefined>(undefined)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!enabled) return
    const look = () => {
      if (pressing.current) return setFound(undefined)
      const now = selectedIn(within.current)
      if (!now) dismissed.current = undefined
      setFound(now && dismissed.current !== now.text ? now : undefined)
    }
    // While the mouse drags a selection out, the button waits for the mouse to come up.
    const down = (e: MouseEvent) => {
      if (button.current?.contains(e.target as Node)) return
      pressing.current = true
      dismissed.current = undefined
      setFound(undefined)
    }
    const up = () => {
      pressing.current = false
      // After the browser settles the selection a click makes (a click inside it collapses it only after mouseup).
      setTimeout(look)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const now = selectedIn(within.current)
      if (!now) return
      dismissed.current = now.text
      setFound(undefined)
    }
    document.addEventListener('selectionchange', look)
    document.addEventListener('mousedown', down, true)
    document.addEventListener('mouseup', up, true)
    document.addEventListener('keydown', key)
    // Scrolling the transcript or resizing the window moves the selection: the button follows it.
    document.addEventListener('scroll', look, true)
    window.addEventListener('resize', look)
    return () => {
      document.removeEventListener('selectionchange', look)
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('mouseup', up, true)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', look, true)
      window.removeEventListener('resize', look)
    }
  }, [within, enabled])

  useLayoutEffect(() => {
    const node = button.current
    if (!found || !node || !node.offsetWidth) return
    if (node.offsetWidth !== size.width || node.offsetHeight !== size.height) {
      setSize({ width: node.offsetWidth, height: node.offsetHeight })
    }
  }, [found, size])

  const list = within.current?.getBoundingClientRect()
  const view = { top: list?.top ?? 0, bottom: list?.bottom ?? window.innerHeight }
  // The selection scrolled out of the transcript: no button until it's back.
  const outOfView = !!(found?.box && list && list.height && (found.box.bottom < view.top || found.box.top > view.bottom))
  const shown = enabled && found && !outOfView
  const place =
    shown && found.first && found.last
      ? placeQuote(found.first, found.last, size, { top: view.top, width: window.innerWidth, height: window.innerHeight })
      : { x: EDGE_PX + size.width / 2, y: EDGE_PX, below: false }

  // It fades in but goes at once: it never lingers over text the user has moved on to.
  return createPortal(
    shown && (
      <m.button
        ref={button}
        type="button"
        className="fixed z-40 flex h-28 -translate-x-1/2 items-center gap-6 rounded border bg-panel px-8 text-sm text-text shadow-floating hover:bg-raised"
        style={{ left: place.x, top: place.y }}
        data-quote-selection
        data-below={place.below || undefined}
        // Keeps the selection (and the focus) where they are, so the click still has the text.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const text = selectedIn(within.current)?.text ?? found.text
          setFound(undefined)
          window.getSelection()?.removeAllRanges()
          quote(text)
        }}
        initial={MOTION.pop.initial}
        animate={MOTION.pop.animate}
      >
        <QuoteIcon />
        Quote
      </m.button>
    ),
    document.body,
  )
}
