// The ⋯ beside a message's Copy: what the user can do to the message itself, such as Delete. Shown on hover or keyboard
// focus like Copy, and kept in view while its menu is open.
import { useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { m } from 'motion/react'
import type { ClientMessage } from '@kothar/core/shared'
import { Button, confirm, COPY_REVEAL, Hint, MOTION } from '../controls.tsx'
import type { ChatView, Item } from '../state.ts'

export type MessageMenuItem = { label: string; run: () => void; danger?: boolean; disabledReason?: string }
type Kind = 'user' | 'work' | 'talk'

// Said wherever a message is taken back, not only on hover: these never undo what the agent did to files.
export const FILES_STAY = 'Files the agent changed stay as they are.'

const WHAT: Record<Kind, { noun: string; body: string }> = {
  user: { noun: 'message', body: 'It goes from the chat and from what the agent remembers.' },
  work: { noun: 'report', body: 'It goes from the chat and from what the agent remembers.' },
  talk: { noun: 'reply', body: 'Its tool calls go with it, from the chat and from what the agent remembers.' },
}

/**
 * Where the running turn starts among the loaded items' log entries: the last message or report that started a turn.
 * A chat that isn't running has none (Infinity).
 */
export function runningFrom(chat: Pick<ChatView, 'status' | 'items'>): number {
  if (chat.status === 'idle') return Infinity
  const started = chat.items.flatMap((item: Item) =>
    (item.kind === 'user' && !item.midTurn) || item.kind === 'report' ? (item.entry === undefined ? [] : [item.entry]) : [],
  )
  return started.length ? Math.max(...started) : 0
}

/** The Delete item for the message at entry, greyed out while its turn runs. */
export function deleteItem(chat: ChatView, entry: number, kind: Kind, send: (m: ClientMessage) => void): MessageMenuItem {
  const { noun, body } = WHAT[kind]
  const running = entry >= runningFrom(chat)
  return {
    label: 'Delete',
    danger: true,
    ...(running && { disabledReason: `This ${noun}'s turn is still running. Stop it first, or wait for it to end.` }),
    run: async () => {
      const ok = await confirm({ text: `Delete this ${noun}?`, body: `${body} ${FILES_STAY}`, ok: 'Delete', danger: true })
      if (ok) send({ type: 'chat.deleteMessage', chatId: chat.id, entry })
    },
  }
}

const STOP_FIRST = 'Stop the chat first, or wait for its turn to end.'

/** Edit: the message turns into a box in place; saving sends it again from there (EditBox). */
export function editItem(chat: ChatView, start: () => void): MessageMenuItem {
  return { label: 'Edit', run: start, ...(chat.status !== 'idle' && { disabledReason: STOP_FIRST }) }
}

/** Undo, on the user's last message: it and everything after it go, and it comes back to the composer. */
export function undoItem(chat: ChatView, entry: number, send: (m: ClientMessage) => void): MessageMenuItem {
  return {
    label: 'Undo',
    ...(chat.status !== 'idle' && { disabledReason: STOP_FIRST }),
    run: async () => {
      const ok = await confirm({
        text: 'Undo this message?',
        body: `It and the reply to it go from the chat and from what the agent remembers, and its text comes back to the message box. ${FILES_STAY}`,
        ok: 'Undo',
      })
      if (ok) send({ type: 'chat.undoMessage', chatId: chat.id, entry })
    },
  }
}

/** Whether item is the user's last message in the chat, the one Undo is offered on. */
export const isLastMessage = (chat: Pick<ChatView, 'items'>, entry: number) =>
  chat.items.findLast((item): item is Extract<Item, { kind: 'user' }> => item.kind === 'user' && item.entry !== undefined)?.entry ===
  entry

type EditProps = { text: string; save: (text: string) => void; cancel: () => void; canSave: (text: string) => boolean }

/** The user's message, editable in place: Enter sends it again, Shift+Enter makes a new line, Esc cancels. */
export function EditBox({ text: initial, save, cancel, canSave }: EditProps) {
  const [text, setText] = useState(initial)
  const ok = canSave(text)
  return (
    <div className="flex w-full min-w-[min(28rem,100%)] flex-col gap-6" data-edit-box>
      <textarea
        className="block max-h-[calc(12lh+16px)] min-h-[calc(2lh+16px)] w-full resize-none rounded-[12px_12px_4px_12px] border border-accent bg-panel px-12 py-8 text-body leading-[1.5] shadow-floating field-sizing-content"
        aria-label="Edit message"
        value={text}
        autoFocus
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (ok) save(text)
          }
        }}
      />
      <div className="flex items-center justify-end gap-8">
        <span className="mr-auto text-xs text-muted">Sends again from here; later messages go. {FILES_STAY}</span>
        <Button variant="ghost" size="small" onClick={cancel}>
          Cancel
        </Button>
        <Button variant="primary" size="small" disabled={!ok} onClick={() => save(text)}>
          Send
        </Button>
      </div>
    </div>
  )
}

type Props = { label: string; items: MessageMenuItem[]; connected: boolean; className?: string }

export function MessageMenu({ label, items, connected, className = '' }: Props) {
  if (!items.length) return null
  return (
    <DropdownMenu.Root modal={false}>
      <Hint text="More">
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={`grid size-24 shrink-0 place-items-center rounded text-muted transition-[opacity,background-color,color] duration-150 hover:bg-raised hover:text-text disabled:cursor-default data-[state=open]:bg-raised data-[state=open]:text-text data-[state=open]:opacity-100 ${COPY_REVEAL} ${className}`}
            aria-label={label}
            disabled={!connected}
            data-message-menu
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.25" />
              <circle cx="8" cy="8" r="1.25" />
              <circle cx="12.5" cy="8" r="1.25" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
      </Hint>
      <DropdownMenu.Portal>
        <DropdownMenu.Content asChild align="start" sideOffset={4}>
          <m.div
            className="z-20 flex min-w-120 flex-col rounded-lg border bg-panel p-4 shadow-floating outline-none"
            initial={MOTION.menu.initial}
            animate={MOTION.menu.animate}
            transition={MOTION.menu.transition}
          >
            {items.map((item) => (
              <Hint key={item.label} text={item.disabledReason} side="left">
                <DropdownMenu.Item
                  disabled={!!item.disabledReason}
                  onSelect={item.run}
                  className={`flex h-26 items-center rounded-sm px-12 text-sm whitespace-nowrap outline-none data-disabled:text-faint ${item.danger ? 'text-red data-highlighted:bg-red/10' : 'data-highlighted:bg-raised'}`}
                >
                  {item.label}
                </DropdownMenu.Item>
              </Hint>
            ))}
          </m.div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
