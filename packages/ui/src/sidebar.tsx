import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Dialog, DropdownMenu, HoverCard } from 'radix-ui'
import type { ChatStatus, ClientMessage, SpaceGroup } from '@kothar/core/shared'
import { collapsedGroups, collapseGroup, useCollapsedGroups } from './collapsed-groups.ts'
import { Button, CHAT_NOUN, Chevron, confirm, Hint, MOTION, NAV_LABEL, useReturnFocus, useSettled } from './controls.tsx'
import { foldChat, useFoldedChats } from './folded.ts'
import { chatTree, familyOf, folderOf, groupOf, workerRequests, type ChatView, type TreeRow } from './state.ts'
import { Keys } from './shortcuts-page.tsx'
import type { Binding } from './shortcuts.ts'
import { showsUnread } from './unread.ts'

const CHAT_BUSY = `Stop this ${CHAT_NOUN.one} and the ones below it first`
const DOTS: Record<ChatStatus, string> = {
  idle: 'bg-faint',
  running: 'bg-green animate-blink',
  waiting: 'bg-amber',
  // Amber means only "waiting on you": a chat on its way to idle blinks grey.
  stopping: 'bg-muted animate-blink',
}
/** A folded row shows the busiest status among the workers it hides. */
const BUSIEST: ChatStatus[] = ['waiting', 'stopping', 'running', 'idle']
// Each level puts a worker's dot under its parent's name; deeper levels stop there, so a long chain of workers never
// pushes the row sideways.
const INDENTS = ['pl-8', 'pl-22', 'pl-36', 'pl-50']
// Selected rows are filled; hovered ones get a lighter wash, so the open chat stays distinct under the pointer.
const ROW_SELECTED = 'bg-raised text-text'
const ROW_HOVER = 'hover:bg-raised/50 has-data-[state=open]:bg-raised/50 has-data-[state=open]:text-text'
// A row's ⋯: shown on hover, on keyboard focus and while its menu is open. Its place is always kept (never display:
// none), so nothing in the row moves when the pointer comes in: the workers chevron beside it stays put under the click.
const ROW_ACTION =
  'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 ' +
  'group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 ' +
  'has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100'
// The Spaces label's New group button: the same, shown on hover or focus with its place kept.
const LABEL_ACTION =
  'pointer-events-none opacity-0 group-hover/label:pointer-events-auto group-hover/label:opacity-100 ' +
  'focus-visible:pointer-events-auto focus-visible:opacity-100'
// Below a 240 px sidebar (its list's content is then under 216 px) an engine's name squeezes the chat's, so it shrinks
// to a two-letter mark. Measured at 180 to 320 px sidebars: narrower, "claude-code" fit only as "clau…" while a nested
// worker's name dropped under 70 px. In px, not rem: the app's root font is 13px. Tailwind needs the classes in full.
const ENGINE_LABEL_WIDE = 'hidden @min-[216px]:inline'
const ENGINE_MARK_WIDE = '@min-[216px]:hidden'
// Two letters an engine is known by in a narrow sidebar; any other engine gets its own name's initials.
const ENGINE_MARKS: Record<string, string> = { 'claude-code': 'CC', codex: 'CX', opencode: 'OC', pi: 'PI' }

/** An engine's two-letter mark: "CC" for claude-code, the initials of a two-word id, else its first two letters. */
export function engineMark(engine: string) {
  if (ENGINE_MARKS[engine]) return ENGINE_MARKS[engine]
  const words = engine.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const mark = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? engine).slice(0, 2)
  return mark.toUpperCase()
}

// After a keyboard move, the row is focused again for this long, while the core's updates reorder the list.
const REFOCUS_MS = 1000
// A folded group's spaces pop out beside it on hover. The delays let the pointer cross from the row into the popup
// (Radix HoverCard keeps it open while the pointer is over either), and keep it from flashing as the pointer passes.
const PEEK_OPEN_MS = 200
const PEEK_CLOSE_MS = 150

type MenuItem = { label: string; run?: () => void; danger?: boolean; disabledReason?: string; items?: MenuItem[] }

const MENU_ITEM = 'flex h-26 items-center rounded-sm px-12 text-sm whitespace-nowrap outline-none data-disabled:text-faint'
const MENU_PANEL = 'z-20 flex min-w-140 flex-col rounded-lg border bg-panel p-4 shadow-floating outline-none'

function MenuItems({ items }: { items: MenuItem[] }) {
  return items.map((item) =>
    item.items ? (
      <DropdownMenu.Sub key={item.label}>
        <DropdownMenu.SubTrigger
          disabled={!!item.disabledReason}
          className={`${MENU_ITEM} justify-between gap-12 after:text-faint after:content-['›'] data-highlighted:bg-raised data-[state=open]:bg-raised`}
        >
          {item.label}
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent sideOffset={2} alignOffset={-4} className={MENU_PANEL}>
            <MenuItems items={item.items} />
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    ) : (
      <Hint key={item.label} text={item.disabledReason} side="left">
        <DropdownMenu.Item
          disabled={!!item.disabledReason}
          onSelect={item.run}
          className={`${MENU_ITEM} ${item.danger ? 'text-red data-highlighted:bg-red/10' : 'data-highlighted:bg-raised'}`}
        >
          {item.label}
        </DropdownMenu.Item>
      </Hint>
    ),
  )
}

function RowMenu({
  label,
  items,
  onOpenChange,
}: {
  label: string
  items: MenuItem[]
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <div className={`mr-2 shrink-0 ${ROW_ACTION}`} data-row-action>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${label}`}>
            ⋯
          </Button>
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content asChild align="end" sideOffset={4}>
          <m.div
            className={MENU_PANEL}
            initial={MOTION.menu.initial}
            animate={MOTION.menu.animate}
            transition={MOTION.menu.transition}
          >
            <MenuItems items={items} />
          </m.div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type Reorder = {
  dragging: boolean
  drop?: 'before' | 'after'
  start: (e: DragEvent) => void
  over: (e: DragEvent) => void
  land: (e: DragEvent) => void
  end: () => void
  key: (e: KeyboardEvent) => void
}

type RowProps = {
  row: TreeRow
  animate: boolean
  title: string
  selected: boolean
  // Shown as the chat's status while a worker below it waits for approval, since the user answers it here.
  status: ChatStatus
  // Bold: a space or Home whose own lead finished a turn the user hasn't seen.
  unread: boolean
  showEngine: boolean
  // In the sidebar list, the engine label gives way to a two-letter mark when the sidebar is narrow. The group popup
  // sizes itself to its rows, so there the label always shows in full.
  narrowable?: boolean
  select: () => void
  menu?: MenuItem[]
  fold?: { folded: boolean; hidden: ChatView[]; toggle: () => void }
  reorder?: Reorder
  // Inside a sidebar group: one step further in.
  inGroup?: boolean
}

function ChatRow(props: RowProps) {
  const { row, animate, title, selected, status: own, unread, showEngine, narrowable = true, select, menu, fold, reorder, inGroup } = props
  const { chat } = row
  const depth = row.depth + (inGroup ? 1 : 0)
  const status = fold?.folded ? BUSIEST.find((s) => [own, ...fold.hidden.map((c) => c.status)].includes(s))! : own
  const highlight = selected ? ROW_SELECTED : unread ? `text-text ${ROW_HOVER}` : `text-muted hover:text-text ${ROW_HOVER}`
  return (
    <m.div
      className={`group/row relative flex min-w-0 shrink-0 items-center rounded transition-colors ${highlight} ${reorder?.dragging ? 'opacity-50' : ''}`}
      {...MOTION.collapse}
      initial={animate && MOTION.collapse.initial}
    >
      <button
        className={`flex h-control min-w-0 flex-1 items-center gap-8 pr-8 text-left whitespace-nowrap ${INDENTS[Math.min(depth, INDENTS.length - 1)]}`}
        title={`${title} · ${chat.engine}${chat.worker ? ' (worker)' : ''}`}
        onClick={select}
        data-chat-id={chat.id}
        draggable={reorder && row.depth === 0 ? true : undefined}
        onDragStart={reorder?.start}
        onDragOver={reorder?.over}
        onDrop={reorder?.land}
        onDragEnd={reorder?.end}
        onKeyDown={reorder?.key}
      >
        <span className={`size-7 shrink-0 rounded-full ${DOTS[status]}`} data-status={status} />
        {chat.extension === 'home' && <HouseIcon />}
        {/* The name takes what the engine label (at most a third of the row) or mark leaves, and keeps a few letters. */}
        <span
          className={`min-w-[2.5em] flex-1 truncate ${unread ? 'font-semibold' : ''}`}
          data-unread={unread || undefined}
        >
          {chat.name}
        </span>
        {/* Always shown: the ⋯ has its own place, so nothing needs to make room for it on hover. */}
        {showEngine && (
          <span
            className={`max-w-[33%] min-w-0 truncate text-xs text-faint ${narrowable ? ENGINE_LABEL_WIDE : ''}`}
            data-engine
          >
            {chat.engine}
          </span>
        )}
        {/* A narrow sidebar's engine mark: muted letters at the row's end, apart from the round status dot at its start. */}
        {showEngine && narrowable && (
          <span
            aria-hidden
            className={`shrink-0 font-mono text-[10px] leading-none tracking-wide text-faint ${ENGINE_MARK_WIDE}`}
            data-engine-mark
          >
            {engineMark(chat.engine)}
          </span>
        )}
      </button>
      {fold && (
        <Hint text={fold.folded ? 'Show workers' : 'Hide workers'}>
          <Button
            variant="ghost"
            size="none"
            className="group mr-2 flex h-22 items-center gap-4 px-4 text-xs text-faint"
            aria-label={fold.folded ? 'Show workers' : 'Hide workers'}
            aria-expanded={!fold.folded}
            data-open={fold.folded ? undefined : ''}
            onClick={fold.toggle}
          >
            {fold.folded && <span className="tabular-nums">{fold.hidden.length}</span>}
            <Chevron />
          </Button>
        </Hint>
      )}
      {menu && <RowMenu label={chat.name} items={menu} />}
      {reorder?.drop && (
        <span
          aria-hidden
          data-drop={reorder.drop}
          className={`pointer-events-none absolute inset-x-4 h-2 rounded-full bg-accent ${reorder.drop === 'before' ? '-top-2' : '-bottom-2'}`}
        />
      )}
    </m.div>
  )
}

function HouseIcon() {
  return (
    <svg className="size-14 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3v-3.5h2V13h3V6.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export type NameRequest = { kind: 'new' } | { kind: 'rename'; chatId: string; name: string }

type SidebarProps = {
  chats: ChatView[]
  selectedId: string
  // The user is looking at this window, so the open chat is being seen.
  looking?: boolean
  connected: boolean
  send: (m: ClientMessage) => void
  select: (chatId: string) => void
  askName: (request: NameRequest) => void
  // The New space shortcut, shown when the New space button is hovered.
  newSpaceKeys?: Binding | null
  // Extension launchers to list at the top, under Home (Settings → Appearance can move them to the bottom).
  launchers?: Launcher[]
  // The user's groups of spaces, top to bottom (groups.json).
  groups?: SpaceGroup[]
}

export function ChatNav({
  chats,
  selectedId,
  looking = true,
  connected,
  send,
  select,
  askName,
  newSpaceKeys,
  launchers = [],
  groups = [],
}: SidebarProps) {
  const offline = connected ? undefined : 'Disconnected from the core'
  const settled = useSettled(chats.length > 0)
  const tree = chatTree(chats, groups)
  // Extension chats (Home) sort first; they sit above the spaces, apart from them.
  const firstSpace = tree.active.findIndex((r) => r.depth === 0 && !r.chat.extension)
  const split = firstSpace < 0 ? tree.active.length : firstSpace
  const folded = useFoldedChats()
  const collapsed = useCollapsedGroups()
  // A row is hidden while a chat above it is folded, unless it's the chat being viewed.
  const ancestors = (chat: ChatView): ChatView[] => {
    const parent = chats.find((c) => c.id === chat.parentId)
    return parent ? [parent, ...ancestors(parent)] : []
  }
  const shown = (row: TreeRow) => row.chat.id === selectedId || !ancestors(row.chat).some((c) => folded.has(c.id))
  const mixedEngines = new Set(chats.map((c) => c.engine)).size > 1
  const rootOf = (chat: ChatView) => ancestors(chat).at(-1) ?? chat
  const spaceRows = tree.active.slice(split)
  // Where a space sits: Pinned, a group (by id), or the ungrouped spaces ('').
  type Place = 'pinned' | string
  const placeOf = (space: ChatView): Place => (space.pinned ? 'pinned' : (groupOf(space, groups)?.id ?? ''))
  const rowsIn = (place: Place) => spaceRows.filter((r) => placeOf(rootOf(r.chat)) === place)
  const spacesIn = (place: Place) =>
    rowsIn(place)
      .filter((r) => r.depth === 0)
      .map((r) => r.chat)

  // Opening a space hidden in a collapsed group (from search, a shortcut or a link) opens its group.
  // Only when the open chat changes, so the user can still collapse the group the open space is in.
  const selected = chats.find((c) => c.id === selectedId)
  const selectedPlace = selected && !selected.archived ? placeOf(rootOf(selected)) : 'pinned'
  // A space opened from a folded group's popup: its group stays folded.
  const keepFolded = useRef<string | null>(null)
  useEffect(() => {
    const kept = keepFolded.current === selectedId
    keepFolded.current = null
    if (kept) return
    if (selectedPlace !== 'pinned' && selectedPlace !== '' && collapsedGroups().has(selectedPlace)) {
      collapseGroup(selectedPlace, false)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- on a new open chat only, not on every move or collapse
  }, [selectedId])

  const [drag, setDrag] = useState<{
    id: string
    kind: 'space' | 'group'
    over?: { id: string; after: boolean } | { into: string }
  } | null>(null)
  // Naming a group inline: a new one (with the space that goes in it, from a space's menu) or a rename.
  const [naming, setNaming] = useState<{ kind: 'new'; chatId?: string } | { kind: 'rename'; groupId: string } | null>(
    null,
  )
  const refocus = useRef<{ id: string; until: number } | null>(null)
  useEffect(() => {
    const pending = refocus.current
    if (!pending) return
    if (Date.now() > pending.until) refocus.current = null
    else document.querySelector<HTMLElement>(`nav [data-chat-id="${pending.id}"], nav [data-group-id="${pending.id}"]`)?.focus()
  }, [chats, groups])
  // group: into that group, or null for none; left out, the space stays in its own. With no index, an unpinned space
  // goes back where it was before it was pinned (the core keeps the spot).
  const move = (chat: ChatView, pinned: boolean, index?: number, group?: string | null) =>
    send({
      type: 'chat.move',
      chatId: chat.id,
      pinned,
      ...(index !== undefined && { index }),
      ...(group !== undefined && { group }),
    })
  // Moves a space one place up or down where it sits, keeping it focused when done from the keyboard.
  const step = (chat: ChatView, by: -1 | 1, keyboard = false) => {
    const place = spacesIn(placeOf(chat))
    const index = place.findIndex((c) => c.id === chat.id) + by
    if (index < 0 || index >= place.length) return
    // oxlint-disable-next-line react/purity -- step runs only from key and menu handlers, never during render
    if (keyboard) refocus.current = { id: chat.id, until: Date.now() + REFOCUS_MS }
    move(chat, !!chat.pinned, index)
  }
  const stepGroup = (group: SpaceGroup, by: -1 | 1, keyboard = false) => {
    const index = groups.findIndex((g) => g.id === group.id) + by
    if (index < 0 || index >= groups.length) return
    // oxlint-disable-next-line react/purity -- stepGroup runs only from key and menu handlers, never during render
    if (keyboard) refocus.current = { id: group.id, until: Date.now() + REFOCUS_MS }
    send({ type: 'group.move', groupId: group.id, index })
  }
  const after = (e: DragEvent) => {
    const box = e.currentTarget.getBoundingClientRect()
    return e.clientY > box.top + box.height / 2
  }
  const reorder = (row: TreeRow): Reorder | undefined => {
    if (!connected || row.chat.archived || row.chat.extension) return undefined
    const space = rootOf(row.chat)
    const isAfter = (e: DragEvent) => row.depth > 0 || after(e)
    const over = drag?.over && 'id' in drag.over ? drag.over : undefined
    return {
      dragging: drag?.id === row.chat.id,
      drop:
        drag?.kind === 'space' && drag.id !== space.id && over?.id === row.chat.id
          ? over.after
            ? 'after'
            : 'before'
          : undefined,
      start: (e) => {
        if (row.depth > 0) return e.preventDefault()
        e.dataTransfer?.setData('text/plain', row.chat.name)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        setDrag({ id: row.chat.id, kind: 'space' })
      },
      over: (e) => {
        if (drag?.kind !== 'space') return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        const below = isAfter(e)
        // The indicator sits on the row the space lands next to: below a space's last worker when after it.
        const family = rowsIn(placeOf(space)).filter((r) => rootOf(r.chat).id === space.id && shown(r))
        const id = below ? family.at(-1)!.chat.id : space.id
        if (over?.id !== id || over.after !== below) setDrag({ ...drag, over: { id, after: below } })
      },
      land: (e) => {
        if (drag?.kind !== 'space') return
        e.preventDefault()
        const dragged = chats.find((c) => c.id === drag.id)
        setDrag(null)
        if (!dragged || dragged.id === space.id) return
        const pinned = !!space.pinned
        const place = spacesIn(placeOf(space)).filter((c) => c.id !== dragged.id)
        const index = place.findIndex((c) => c.id === space.id) + (isAfter(e) ? 1 : 0)
        // Dropped among unpinned spaces, it joins their group (or none); in Pinned, it keeps its own.
        const target = groupOf(space, groups)?.id ?? null
        move(dragged, pinned, index, pinned || target === (groupOf(dragged, groups)?.id ?? null) ? undefined : target)
      },
      end: () => setDrag(null),
      key: (e) => {
        if (!e.altKey || row.depth > 0 || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault()
        step(row.chat, e.key === 'ArrowUp' ? -1 : 1, true)
      },
    }
  }

  const chatMenu = (chat: ChatView): MenuItem[] => {
    const family = familyOf(chats, chat.id)
    const disabledReason = offline ?? (family.some((c) => c.status !== 'idle') ? CHAT_BUSY : undefined)
    const remove = async () => {
      const below = family.length > 1 ? ' and everything below it' : ''
      const work = chat.workDir ? ` Its work folder goes too (${chat.workDir}); its git branches stay.` : ''
      const text =
        `Delete “${chat.name}”${below}? Messages are deleted from Kothar; your folders and files stay on disk.` + work
      if (await confirm(text)) send({ type: 'chat.delete', chatId: chat.id })
    }
    const place = spacesIn(placeOf(chat))
    const index = place.findIndex((c) => c.id === chat.id)
    const group = groupOf(chat, groups)
    // Pinned spaces sit in Pinned whatever their group, so they're grouped once unpinned.
    const grouping: MenuItem[] =
      chat.archived || chat.pinned
        ? []
        : [
            {
              label: 'Move to group',
              disabledReason: offline,
              items: [
                ...groups
                  .filter((g) => g.id !== group?.id)
                  .map((g) => ({ label: g.name, run: () => move(chat, false, Number.MAX_SAFE_INTEGER, g.id) })),
                { label: 'New group…', run: () => setNaming({ kind: 'new', chatId: chat.id }) },
              ],
            },
            ...(group
              ? [{ label: 'Remove from group', disabledReason: offline, run: () => move(chat, false, 0, null) }]
              : []),
          ]
    const placing: MenuItem[] = chat.archived
      ? []
      : [
          chat.pinned
            ? { label: 'Unpin', disabledReason: offline, run: () => move(chat, false) }
            : { label: 'Pin', disabledReason: offline, run: () => move(chat, true, spacesIn('pinned').length) },
          ...grouping,
          ...(index > 0 ? [{ label: 'Move up', disabledReason: offline, run: () => step(chat, -1) }] : []),
          ...(index < place.length - 1
            ? [{ label: 'Move down', disabledReason: offline, run: () => step(chat, 1) }]
            : []),
        ]
    return [
      {
        label: 'Rename…',
        disabledReason: offline,
        run: () => askName({ kind: 'rename', chatId: chat.id, name: chat.name }),
      },
      ...placing,
      {
        label: chat.archived ? 'Unarchive' : 'Archive',
        disabledReason,
        run: () => send({ type: 'chat.archive', chatId: chat.id, archived: !chat.archived }),
      },
      { label: 'Delete…', danger: true, disabledReason, run: remove },
    ]
  }
  const pinnedRows = rowsIn('pinned')
  const row = (row: TreeRow) => {
    const { chat } = row
    const folder = folderOf(chats, chat) ?? 'Not tied to a folder'
    const below = familyOf(chats, chat.id).filter((c) => c.id !== chat.id && c.archived === chat.archived)
    const isFolded = folded.has(chat.id)
    const asksBelow = !chat.worker && workerRequests(chats, chat.id).length > 0
    const root = rootOf(chat)
    return (
      <ChatRow
        key={chat.id}
        row={row}
        animate={settled.current}
        title={`${chat.name}: ${folder}`}
        selected={chat.id === selectedId}
        status={asksBelow ? 'waiting' : chat.status}
        unread={showsUnread(chat, looking && chat.id === selectedId)}
        // A worker usually runs on its parent's engine, so only a different one is worth a label.
        showEngine={mixedEngines && chats.find((c) => c.id === chat.parentId)?.engine !== chat.engine}
        select={() => select(chat.id)}
        menu={chat.extension || chat.worker ? undefined : chatMenu(chat)}
        fold={below.length ? { folded: isFolded, hidden: below, toggle: () => foldChat(chat.id, !isFolded) } : undefined}
        reorder={reorder(row)}
        inGroup={!root.archived && !root.extension && placeOf(root) !== 'pinned' && placeOf(root) !== ''}
      />
    )
  }

  const nameGroup = (name: string) => {
    if (!naming || !connected) return setNaming(null)
    if (naming.kind === 'new') send({ type: 'group.create', name, ...(naming.chatId && { chatId: naming.chatId }) })
    else send({ type: 'group.rename', groupId: naming.groupId, name })
    setNaming(null)
  }
  const groupBlock = (group: SpaceGroup, index: number) => {
    const rows = rowsIn(group.id)
    const isCollapsed = collapsed.has(group.id)
    const toggle = () => collapseGroup(group.id, !isCollapsed)
    // What a collapsed group hides: the busiest status among its spaces and their workers, and whether any is unread.
    const statuses = rows.map((r) =>
      !r.chat.worker && workerRequests(chats, r.chat.id).length > 0 ? 'waiting' : r.chat.status,
    )
    const unread = rows.some((r) => r.depth === 0 && showsUnread(r.chat, looking && r.chat.id === selectedId))
    const into = drag?.over && 'into' in drag.over && drag.over.into === group.id
    const between = drag?.over && 'id' in drag.over && drag.over.id === group.id ? drag.over : undefined
    const menu: MenuItem[] = [
      { label: 'Rename…', disabledReason: offline, run: () => setNaming({ kind: 'rename', groupId: group.id }) },
      ...(index > 0 ? [{ label: 'Move up', disabledReason: offline, run: () => stepGroup(group, -1) }] : []),
      ...(index < groups.length - 1
        ? [{ label: 'Move down', disabledReason: offline, run: () => stepGroup(group, 1) }]
        : []),
      // Nothing is lost: its spaces go back to the ungrouped ones.
      {
        label: 'Delete group',
        danger: true,
        disabledReason: offline,
        run: () => send({ type: 'group.delete', groupId: group.id }),
      },
    ]
    const renaming = naming?.kind === 'rename' && naming.groupId === group.id
    // What the folded group's popup lists: its spaces, each showing the busiest status among it and its workers.
    const peek: Peek = {
      spaces: rows
        .filter((r) => r.depth === 0)
        .map((r) => {
          const below = rows.filter((w) => w.depth > 0 && rootOf(w.chat).id === r.chat.id).map((w) => w.chat.status)
          const own = !r.chat.worker && workerRequests(chats, r.chat.id).length > 0 ? 'waiting' : r.chat.status
          return {
            chat: r.chat,
            title: `${r.chat.name}: ${folderOf(chats, r.chat) ?? 'Not tied to a folder'}`,
            status: BUSIEST.find((s) => [own, ...below].includes(s))!,
            unread: showsUnread(r.chat, looking && r.chat.id === selectedId),
            selected: r.chat.id === selectedId,
          }
        }),
      blocked: !!drag,
      showEngine: mixedEngines,
      select: (chatId) => {
        // Picked from the popup, the group stays folded: the user chose to keep it that way.
        keepFolded.current = chatId
        select(chatId)
      },
    }
    // How many of its spaces are in that top status (or unread, with nothing busy): shown beside the dot when it's more
    // than one.
    const top = BUSIEST.find((s) => statuses.includes(s)) ?? 'idle'
    const needing = peek.spaces.filter((space) => (top === 'idle' ? space.unread : space.status === top)).length
    return (
      <div key={`group:${group.id}`} role="group" aria-label={group.name} className="flex flex-col gap-1">
        <GroupRow
          group={group}
          animate={settled.current}
          collapsed={isCollapsed}
          count={rows.filter((r) => r.depth === 0).length}
          status={top}
          unread={unread}
          needing={needing}
          toggle={toggle}
          menu={menu}
          renaming={renaming}
          rename={nameGroup}
          cancelRename={() => setNaming(null)}
          peek={peek}
          dragging={drag?.id === group.id}
          into={!!into}
          drop={between && drag?.id !== group.id ? (between.after ? 'after' : 'before') : undefined}
          drag={
            connected
              ? {
                  start: (e) => {
                    e.dataTransfer?.setData('text/plain', group.name)
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                    setDrag({ id: group.id, kind: 'group' })
                  },
                  over: (e) => {
                    if (!drag || drag.id === group.id) return
                    e.preventDefault()
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                    const next = drag.kind === 'space' ? { into: group.id } : { id: group.id, after: after(e) }
                    if (JSON.stringify(next) !== JSON.stringify(drag.over)) setDrag({ ...drag, over: next })
                  },
                  land: (e) => {
                    if (!drag || drag.id === group.id) return
                    e.preventDefault()
                    setDrag(null)
                    if (drag.kind === 'space') {
                      const dragged = chats.find((c) => c.id === drag.id)
                      if (dragged) move(dragged, false, Number.MAX_SAFE_INTEGER, group.id)
                      return
                    }
                    const rest = groups.filter((g) => g.id !== drag.id)
                    const at = rest.findIndex((g) => g.id === group.id) + (after(e) ? 1 : 0)
                    send({ type: 'group.move', groupId: drag.id, index: at })
                  },
                  end: () => setDrag(null),
                  key: (e) => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                    e.preventDefault()
                    stepGroup(group, e.key === 'ArrowUp' ? -1 : 1, true)
                  },
                }
              : undefined
          }
        />
        <AnimatePresence>{isCollapsed ? null : rows.filter(shown).map(row)}</AnimatePresence>
      </div>
    )
  }
  // The Spaces label takes a dragged space out of its group, to the top of the ungrouped ones.
  const intoUngrouped = {
    onDragOver: (e: DragEvent) => {
      if (drag?.kind !== 'space') return
      e.preventDefault()
      if (!drag.over || !('into' in drag.over) || drag.over.into !== '') setDrag({ ...drag, over: { into: '' } })
    },
    onDrop: (e: DragEvent) => {
      if (drag?.kind !== 'space') return
      e.preventDefault()
      const dragged = chats.find((c) => c.id === drag.id)
      setDrag(null)
      if (dragged) move(dragged, false, 0, null)
    },
  }
  const overUngrouped = !!drag?.over && 'into' in drag.over && drag.over.into === ''

  return (
    <nav className="@container flex min-w-0 flex-1 scroll-inset flex-col gap-1 overflow-x-hidden overflow-y-auto pt-10 pr-0 pb-8 pl-8">
      <AnimatePresence>{tree.active.slice(0, split).filter(shown).map(row)}</AnimatePresence>
      {launchers.length > 0 && (
        <div role="group" aria-label="Extensions" className="flex flex-col gap-1">
          <LauncherRows launchers={launchers} top />
        </div>
      )}
      {pinnedRows.length > 0 && (
        <>
          <h2 id="pinned-label" className={NAV_LABEL}>
            Pinned
          </h2>
          <div role="group" aria-labelledby="pinned-label" className="flex flex-col gap-1">
            <AnimatePresence>{pinnedRows.filter(shown).map(row)}</AnimatePresence>
          </div>
        </>
      )}
      <div className="group/label flex items-center rounded" {...intoUngrouped}>
        <h2
          id="spaces-label"
          className={`${NAV_LABEL} flex-1 rounded ${overUngrouped ? 'text-accent' : ''}`}
          data-drop-into={overUngrouped || undefined}
        >
          {CHAT_NOUN.many}
        </h2>
        <Hint text="New group" side="right">
          <Button
            variant="ghost"
            size="icon"
            aria-label="New group"
            className={`mt-10 mr-2 ${LABEL_ACTION}`}
            disabled={!connected}
            onClick={() => setNaming({ kind: 'new' })}
          >
            <FolderPlusIcon />
          </Button>
        </Hint>
      </div>
      {groups.map(groupBlock)}
      {naming?.kind === 'new' && (
        <GroupNameInput label="New group name" initial="" done={nameGroup} cancel={() => setNaming(null)} />
      )}
      <div role="group" aria-labelledby="spaces-label" className="flex flex-col gap-1">
        <AnimatePresence>{rowsIn('').filter(shown).map(row)}</AnimatePresence>
      </div>
      <Hint text={newSpaceKeys && <Keys binding={newSpaceKeys} />} side="right">
        {/* As wide and tall as a space row, its label under the space names: the + sits where a row's dot does
            (pl-7 plus the button's 1px border makes the rows' pl-8). */}
        <Button
          variant="ghost"
          size="none"
          className="flex h-control w-full shrink-0 items-center gap-8 pr-8 pl-7 text-left"
          disabled={!connected}
          onClick={() => askName({ kind: 'new' })}
        >
          <span aria-hidden="true" className="flex w-7 shrink-0 justify-center">
            +
          </span>
          New {CHAT_NOUN.one}
        </Button>
      </Hint>

      {tree.archived.length > 0 && (
        <details className="group mt-auto">
          <summary className={`list-none ${NAV_LABEL}`}>
            <Chevron />
            Archived ({tree.archived.filter((r) => r.depth === 0).length})
          </summary>
          <AnimatePresence>{tree.archived.filter(shown).map(row)}</AnimatePresence>
        </details>
      )}
    </nav>
  )
}

type GroupDrag = Omit<Reorder, 'dragging' | 'drop'>

type PeekSpace = { chat: ChatView; title: string; status: ChatStatus; unread: boolean; selected: boolean }
/** A folded group's popup: its spaces, whether something (a drag) keeps it shut, and what picking one does. */
type Peek = {
  spaces: PeekSpace[]
  blocked: boolean
  showEngine: boolean
  select: (chatId: string) => void
}

type GroupRowProps = {
  group: SpaceGroup
  animate: boolean
  collapsed: boolean
  count: number
  status: ChatStatus
  unread: boolean
  // How many spaces are in `status` (or unread, when it's idle); a count shows beside the dot from two up.
  needing: number
  toggle: () => void
  menu: MenuItem[]
  renaming: boolean
  rename: (name: string) => void
  cancelRename: () => void
  dragging: boolean
  // A space dragged over it goes in; a group dragged over it lands before or after it.
  into: boolean
  drop?: 'before' | 'after'
  drag?: GroupDrag
  peek?: Peek
}

/** A folded group's count takes its dot's colour, so it reads as part of the dot, not a second total. */
const NEEDING_TEXT: Record<ChatStatus, string> = { idle: 'text-text', running: 'text-green', waiting: 'text-amber', stopping: 'text-muted' }
const NEEDING: Record<ChatStatus, string> = { waiting: 'waiting', stopping: 'stopping', running: 'running', idle: 'unread' }
/** What a folded group's count says: "2 waiting", "3 unread". */
export const needingLabel = (count: number, status: ChatStatus) => `${count} ${NEEDING[status]}`

/** A group's row: its chevron and name; collapsed, how many spaces it holds and a dot when one is busy or unread. */
function GroupRow(props: GroupRowProps) {
  const { group, animate, collapsed, count, status, unread, toggle, menu, renaming, dragging, into, drop, drag, peek } =
    props
  // Collapsed, a busy space inside shows its status here; unread with nothing busy shows a plain dot.
  const dot = collapsed && status !== 'idle' ? DOTS[status] : collapsed && unread ? 'bg-text' : undefined
  const [peeking, setPeeking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // The whole row (⋯ included) is what's hovered, so the pointer can cross the ⋯ on its way to the popup; the popup
  // opens just past the sidebar's edge rather than over it.
  const [gap, setGap] = useState(6)
  const button = useRef<HTMLButtonElement>(null)
  const measure = () => {
    const row = button.current?.parentElement
    const edge = row?.closest('nav')?.getBoundingClientRect().right
    if (row && edge !== undefined) setGap(Math.max(6, Math.round(edge - row.getBoundingClientRect().right) + 6))
  }
  // Only a folded group pops out (unfolded, its spaces are already in the sidebar), and never mid-drag, with its ⋯
  // menu open or while it's being renamed.
  const canPeek = !!peek && collapsed && !peek.blocked && !menuOpen && !renaming
  // Shut when something blocks it, so it doesn't pop back once the drag or menu is over.
  if (peeking && !canPeek) setPeeking(false)
  if (renaming) {
    return <GroupNameInput label="Group name" initial={group.name} done={props.rename} cancel={props.cancelRename} />
  }
  return (
    <HoverCard.Root
      open={peeking && canPeek}
      onOpenChange={(open) => {
        if (open) measure()
        setPeeking(open && canPeek)
      }}
      openDelay={PEEK_OPEN_MS}
      closeDelay={PEEK_CLOSE_MS}
    >
      <HoverCard.Trigger asChild>
        <m.div
          className={`group/row relative flex min-w-0 shrink-0 items-center rounded text-muted transition-colors hover:text-text ${ROW_HOVER} ${dragging ? 'opacity-50' : ''} ${into ? 'bg-accent/15 text-text ring-1 ring-accent' : ''}`}
          {...MOTION.collapse}
          initial={animate && MOTION.collapse.initial}
        >
          <button
            ref={button}
            className="group flex h-control min-w-0 flex-1 items-center gap-8 pr-8 pl-6 text-left whitespace-nowrap"
            aria-expanded={!collapsed}
            data-open={collapsed ? undefined : ''}
            data-group-id={group.id}
            title={group.name}
            onClick={toggle}
            draggable={drag ? true : undefined}
            onDragStart={drag?.start}
            onDragOver={drag?.over}
            onDrop={drag?.land}
            onDragEnd={drag?.end}
            onKeyDown={drag?.key}
          >
            <Chevron />
            <span className={`min-w-0 flex-1 truncate ${unread && collapsed ? 'font-semibold text-text' : ''}`}>
              {group.name}
            </span>
            {collapsed && (
              <span className="shrink-0 text-xs text-faint tabular-nums" data-count>
                {count}
              </span>
            )}
            {dot && (
              <span
                className="flex shrink-0 items-center gap-3"
                {...(props.needing > 1 && { role: 'img', 'aria-label': needingLabel(props.needing, status), title: needingLabel(props.needing, status) })}
              >
                {props.needing > 1 && (
                  <span className={`text-xs font-medium tabular-nums ${NEEDING_TEXT[status]}`} aria-hidden data-group-needing>
                    {props.needing}
                  </span>
                )}
                <span className={`size-7 shrink-0 rounded-full ${dot}`} data-status={status} data-group-dot />
              </span>
            )}
          </button>
          <RowMenu
            label={group.name}
            items={menu}
            onOpenChange={(open) => {
              setMenuOpen(open)
              if (open) setPeeking(false)
            }}
          />
          {drop && (
            <span
              aria-hidden
              data-drop={drop}
              className={`pointer-events-none absolute inset-x-4 h-2 rounded-full bg-accent ${drop === 'before' ? '-top-2' : '-bottom-2'}`}
            />
          )}
        </m.div>
      </HoverCard.Trigger>
      {peek && (
        <HoverCard.Portal>
          <HoverCard.Content asChild side="right" align="start" sideOffset={gap} collisionPadding={8} alignOffset={-4}>
            <m.div
              role="group"
              aria-label={`${group.name}: its ${CHAT_NOUN.many}`}
              data-group-peek={group.id}
              className={`${MENU_PANEL} max-h-[min(60vh,var(--radix-hover-card-content-available-height))] w-max max-w-[min(280px,calc(100vw-16px))] gap-1 overflow-y-auto`}
              initial={MOTION.menu.initial}
              animate={MOTION.menu.animate}
              transition={MOTION.menu.transition}
            >
              {peek.spaces.length === 0 ? (
                <p className="px-8 py-4 text-sm text-faint">No {CHAT_NOUN.many}.</p>
              ) : (
                peek.spaces.map((space) => (
                  <ChatRow
                    key={space.chat.id}
                    row={{ chat: space.chat, depth: 0 }}
                    animate={false}
                    title={space.title}
                    selected={space.selected}
                    status={space.status}
                    unread={space.unread}
                    showEngine={peek.showEngine}
                    narrowable={false}
                    select={() => {
                      setPeeking(false)
                      peek.select(space.chat.id)
                    }}
                  />
                ))
              )}
            </m.div>
          </HoverCard.Content>
        </HoverCard.Portal>
      )}
    </HoverCard.Root>
  )
}

/** Names a group in place: Enter or leaving the box saves, Escape (or an empty name) cancels. */
function GroupNameInput({
  label,
  initial,
  done,
  cancel,
}: {
  label: string
  initial: string
  done: (name: string) => void
  cancel: () => void
}) {
  const finished = useRef(false)
  const finish = (value: string | null) => {
    if (finished.current) return
    finished.current = true
    if (value?.trim() && value.trim() !== initial) done(value.trim())
    else cancel()
  }
  return (
    <div className="flex h-control shrink-0 items-center gap-8 pr-8 pl-6">
      <Chevron />
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to name it
        autoFocus
        aria-label={label}
        defaultValue={initial}
        maxLength={80}
        className="h-24 min-w-0 flex-1 px-6"
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value)
          else if (e.key === 'Escape') {
            e.stopPropagation()
            finish(null)
          }
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </div>
  )
}

function FolderPlusIcon() {
  return (
    <svg className="size-14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1ZM8 7.5v3.5M6.25 9.25h3.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

type NameDialogProps = {
  request: NameRequest | null
  connected: boolean
  send: (m: ClientMessage) => void
  close: () => void
}

export function NameDialog({ request, connected, send, close }: NameDialogProps) {
  const [shown, setShown] = useState<NameRequest | null>(null)
  const [name, setName] = useState('')
  if (request && request !== shown) {
    setShown(request)
    setName(request.kind === 'rename' ? request.name : '')
  }
  const focus = useReturnFocus()
  const isNew = shown?.kind === 'new'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!request || !connected || !name.trim()) return
    if (request.kind === 'rename') send({ type: 'chat.rename', chatId: request.chatId, name })
    else send({ type: 'chat.create', name })
    close()
  }
  return (
    <Dialog.Root open={!!request} onOpenChange={(open) => open || close()}>
      <AnimatePresence>
        {request && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <m.div className="fixed inset-0 bg-backdrop" {...MOTION.fade} />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={focus.remember}
              onCloseAutoFocus={focus.restore}
            >
              <m.form
                className="fixed inset-0 m-auto flex h-fit max-h-[calc(100vh-32px)] w-[min(420px,calc(100vw-32px))] flex-col gap-12 scroll-inset overflow-y-auto rounded-xl border bg-panel pt-14 pr-2 pb-16 pl-16 text-text shadow-overlay"
                {...MOTION.pop}
                onSubmit={submit}
              >
                <Dialog.Title className="text-[16px] font-semibold">
                  {isNew ? `New ${CHAT_NOUN.one}` : `Rename ${CHAT_NOUN.one}`}
                </Dialog.Title>
                <label className="flex flex-col gap-4">
                  <span className="text-muted">Name</span>
                  <input
                    value={name}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="flex justify-end gap-8">
                  <Dialog.Close asChild>
                    <Button type="button">Cancel</Button>
                  </Dialog.Close>
                  <Button variant="primary" disabled={!connected || !name.trim()}>
                    {isNew ? 'Create' : 'Rename'}
                  </Button>
                </div>
              </m.form>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

// As tall as a chat row, its label under the chat names: an empty slot where a row's dot sits (pl-7 plus the
// button's 1px border makes the rows' pl-8), like the New space row.
const LAUNCHER_ROW = 'flex h-control w-full shrink-0 items-center gap-8 pr-8 pl-7 text-left text-muted hover:text-text'
const FOOTER_ROW = 'flex h-control w-full min-w-0 items-center gap-8 px-8 text-left'

/** A launcher an extension panel asks for (ExtensionPanel.launcher): a row in the left sidebar that opens the panel. */
export type Launcher = { key: string; label: string; keys?: Binding | null; open: () => void }

/** Launcher rows, each with its shortcut on hover; at the top, lined up with the chat rows around them. */
function LauncherRows({ launchers, top = false }: { launchers: Launcher[]; top?: boolean }) {
  return launchers.map((launcher) => {
    const row = (
      <Button variant="ghost" size="none" className={top ? LAUNCHER_ROW : FOOTER_ROW} onClick={launcher.open}>
        {/* An empty slot where a row's dot sits, so every label in the sidebar starts on one line. */}
        <span aria-hidden="true" className="w-7 shrink-0" />
        <span className="min-w-0 truncate">{launcher.label}</span>
      </Button>
    )
    return launcher.keys ? (
      <Hint key={launcher.key} text={<Keys binding={launcher.keys} />} side="right">
        {row}
      </Hint>
    ) : (
      <div key={launcher.key} className="contents">
        {row}
      </div>
    )
  })
}

type FooterProps = { settingsKeys?: Binding | null; openSettings: () => void; launchers?: Launcher[] }

/** The sidebar's bottom: Settings with its shortcut on hover, and launchers above it when the user puts them there. */
export function SidebarFooter({ settingsKeys, openSettings, launchers = [] }: FooterProps) {
  return (
    <div className="flex flex-col gap-1 px-8 pb-10">
      <LauncherRows launchers={launchers} />
      <Hint text={settingsKeys && <Keys binding={settingsKeys} />} side="right">
        <Button variant="ghost" size="none" className={FOOTER_ROW} onClick={openSettings}>
          <span aria-hidden="true" className="flex w-7 shrink-0 justify-center">
            ⚙
          </span>
          Settings
        </Button>
      </Hint>
    </div>
  )
}
