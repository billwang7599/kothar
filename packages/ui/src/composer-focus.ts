// Putting the cursor in the message box after the user switches chats (a sidebar row, ⌘↑/⌘↓, Ctrl+Tab, ⌘O, a panel's
// link): every switch goes through main.tsx's select(), which asks for it here, and the new chat's composer takes it
// once it's on screen. It isn't taken when that would pull the user away from something: a dialog or popup still open,
// a field elsewhere they're typing in, a touch screen (where focus brings up the keyboard), or a box that's disabled.
// A view-only chat (a subagent's) has no composer, so the request just lapses.

/** How long a request waits for its composer, and for a closing dialog to finish closing. */
const WAIT_MS = 1500

let wanted: { chatId: string; at: number } | undefined
const listeners = new Set<() => void>()

/** Ask for the composer of this chat to take focus once it shows. A newer request replaces an older one. */
export function wantComposerFocus(chatId: string): void {
  wanted = { chatId, at: Date.now() }
  listeners.forEach((listener) => listener())
}

/** Whether a request for this chat is waiting, and not stale. */
function pendingFor(chatId: string): boolean {
  if (!wanted || wanted.chatId !== chatId) return false
  if (Date.now() - wanted.at > WAIT_MS) {
    wanted = undefined
    return false
  }
  return true
}

const isTouch = () =>
  typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches

/** A field the user may be typing in: focus there stays put. */
function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(el.type)
  return false
}

const DIALOG = '[role="dialog"], [role="alertdialog"]'

/** What's in the way: 'open' if a dialog is open (don't take focus), 'closing' if one is animating out (wait). */
function blocker(): 'open' | 'closing' | undefined {
  const dialogs = [...document.querySelectorAll<HTMLElement>(DIALOG)]
  if (dialogs.some((d) => d.dataset.state !== 'closed')) return 'open'
  return dialogs.length ? 'closing' : undefined
}

/**
 * Focus the box if a request for this chat is waiting and nothing is in the way. The caret is left where it was if
 * the box was used before (`keepCaret`), and otherwise goes to the end of the draft. Returns a cleanup.
 */
export function takeComposerFocus(chatId: string, box: () => HTMLTextAreaElement | null, keepCaret: () => boolean): () => void {
  let frame = 0
  const attempt = () => {
    frame = 0
    if (!pendingFor(chatId)) return
    const node = box()
    if (!node || node.disabled) return
    const block = blocker()
    if (block === 'open') {
      wanted = undefined
      return
    }
    // A dialog closing hands focus back to where it was when it closes, so wait until it's gone.
    if (block === 'closing') {
      frame = requestAnimationFrame(attempt)
      return
    }
    wanted = undefined
    if (isTouch()) return
    const active = document.activeElement
    if (active !== node && isEditable(active) && !node.closest('[data-composer]')?.contains(active)) return
    // Asked before focusing, since focusing marks the box used.
    const keep = keepCaret()
    node.focus({ preventScroll: true })
    if (!keep) node.setSelectionRange(node.value.length, node.value.length)
  }
  const schedule = () => {
    if (!frame && pendingFor(chatId)) frame = requestAnimationFrame(attempt)
  }
  schedule()
  listeners.add(schedule)
  return () => {
    listeners.delete(schedule)
    if (frame) cancelAnimationFrame(frame)
  }
}
