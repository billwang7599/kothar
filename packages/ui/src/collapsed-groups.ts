import { useSyncExternalStore } from 'react'

/**
 * Sidebar groups of spaces the user collapsed, by group id. Expanded by default; kept in localStorage like the other
 * sidebar preferences (folded workers, widths), since it's about this window's view, not the spaces themselves.
 */
const KEY = 'kothar.collapsedGroups'
const listeners = new Set<() => void>()

function read(): ReadonlySet<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

let current = read()

export function collapseGroup(groupId: string, collapsed: boolean) {
  if (current.has(groupId) === collapsed) return
  const next = new Set(current)
  if (collapsed) next.add(groupId)
  else next.delete(groupId)
  current = next
  localStorage.setItem(KEY, JSON.stringify([...next]))
  for (const listener of listeners) listener()
}

/** The collapsed groups now, outside React (keyboard navigation). */
export const collapsedGroups = (): ReadonlySet<string> => current

/** Rereads the saved choice, for tests that clear storage. */
export function reloadCollapsed() {
  current = read()
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => current

export function useCollapsedGroups(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
