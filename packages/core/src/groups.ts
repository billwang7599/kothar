import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { Chat } from './chat.ts'
import { bySpaceOrder, MAX_GROUP_NAME, type ChatInfo, type CoreMessage, type SpaceGroup } from './shared.ts'

// Space groups: named folders the user sorts spaces into in the sidebar. Purely visual: a group changes no space's
// context, folders, instructions, memory or work folder. The groups and their order are `<garage>/groups.json`
// ({ "groups": [{ "id", "name" }] }, top to bottom); which group a space is in is its own `group` in chat.json, so a
// space keeps its group while pinned or archived and goes back into it after.

export const GROUPS_FILE = 'groups.json'

const isGroup = (value: unknown): value is SpaceGroup =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SpaceGroup).id === 'string' &&
  /^[a-z0-9]{1,32}$/.test((value as SpaceGroup).id) &&
  typeof (value as SpaceGroup).name === 'string' &&
  (value as SpaceGroup).name.trim() !== ''

/** The groups in a groups.json, in order. A missing or broken file has none; bad or repeated entries are skipped. */
export function parseGroups(text: string | undefined): SpaceGroup[] {
  if (!text) return []
  try {
    const parsed: unknown = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : (parsed as { groups?: unknown })?.groups
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    return list.filter(isGroup).flatMap((g) => {
      if (seen.has(g.id)) return []
      seen.add(g.id)
      return [{ id: g.id, name: g.name.trim().slice(0, MAX_GROUP_NAME) }]
    })
  } catch {
    return []
  }
}

export function groupName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim() : ''
  if (!text) throw new Error('A group needs a name')
  if (text.length > MAX_GROUP_NAME) throw new Error(`Group names are at most ${MAX_GROUP_NAME} characters`)
  return text
}

export function openGroups({ garage, broadcast }: { garage: string; broadcast: (message: CoreMessage) => void }) {
  const file = join(garage, GROUPS_FILE)
  let groups = parseGroups(existsSync(file) ? readFileSync(file, 'utf8') : undefined)

  const save = (next: SpaceGroup[]) => {
    groups = next
    const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(temp, JSON.stringify({ groups }, null, 2) + '\n')
    renameSync(temp, file)
    broadcast({ type: 'groups.updated', groups })
  }
  const find = (id: unknown) => {
    const group = groups.find((g) => g.id === id)
    if (!group) throw new Error('No such group')
    return group
  }

  return {
    list: (): SpaceGroup[] => groups,
    has: (id: string | undefined) => id !== undefined && groups.some((g) => g.id === id),

    /** Adds a group at the bottom of the groups and returns it. */
    create(name: unknown): SpaceGroup {
      const group = { id: newId(groups.map((g) => g.id)), name: groupName(name) }
      save([...groups, group])
      return group
    },

    rename(id: unknown, name: unknown) {
      const group = find(id)
      const text = groupName(name)
      if (text !== group.name) save(groups.map((g) => (g.id === group.id ? { ...g, name: text } : g)))
    },

    /** Moves a group to `index` among the groups. */
    move(id: unknown, index: unknown) {
      const group = find(id)
      if (typeof index !== 'number' || !Number.isInteger(index)) throw new Error('The place to move to must be a number')
      const rest = groups.filter((g) => g.id !== group.id)
      rest.splice(Math.max(0, Math.min(index, rest.length)), 0, group)
      if (rest.some((g, i) => g.id !== groups[i]!.id)) save(rest)
    },

    /** Removes a group; the caller takes its spaces out of it. */
    remove(id: unknown): SpaceGroup {
      const group = find(id)
      save(groups.filter((g) => g.id !== group.id))
      return group
    },
  }
}

export type Groups = ReturnType<typeof openGroups>

function newId(taken: string[]): string {
  for (;;) {
    const id = randomBytes(4).toString('hex')
    if (!taken.includes(id)) return id
  }
}

type GroupActionDeps = {
  groups: Groups
  chats: Map<string, Chat>
  chatFor: (chatId: string) => Chat
  updateChat: (chat: Chat, change: Partial<ChatInfo>) => void
  moveChat: (chat: Chat, pinned: boolean, index: unknown, group?: unknown) => void
}

const isMovable = (info: ChatInfo) => !info.extension && !info.parentId && !info.archived

/** What the sidebar asks of groups, with the spaces they hold. */
export function openGroupActions({ groups, chats, chatFor, updateChat, moveChat }: GroupActionDeps) {
  return {
    /** A new group at the bottom; with chatId, that space goes in (at the end of it; a pinned one stays in Pinned). */
    create(name: unknown, chatId?: unknown) {
      const chat = chatId === undefined ? undefined : chatFor(String(chatId))
      if (chat && !isMovable(chat.info)) throw new Error('Only active spaces can go in a group')
      const group = groups.create(name)
      if (chat?.info.pinned) updateChat(chat, { group: group.id })
      else if (chat) moveChat(chat, false, Number.MAX_SAFE_INTEGER, group.id)
      return group
    },

    /** Removes a group. Its spaces stay, below the ungrouped ones in the order they had in the group. */
    remove(id: unknown) {
      const group = groups.remove(id)
      const spaces = [...chats.values()].filter((c) => c.info.group === group.id)
      const placed = [...chats.values()]
        .map((c) => c.info)
        .filter((c) => isMovable(c) && !c.pinned && !groups.has(c.group) && c.group !== group.id)
      let next = Math.max(-1, ...placed.map((c) => c.order ?? -1)) + 1
      for (const chat of spaces.sort((a, b) => bySpaceOrder(a.info, b.info))) {
        const loose = chat.info.pinned || chat.info.archived || chat.info.order === undefined
        updateChat(chat, loose ? { group: undefined } : { group: undefined, order: next++ })
      }
    },
  }
}

export type GroupActions = ReturnType<typeof openGroupActions>
