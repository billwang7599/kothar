// Settings search: every setting with the page it's on and the anchor its row carries, matched against what's typed,
// and revealSetting, which shows one (opening its page's Advanced if it's in there) and flashes it.
import { CONTEXT_SECTIONS, PERMISSION_SWITCHES, type ExtensionInfo, type PromptInfo, type ToolGroup } from '@kothar/core/shared'
import { MORE_SWITCHES, PERMISSIONS, SECTIONS } from '../context-panel.tsx'
import { SSH_HOSTS_ABOUT } from '../ssh-hosts.tsx'
import { shortcutActions } from '../shortcuts.ts'
import { engineName, modelRolesOf } from '../state.ts'
import type { PageProps } from './types.ts'

export type SettingEntry = {
  /** The id of the element it jumps to. */
  anchor: string
  /** The Settings page it's on. */
  page: string
  label: string
  /** The section it's in, shown with the page in the results. */
  section?: string
  /** More words it's found by: its explanation, old names. */
  text?: string
  advanced?: boolean
}

export const ANCHORS = {
  workFolder: 'setting-work-folder',
  editor: 'setting-open-files-with',
  terminal: 'setting-terminal',
  attachments: 'setting-largest-attachment',
  notifications: 'section-notifications',
  updates: 'section-updates',
  getStarted: 'setting-get-started',
  engines: 'section-engines',
  accounts: 'section-accounts',
  models: 'section-models',
  engineTools: 'section-engine-tools',
  workers: 'section-workers',
  setups: 'section-setups',
  context: 'section-context',
  prompts: 'section-prompts',
  permissions: 'section-permissions',
  sshHosts: 'setting-ssh-hosts',
  theme: 'section-theme',
  display: 'section-display',
  shortcuts: 'section-shortcuts',
  paths: 'section-file-paths',
} as const

export const settingAnchor = (...parts: string[]) => `setting-${parts.join('-').replace(/[^a-z0-9-]/gi, '-')}`

/** The groups Engine tools sorts each engine's tools into, by name; search finds a tool by its group's name too. */
export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  core: 'Core',
  replaced: 'Replaced by Kothar',
  outside: 'Outside Kothar',
}

/** The anchor of one engine tool's row in Engine tools. */
export const engineToolAnchor = (engine: string, tool: string) => settingAnchor('engine-tool', engine, tool)

// The settings every Kothar has, page by page. A function, as the modules it reads may still be loading when this one is.
const fixedEntries = (): SettingEntry[] => [
  // General
  { page: 'general', anchor: ANCHORS.workFolder, section: 'Work folder', label: 'Work folder', text: 'where agents and workers work folder path' },
  { page: 'general', anchor: ANCHORS.editor, section: 'Work folder', label: 'Open files with', text: 'editor file links click vscode cursor command' },
  { page: 'general', anchor: ANCHORS.terminal, section: 'Work folder', label: 'Terminal', text: 'Open in Terminal iterm ghostty warp' },
  { page: 'general', anchor: settingAnchor('update-automatically'), section: 'Updates', label: 'Update automatically', text: 'auto update new version check for updates download restart' },
  { page: 'general', anchor: settingAnchor('notifications'), section: 'Notifications', label: 'Show notifications', text: 'notify alerts' },
  { page: 'general', anchor: settingAnchor('notify', 'needsYou'), section: 'Notifications', label: 'Needs you', text: 'notify permission request question waiting' },
  { page: 'general', anchor: settingAnchor('notify', 'finished'), section: 'Notifications', label: 'Finished', text: 'notify done turn' },
  { page: 'general', anchor: settingAnchor('notify', 'errors'), section: 'Notifications', label: 'Errors', text: 'notify failed' },
  { page: 'general', anchor: ANCHORS.attachments, section: 'Work folder', label: 'Largest attachment', text: 'file size limit upload MB', advanced: true },
  // Engines
  { page: 'engines', anchor: ANCHORS.getStarted, label: 'Get started', text: 'install sign in first space onboarding' },
  { page: 'engines', anchor: ANCHORS.engines, section: 'Engines', label: 'Engines', text: 'turn on harness claude code pi codex opencode' },
  { page: 'engines', anchor: 'add-acp-agent', section: 'Engines', label: 'Add ACP agent', text: 'agent client protocol gemini custom engine' },
  { page: 'engines', anchor: ANCHORS.accounts, section: 'Accounts', label: 'Accounts', text: 'sign in log in api key active account login' },
  { page: 'engines', anchor: ANCHORS.models, section: 'Models', label: 'Models', text: 'model list thinking level order' },
  { page: 'engines', anchor: ANCHORS.engineTools, section: 'Engine tools', label: 'Engine tools', text: 'built-in tools bash edit read off', advanced: true },
  // Agents
  { page: 'agents', anchor: settingAnchor('workers', 'start'), section: 'Workers', label: 'Let agents start workers', text: 'spawn_worker subagents' },
  { page: 'agents', anchor: settingAnchor('workers', 'worktree'), section: 'Workers', label: 'Own worktree per worker', text: 'branch checkout git' },
  { page: 'agents', anchor: settingAnchor('workers', 'limit'), section: 'Workers', label: 'Max running per chat', text: 'workers limit parallel at once' },
  { page: 'agents', anchor: ANCHORS.setups, section: 'Setups', label: 'Setups', text: 'saved model thinking extensions instructions profile tune' },
  { page: 'agents', anchor: ANCHORS.context, section: 'Context', label: 'Context from above', text: 'context defaults inherited', advanced: true },
  ...CONTEXT_SECTIONS.map((section) => ({
    page: 'agents',
    anchor: settingAnchor('context', section),
    section: 'Context',
    label: `${SECTIONS[section].label} from above`,
    text: SECTIONS[section].inherited,
    advanced: true,
  })),
  { page: 'agents', anchor: ANCHORS.prompts, section: 'Prompts', label: 'Prompts', text: 'Kothar’s own prompts instructions system prompt', advanced: true },
  { page: 'agents', anchor: 'prompt-workers-instructions', section: 'Prompts', label: 'When to start workers', text: 'workers prompt instructions', advanced: true },
  // Permissions
  ...PERMISSION_SWITCHES.map((name) => ({
    page: 'permissions',
    anchor: settingAnchor('permission', name),
    label: PERMISSIONS[name].label,
    text: `${PERMISSIONS[name].about} sandbox ask approve`,
    advanced: MORE_SWITCHES.includes(name),
  })),
  { page: 'permissions', anchor: ANCHORS.sshHosts, label: 'Allowed SSH hosts', text: SSH_HOSTS_ABOUT, advanced: true },
  // Appearance
  { page: 'appearance', anchor: ANCHORS.theme, label: 'Theme', text: 'base color scheme dark light system glass themes' },
  { page: 'appearance', anchor: settingAnchor('launchers'), section: 'Display', label: 'Extension launchers', text: 'sidebar buttons notes artifacts top bottom hidden' },
  { page: 'appearance', anchor: settingAnchor('steps'), section: 'Display', label: 'Thinking and tool calls unfolded', text: 'steps fold' },
  { page: 'appearance', anchor: settingAnchor('reports'), section: 'Display', label: 'Worker reports unfolded', text: 'fold report' },
  { page: 'appearance', anchor: ANCHORS.shortcuts, section: 'Shortcuts', label: 'Shortcuts', text: 'keyboard keys bindings hotkeys', advanced: true },
  { page: 'appearance', anchor: settingAnchor('paths', 'header'), section: 'File paths', label: 'Paths at the top of a space', text: 'file paths header', advanced: true },
  { page: 'appearance', anchor: settingAnchor('paths', 'context'), section: 'File paths', label: 'Paths in the Context panel', text: 'file paths', advanced: true },
  // Extensions
  { page: 'extensions', anchor: 'section-built-in-extensions', label: 'Built-in extensions', text: 'turn on off extension mods' },
  { page: 'community-extensions', anchor: 'section-community-hub', label: 'Community hub', text: 'community extensions marketplace install from folder' },
  { page: 'community-extensions', anchor: 'section-marketplace', label: 'Marketplace', text: 'turn on off enable marketplace browse themes' },
]

const promptEntry = (page: string, anchor: string, prompt: PromptInfo, section = 'Prompts'): SettingEntry => ({
  page,
  anchor,
  section,
  label: prompt.label,
  text: `prompt ${prompt.description ?? ''}`,
  advanced: true,
})

type IndexProps = Pick<PageProps, 'engines' | 'extensions' | 'corePrompts' | 'communityExtensions' | 'engineTools'> & {
  workFolder?: Pick<PageProps['workFolder'], 'terminals'>
}

/** Every setting there is right now: the fixed ones, then those of the engines, models, prompts and extensions there are. */
export function settingsIndex({ engines, extensions, corePrompts = [], communityExtensions = false, workFolder, engineTools }: IndexProps): SettingEntry[] {
  // Terminal shows only where there's one to pick (macOS).
  const entries = fixedEntries().filter(
    (e) =>
      (e.anchor !== ANCHORS.terminal || !!workFolder?.terminals) &&
      // Updates show only in the packaged desktop app.
      (e.anchor !== settingAnchor('update-automatically') || !!window.kothar?.updates),
  )
  for (const engine of engines) {
    entries.push({ page: 'engines', anchor: settingAnchor('engine', engine.id), section: 'Engines', label: engineName(engine) || engine.id, text: engine.id })
    entries.push({ page: 'engines', anchor: `accounts-${engine.id}`, section: 'Accounts', label: `${engineName(engine) || engine.id} accounts`, text: 'sign in api key' })
  }
  // Each tool of an engine that's on, as Engine tools lists them: search opens its engine and group to it.
  const on = new Set(engines.filter((e) => e.enabled).map((e) => e.id))
  for (const engine of engineTools?.engines ?? []) {
    if (!on.has(engine.engine)) continue
    for (const tool of engine.tools) {
      entries.push({ page: 'engines', anchor: engineToolAnchor(engine.engine, tool.name), section: `${engine.name} tools`, label: tool.name, text: `engine tool ${tool.capability ?? ''} ${TOOL_GROUP_LABELS[tool.group]}`, advanced: true })
    }
  }
  for (const role of modelRolesOf(extensions)) {
    entries.push({ page: 'engines', anchor: settingAnchor('models', role.id), section: 'Models', label: `${role.label} models`, text: role.description })
  }
  for (const prompt of corePrompts) entries.push(promptEntry('agents', `prompt-kothar-${prompt.id}`, prompt))
  // As the Shortcuts list shows them: the desktop app's own only in the desktop app.
  for (const action of shortcutActions().filter((a) => !a.desktopOnly || !!window.kothar)) {
    entries.push({ page: 'appearance', anchor: settingAnchor('shortcut', action.id), section: 'Shortcuts', label: action.label, text: 'shortcut keys', advanced: true })
  }
  for (const extension of extensions) {
    if (extension.community && !communityExtensions) continue
    const page = `extension:${extension.id}`
    if (!extension.community && !extension.alwaysOn) {
      entries.push({ page: 'extensions', anchor: settingAnchor('extension', extension.id), section: 'Built-in extensions', label: extension.name, text: extension.description })
    }
    if (!hasPageOf(extension)) continue
    entries.push({ page, anchor: settingAnchor('extension-page', extension.id), label: extension.name, text: `${extension.description} extension settings` })
    for (const setting of extension.settings) {
      entries.push({ page, anchor: settingAnchor('extension', extension.id, setting.key), section: extension.name, label: setting.label, text: `${setting.description ?? ''} ${setting.key}` })
    }
    for (const prompt of extension.prompts ?? []) {
      entries.push(promptEntry(page, `prompt-${extension.id}-${prompt.id.replace(/[^a-z0-9-]/gi, '-')}`, prompt, extension.name))
    }
  }
  return entries
}

// The same test as extensions.tsx's hasPage, kept here so search doesn't import the pages.
const hasPageOf = (extension: ExtensionInfo) =>
  !!(extension.setup || extension.settings.length || extension.settingsView || extension.prompts?.length)

const fold = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ’']/g, '')

/**
 * The entries every word typed is found in (label, section, page or explanation). A match in the label comes first, one
 * at the start of the label before that.
 */
export function searchSettings(entries: SettingEntry[], query: string, pageTitle: (page: string) => string = (p) => p): SettingEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { entry: SettingEntry; score: number; i: number }[] = []
  entries.forEach((entry, i) => {
    const label = fold(entry.label)
    const all = `${label} ${fold(entry.section ?? '')} ${fold(pageTitle(entry.page))} ${fold(entry.text ?? '')}`
    if (!words.every((w) => all.includes(w))) return
    const inLabel = words.filter((w) => label.includes(w)).length
    const score = (label.startsWith(words[0]!) ? 100 : 0) + inLabel * 10 - (entry.advanced ? 1 : 0)
    scored.push({ entry, score, i })
  })
  const seen = new Set<string>()
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.entry)
    .filter((e) => !seen.has(e.anchor) && !!seen.add(e.anchor))
}

const FOUND = ['bg-accent/12', 'ring-4', 'ring-accent/12']

// The anchor the latest reveal looks for: an older one still looking gives up.
let seeking: string | undefined

/**
 * Shows the element with id anchor once it's drawn: opens each folded part around it (the page's Advanced) without
 * that part remembering it, scrolls to it and flashes it.
 */
export function revealSetting(anchor: string) {
  seeking = anchor
  let tries = 30
  const find = () => {
    if (seeking !== anchor) return
    const target = document.getElementById(anchor)
    if (!target) {
      if (--tries > 0) requestAnimationFrame(find)
      else seeking = undefined
      return
    }
    seeking = undefined
    for (let details = target.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
      if (details.open) continue
      details.dataset.revealed = ''
      details.open = true
    }
    target.scrollIntoView?.({ block: 'start' })
    target.classList.add(...FOUND)
    setTimeout(() => target.classList.remove(...FOUND), 1600)
  }
  requestAnimationFrame(find)
}
