// The chats the user had open, newest first, for Ctrl+Tab (Last chat): it goes back to the one before, and a second
// press flips back, since going back makes that one the newest.
import type { ChatView } from './state.ts'

/** How many chats are remembered; going back never needs more than a few. */
const KEEP = 20

/** The list with this chat moved to the front. */
export function visit(recent: readonly string[], chatId: string): string[] {
  if (!chatId || recent[0] === chatId) return recent as string[]
  return [chatId, ...recent.filter((id) => id !== chatId)].slice(0, KEEP)
}

/** Whether a chat can still be opened from the sidebar: it exists, and neither it nor its space is archived. */
function openable(chats: readonly ChatView[], id: string): boolean {
  const seen = new Set<string>()
  for (let at: string | undefined = id; at && !seen.has(at); ) {
    seen.add(at)
    const chat = chats.find((c) => c.id === at)
    if (!chat || chat.archived) return false
    at = chat.parentId
    if (!at) return true
  }
  return false
}

/** The chat to go back to from the open one: the newest other one still there and not archived. */
export function lastChat(recent: readonly string[], chats: readonly ChatView[], selectedId: string): string | undefined {
  return recent.find((id) => id !== selectedId && openable(chats, id))
}
