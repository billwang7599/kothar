import type { SpaceGroup } from '@kothar/core/shared'
import { chatTree, groupOf, type ChatView } from './state.ts'

/** The sidebar's groups and which of them are collapsed: spaces in a collapsed group aren't stepped through. */
export type NavGroups = { groups: readonly SpaceGroup[]; collapsed: ReadonlySet<string> }
const NO_GROUPS: NavGroups = { groups: [], collapsed: new Set() }

/**
 * Home (when its extension is on) and the spaces, top to bottom as the sidebar lists them; no workers or archived
 * ones, and none hidden in a collapsed group except `keep` (the open one, which the sidebar still shows).
 */
export const spaceOrder = (chats: ChatView[], nav: NavGroups = NO_GROUPS, keep?: string): ChatView[] =>
  chatTree(chats, nav.groups)
    .active.filter((r) => r.depth === 0)
    .map((r) => r.chat)
    .filter((c) => {
      const group = c.pinned ? undefined : groupOf(c, nav.groups)
      return c.id === keep || !group || !nav.collapsed.has(group.id)
    })

function rootOf(chats: ChatView[], chat: ChatView): ChatView {
  const parent = chats.find((c) => c.id === chat.parentId)
  return parent ? rootOf(chats, parent) : chat
}

/**
 * The entry one step up or down from the open chat, or undefined at either end. From a worker, up goes to its own
 * space and down to the space after it. From nothing or an archived chat, down starts at the top and up at the bottom.
 */
export function stepSpace(
  chats: ChatView[],
  selectedId: string,
  by: -1 | 1,
  nav: NavGroups = NO_GROUPS,
): string | undefined {
  const selected = chats.find((c) => c.id === selectedId)
  const root = selected && rootOf(chats, selected)
  const order = spaceOrder(chats, nav, root?.id)
  const at = root ? order.findIndex((c) => c.id === root.id) : -1
  if (at < 0) return (by > 0 ? order[0] : order.at(-1))?.id
  if (by < 0 && root!.id !== selectedId) return root!.id
  return order[at + by]?.id
}

/** The nth entry (from 1), as Cmd+1…9 jump to it. */
export const nthSpace = (chats: ChatView[], n: number, nav: NavGroups = NO_GROUPS): string | undefined =>
  spaceOrder(chats, nav)[n - 1]?.id
