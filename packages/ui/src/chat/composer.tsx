// The message box: typing (with its draft kept), attachments, model and thinking pickers, and Send, Queue or Stop.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { THINKING_LABELS, type ClientMessage, type ComposerToggleInfo, type ThinkingLevel } from '@kothar/core/shared'
import { Button, Hint, Select } from '../controls.tsx'
import { draftOf, flushDrafts, saveDraft, saveDraftSoon } from '../drafts.ts'
import { applyEdit, continueList, indentList } from '../lists.tsx'
import { modelKey, type ChatView, type modelMenu } from '../state.ts'
import { FILE_CHIP, PaperclipIcon, type Pending } from './attachments.tsx'
import { attachmentNotes, isLarge } from './use-attachments.ts'
import { formatBytes } from '../format.ts'
import { ModePicker } from './mode-picker.tsx'
import { withQuote } from './quote.tsx'
import { takeComposerFocus } from '../composer-focus.ts'

const SEND_HINT = 'Enter to send · Shift+Enter for a new line'
const QUEUE_HINT = 'Enter to queue · ⌘Enter to interrupt and send'
const STEER_HINT = 'Enter steers it in at the next step · ⌥Enter queues · ⌘Enter interrupts and sends'
export const FORCE_STOP_HINT = 'Click Stopping… again to force stop'
const MODEL_HINT = 'Model'
const THINKING_HINT = 'Thinking level'

type ComposerProps = {
  chat: ChatView
  connected: boolean
  pending: Pending[]
  unattach: (removed: Pending[]) => void
  attach: (files: File[]) => Promise<void>
  canSend: boolean
  canQueue: boolean
  canChange: boolean
  steers: boolean
  placeholder: string
  menu: ReturnType<typeof modelMenu>
  setModel: (key?: string, thinking?: ThinkingLevel) => void
  stop: () => void
  /** Sends the text with the pending attachments; false when it can't be sent now, so the text stays. */
  submit: (text: string, steer?: boolean) => boolean
  /** Offers to stop the turn, so what's queued sends now. */
  interrupt: () => void
  /** Extensions' modes for this chat, in the mode picker beside the thinking level. */
  toggles?: readonly ComposerToggleInfo[]
  send?: (m: ClientMessage) => void
  /** Set to a function that puts text selected in the transcript into the box as a quote (chat/quote.tsx). */
  quoteRef?: RefObject<((text: string) => void) | null>
}

/**
 * The message box. It keeps what's typed in its own state, so a keystroke re-renders only the box, never the
 * transcript above it, and the draft is written to localStorage once typing pauses.
 */
export function Composer(props: ComposerProps) {
  const { chat, connected, pending, unattach, attach, canSend, canQueue, canChange, steers, placeholder, menu } = props
  const { setModel, stop } = props
  const [text, setTyped] = useState(() => draftOf(chat.id))
  const setText = (typed: string) => {
    setTyped(typed)
    saveDraftSoon(chat.id, typed)
  }
  useEffect(() => flushDrafts, [])
  const box = useRef<HTMLTextAreaElement>(null)
  // Where the caret goes once a quote put in has rendered.
  const caret = useRef<number | undefined>(undefined)
  const touched = useRef(false)
  useLayoutEffect(() => {
    const node = box.current
    if (caret.current === undefined || !node) return
    node.focus()
    node.setSelectionRange(caret.current, caret.current)
    caret.current = undefined
  }, [text])
  // After a chat switch, the cursor goes in here (composer-focus.ts).
  useEffect(() => takeComposerFocus(chat.id, () => box.current, () => touched.current), [chat.id])
  useLayoutEffect(() => {
    const ref = props.quoteRef
    if (!ref) return
    ref.current = (quote: string) => {
      const node = box.current
      if (!node) return
      const value = node.value
      // The caret stays put when the box loses focus, so a quote goes where it was left; a box never focused has its
      // caret at the start, so the quote goes after what's typed.
      const used = touched.current
      const start = used ? node.selectionStart : value.length
      const end = used ? node.selectionEnd : value.length
      const next = withQuote(value, start, end, quote)
      caret.current = next.caret
      setText(next.value)
    }
    return () => {
      ref.current = null
    }
  })
  const fileInput = useRef<HTMLInputElement>(null)
  const archived = chat.archived
  const busy = chat.status !== 'idle'
  const working = busy && !archived && !text
  const canAttach = canSend || canQueue
  const hasContent = text.trim() !== '' || pending.length > 0
  const submit = (steer = false) => {
    if (!props.submit(text, steer)) return
    setTyped('')
    saveDraft(chat.id, '')
  }
  const interruptAndSend = () => {
    if (!canQueue) return
    submit()
    props.interrupt()
  }
  return (
    <div
      data-composer
      className={`@container mx-auto max-w-column rounded-lg border transition-[border-color,box-shadow] has-[textarea:focus]:border-accent ${canSend || canQueue ? 'bg-panel shadow-raised has-[textarea:focus]:shadow-floating' : 'bg-bg'}`}
    >
      {pending.length > 0 && <PendingFiles pending={pending} unattach={unattach} />}
      <div className="relative">
        {working && (
          <span
            className="shimmer pointer-events-none absolute inset-x-12 top-8 truncate text-body leading-[1.5]"
            data-status={chat.status}
            aria-hidden="true"
          >
            {placeholder}
          </span>
        )}
        <textarea
          ref={box}
          onFocus={() => {
            touched.current = true
          }}
          className="block max-h-[calc(12lh+16px)] min-h-[calc(1lh+16px)] w-full resize-none border-none bg-transparent px-12 shadow-none py-8 text-body leading-[1.5] field-sizing-content"
          value={text}
          rows={1}
          placeholder={working ? undefined : archived ? 'Archived' : placeholder}
          aria-placeholder={working ? placeholder : undefined}
          disabled={!(canSend || canQueue)}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const { types, files } = e.clipboardData
            if (types.includes('text/plain') || !files.length) return
            e.preventDefault()
            void attach([...files])
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            // Lists: a new line (Shift+Enter) continues one, Tab and Shift+Tab nest a list line.
            const listKey = e.key === 'Tab' ? !e.altKey && !e.metaKey && !e.ctrlKey : e.key === 'Enter' && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey
            if (listKey) {
              const box = e.currentTarget
              const { value, selectionStart, selectionEnd } = box
              const edit = e.key === 'Tab' ? indentList(value, selectionStart, selectionEnd, e.shiftKey) : continueList(value, selectionStart, selectionEnd)
              if (!edit) return
              e.preventDefault()
              applyEdit(box, edit)
              return
            }
            if (e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            const emptyWithQueue = !hasContent && chat.queue.length > 0
            if (busy && (e.metaKey || e.ctrlKey || emptyWithQueue)) interruptAndSend()
            else submit(!e.altKey)
          }}
        />
      </div>
      {/*
        The toolbar narrows in steps, by the composer's width (its @container), never by drawing one thing over another:
        1. The mode picker shows only its icon (mode-picker.tsx).
        2. The model name is cut short with an ellipsis; the thinking level, Send and Attach keep their size.
        3. When the right-hand group would get narrower than its floor, it wraps onto a line of its own.
        The left group is never squeezed beside the right one, so its chips can't spill under it; alone on a line, its
        chips wrap.
      */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-6 pb-6" data-composer-toolbar>
        <span className="flex min-w-0 flex-wrap items-center gap-6">
          <Hint text="Attach files">
            <Button
              variant="ghost"
              size="icon"
              className="grid shrink-0 place-items-center"
              aria-label="Attach files"
              disabled={!canAttach}
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon />
            </Button>
          </Hint>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void attach([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </span>
        <span
          className={`ml-auto flex min-w-0 grow items-center justify-end gap-6 ${busy && hasContent ? 'basis-280' : 'basis-200'}`}
        >
          {menu.value && (
            <Select
              variant="chip"
              className="shrink"
              label="Model"
              hint={MODEL_HINT}
              value={menu.value}
              disabled={!canChange}
              options={menu.choices.map((c) => ({ value: modelKey(c), label: c.label, group: c.group }))}
              onChange={(key) => setModel(key, menu.thinking)}
            />
          )}
          {menu.levels.length > 0 && (
            <Select
              variant="chip"
              className="shrink-0"
              label="Thinking"
              hint={THINKING_HINT}
              value={menu.thinking ?? ''}
              placeholder="Thinking"
              disabled={!canChange}
              options={menu.levels.map((l) => ({ value: l, label: THINKING_LABELS[l] }))}
              onChange={(thinking) => setModel(menu.value, thinking as ThinkingLevel)}
            />
          )}
          {props.toggles && props.send && (
            <ModePicker modes={props.toggles} chatId={chat.id} disabled={!connected || archived} send={props.send} />
          )}
          {busy ? (
            <>
              {hasContent && (
                <Hint text={steers ? STEER_HINT : QUEUE_HINT}>
                  <Button size="small" className="shrink-0" disabled={!canQueue} onClick={() => submit()}>
                    Queue
                  </Button>
                </Hint>
              )}
              <Hint text={chat.status === 'stopping' && FORCE_STOP_HINT}>
                <Button
                  variant="danger"
                  className={`shrink-0 ${chat.status === 'stopping' ? 'enabled:animate-[blink_1.4s_ease-in-out_infinite]' : ''}`}
                  disabled={!connected}
                  onClick={stop}
                >
                  {chat.status === 'stopping' ? 'Stopping…' : 'Stop'}
                </Button>
              </Hint>
            </>
          ) : (
            <Hint text={SEND_HINT}>
              <span className="flex shrink-0">
                <Button
                  variant="primary"
                  className="disabled:pointer-events-none"
                  disabled={!canSend || !hasContent}
                  onClick={() => submit()}
                >
                  Send
                </Button>
              </span>
            </Hint>
          )}
        </span>
      </div>
    </div>
  )
}

/** A waiting file's size, or how far its upload has got; amber once it's large. */
function sizeText(p: Pending) {
  return p.progress === undefined ? formatBytes(p.size) : `Uploading ${Math.floor(p.progress * 100)}% of ${formatBytes(p.size)}`
}

/** The files waiting to be sent: each with its size, their total when there are several, and warnings for large ones. */
function PendingFiles({ pending, unattach }: { pending: Pending[]; unattach: (removed: Pending[]) => void }) {
  const { total, warnings } = attachmentNotes(pending)
  return (
    <div className="flex flex-col gap-6 px-8 pt-8">
      <ul className="flex flex-wrap gap-6" aria-label="Attachments">
        {pending.map((p) => (
          <li key={p.id} className="relative min-w-0">
            {p.preview ? (
              <div className="relative size-48" title={p.name}>
                <img src={p.preview} alt={p.name} className="block size-48 rounded-lg border object-cover shadow-raised" />
                <span
                  className={`absolute inset-x-2 bottom-2 truncate rounded bg-backdrop px-3 text-center text-[10px] leading-[1.4] ${isLarge(p) ? 'text-amber' : 'text-white'}`}
                  data-size
                >
                  {p.progress === undefined ? formatBytes(p.size) : `${Math.floor(p.progress * 100)}%`}
                </span>
              </div>
            ) : (
              <div className={`${FILE_CHIP} h-48 bg-bg pr-20 shadow-raised`} title={p.name}>
                <span className="flex min-w-0 flex-col leading-[1.35]">
                  <span className="truncate text-ui">{p.name}</span>
                  <span className={`truncate text-sm ${isLarge(p) ? 'text-amber' : 'text-faint'}`} data-size>
                    {sizeText(p)}
                  </span>
                </span>
              </div>
            )}
            <Hint text="Remove">
              <button
                className="absolute -top-4 -right-4 grid size-18 place-items-center rounded-full border bg-raised text-[12px] leading-none text-muted shadow-raised hover:text-text"
                aria-label={`Remove ${p.name}`}
                onClick={() => unattach([p])}
              >
                ×
              </button>
            </Hint>
          </li>
        ))}
      </ul>
      {pending.length > 1 && (
        <p className="text-sm text-faint" data-total>
          {pending.length} files · {formatBytes(total)}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-amber" role="status">
          {warning}
        </p>
      ))}
    </div>
  )
}
