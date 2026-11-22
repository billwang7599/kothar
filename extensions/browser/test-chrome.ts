// Test helpers for the Kothar Chrome extension (chrome-extension/agent.js): a fake Chrome for it to run on, and the
// WebSocket it opens with its own Origin.
import { WebSocket } from 'ws'

// A fake Chrome: windows, tabs and tab groups in memory, and a debugger that answers a few calls and records the rest.
export function fakeChrome() {
  type Tab = { id: number; url: string; title: string; groupId: number; windowId: number; active: boolean; openerTabId?: number }
  const tabs = new Map<number, Tab>()
  const groups = new Map<number, { id: number; windowId: number; title?: string; color?: string; collapsed?: boolean }>()
  const attached = new Set<number>()
  const sent: { tabId: number; sessionId?: string; method: string }[] = []
  const focused: number[] = []
  // The user's windows, the last one used first. Window 1 is a normal one, as when Chrome is open.
  const windows: { id: number; type: string; incognito: boolean }[] = [{ id: 1, type: 'normal', incognito: false }]
  const created: { focused?: boolean }[] = []
  const store: Record<string, Record<string, unknown>> = { session: {}, local: {} }
  let next = 100
  let window = 1
  const area = (name: string) => ({
    get: async (key: string) => (key in store[name]! ? { [key]: store[name]![key] } : {}),
    set: async (values: Record<string, unknown>) => void Object.assign(store[name]!, values),
    remove: async (key: string) => void delete store[name]![key],
  })
  const addTab = (fields: Partial<Tab> = {}) => {
    const tab: Tab = { id: next++, url: 'about:blank', title: '', groupId: -1, windowId: 1, active: false, ...fields }
    tabs.set(tab.id, tab)
    return tab
  }
  const chrome = {
    storage: { session: area('session'), local: area('local') },
    tabs: {
      get: async (id: number) => {
        const tab = tabs.get(id)
        if (!tab) throw new Error('No tab with id')
        return { ...tab }
      },
      query: async (q: { groupId?: number; windowId?: number }) =>
        [...tabs.values()].filter((t) => (q.groupId === undefined || t.groupId === q.groupId) && (q.windowId === undefined || t.windowId === q.windowId)),
      create: async (p: { windowId: number; url: string; active: boolean }) => addTab({ windowId: p.windowId, url: p.url, active: p.active }),
      group: async (p: { groupId?: number; tabIds: number[]; createProperties?: { windowId: number } }) => {
        let id = p.groupId
        if (id === undefined) {
          id = next++
          groups.set(id, { id, windowId: p.createProperties!.windowId })
        }
        for (const tabId of p.tabIds) tabs.get(tabId)!.groupId = id
        return id
      },
      remove: async (id: number) => void tabs.delete(id),
      update: async (id: number, p: { active?: boolean }) => Object.assign(tabs.get(id)!, p),
    },
    tabGroups: {
      get: async (id: number) => {
        const group = groups.get(id)
        if (!group) throw new Error('No group')
        return { ...group }
      },
      update: async (id: number, p: object) => Object.assign(groups.get(id)!, p),
    },
    windows: {
      create: async (p: { url: string; focused?: boolean }) => {
        const id = ++window
        created.push({ focused: p.focused })
        windows.push({ id, type: 'normal', incognito: false })
        return { id, tabs: [addTab({ windowId: id, url: p.url, active: true })] }
      },
      getLastFocused: async () => {
        if (!windows[0]) throw new Error('No last-focused window')
        return { ...windows[0] }
      },
      getAll: async () => windows.map((w) => ({ ...w })),
      update: async (id: number) => void focused.push(id),
    },
    debugger: {
      attach: async ({ tabId }: { tabId: number }) => void attached.add(tabId),
      detach: async ({ tabId }: { tabId: number }) => void attached.delete(tabId),
      sendCommand: async ({ tabId, sessionId }: { tabId: number; sessionId?: string }, method: string) => {
        sent.push({ tabId, ...(sessionId && { sessionId }), method })
        const tab = tabs.get(tabId)!
        if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: `T${tabId}`, type: 'page', url: tab.url, title: tab.title } }
        if (method === 'Runtime.evaluate') return { result: { value: tab.url } }
        return {}
      },
    },
  }
  return { chrome, tabs, groups, attached, sent, focused, addTab, windows, created }
}

// The extension's own WebSocket, which Chrome opens with the extension's Origin.
export const socketWith = (origin: string) =>
  class extends WebSocket {
    constructor(url: string) {
      super(url, { origin })
      // A browser's WebSocket reports a refused connection by closing; ws would also throw it.
      this.on('error', () => {})
    }
  }

