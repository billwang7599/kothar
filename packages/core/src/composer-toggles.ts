// Extensions' modes in a chat's composer (Extension.composerToggles): what the UI gets of one, and each chat's state,
// kept in its chat.json by extension id, then toggle id.
// A mode is one-shot and one at a time: picking one turns any other off (across extensions), and the user's next
// message takes it: the composer goes back to no mode, and the mode stays on (host.toggled) for the turn that message
// starts or is steered into, then ends with it (Chat.modes). Modes are told apart by extension id and toggle id
// together, so two extensions may use the same toggle id.
import type { Extension, ExtensionComposerToggle } from '@kothar/extension-api'
import type { ChatInfo, ComposerToggleInfo } from './shared.ts'

const ICONS: readonly NonNullable<ExtensionComposerToggle['icon']>[] = ['search', 'globe', 'book', 'sparkle', 'bolt']

/** The extension's toggle by id, or a throw. */
export function toggleOf(extension: Extension, id: unknown): ExtensionComposerToggle {
  const toggle = extension.composerToggles?.find((t) => t.id === id)
  if (!toggle) throw new Error(`${extension.name} has no composer toggle "${id}"`)
  return toggle
}

/** Whether the toggle is on in the chat: as the chat saved it, else its default. */
export function isToggled(info: Pick<ChatInfo, 'toggles'>, extension: Extension, toggle: ExtensionComposerToggle): boolean {
  const saved = info.toggles?.[extension.id]?.[toggle.id]
  return typeof saved === 'boolean' ? saved : toggle.default === true
}

/** A mode's key, unique across extensions. */
export const modeKey = (extension: string, toggle: string) => `${extension}\n${toggle}`

/** Whether the toggle is on for the extension's hooks: picked for the next message, or sent with the running turn. */
export function isLive(chat: { info: Pick<ChatInfo, 'toggles'>; modes?: ReadonlySet<string> }, extension: Extension, toggle: ExtensionComposerToggle) {
  return isToggled(chat.info, extension, toggle) || chat.modes?.has(modeKey(extension.id, toggle.id)) === true
}

/** The modes picked in the chat for its next message, from these extensions. */
export function pickedModes(info: Pick<ChatInfo, 'toggles'>, extensions: readonly Extension[]) {
  return extensions.flatMap((extension) =>
    (extension.composerToggles ?? []).filter((toggle) => isToggled(info, extension, toggle)).map((toggle) => ({ extension, toggle })),
  )
}

/**
 * The chat's toggles with this one set, and, when it's turned on, every other mode picked (of any of `extensions`)
 * turned off, as only one is on at a time. others: the modes it turned off.
 */
export function withOnly(
  info: Pick<ChatInfo, 'toggles'>,
  extensions: readonly Extension[],
  extension: Extension,
  toggle: ExtensionComposerToggle,
  on: boolean,
) {
  const others = on ? pickedModes(info, extensions).filter((m) => m.extension.id !== extension.id || m.toggle.id !== toggle.id) : []
  let toggles = info.toggles
  for (const other of others) toggles = withToggle({ toggles }, other.extension, other.toggle, false)
  return { toggles: withToggle({ toggles }, extension, toggle, on), others }
}

/** The chat's toggles with this one set. */
export function withToggle(info: Pick<ChatInfo, 'toggles'>, extension: Extension, toggle: ExtensionComposerToggle, on: boolean) {
  return { ...info.toggles, [extension.id]: { ...info.toggles?.[extension.id], [toggle.id]: on } }
}

/** What the UI gets of one toggle: its labels and icon checked, and whether it's on in the chat. */
export function toggleInfo(extension: string, toggle: ExtensionComposerToggle, on: boolean): ComposerToggleInfo {
  const { id, label, icon, hint, activeHint } = toggle
  if (typeof id !== 'string' || !id || typeof label !== 'string' || !label) throw new Error('A composer toggle needs an id and a label')
  if (icon !== undefined && !ICONS.includes(icon)) throw new Error(`A composer toggle's icon is one of ${ICONS.join(', ')}`)
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    extension,
    id,
    label,
    on,
    ...(icon && { icon }),
    ...(text(hint) && { hint: text(hint) }),
    ...(text(activeHint) && { activeHint: text(activeHint) }),
  }
}
