// Joins a session's instructions from plain data, in the README's order (Instructions). The core gathers each part
// (asking extensions, reading files) and this only orders and formats them, so it can be tested alone.
import { folderLines, type FolderPlace } from './folder-modes.ts'
import type { ContextItem } from './shared.ts'
import { WORKERS_PROMPT } from './workers.ts'
import { corePromptLink } from './core-prompts.ts'

export const WRITE_RULES =
  'You can write files only in your work folder and in attached folders set to Edit in place. Every other folder ' +
  'is read-only to you: writes there fail.'
// Kothar's sandbox keeps a Chrome an agent starts itself from saving to the login keychain; without these flags
// macOS shows the user a keychain dialog (machine.ts, NO_DIALOG_RULES, now stops it, and this keeps agents off it).
export const BROWSER_LAUNCH_RULES =
  "To check a web page, use Kothar's browser tools when you have them. If you must start Chrome or Chromium " +
  'yourself (Playwright, Puppeteer, `--headless --screenshot`), always pass `--use-mock-keychain ' +
  '--password-store=basic`, so it never touches the macOS keychain.'
export const FOLDER_RULES =
  "The user sets how you may write in each attached folder that isn't a git repo, as its mode in the chat's " +
  "Context panel. To write in one you can't, ask them to change its mode there:"
export const CHECKOUT_RULES =
  'Each git folder in your context is checked out in your work folder on a branch of its own, from its last ' +
  "commit, so changes the user hasn't committed aren't in it. Work and commit in the checkout:"

export const WORKER_CHECKOUT_RULES =
  'These checkouts are your own, made for this task from the space\'s branch: no other chat edits them, and your ' +
  "changes aren't in the space's branch until they're reviewed and merged after your report. Commit your work there " +
  "with clear messages; anything left uncommitted is committed for you when it's merged."

export const NO_COMMITS_RULES =
  "These git folders have no commits yet, so Kothar hasn't checked them out: use them as the folder modes below " +
  'say. Each is checked out in your work folder from the first message after its first commit:'

// Every chat's replies are read in Kothar, which turns these links into clickable files and pictures (markdown.tsx).
export const FILE_RULES =
  'When you create or save a file the user may want to open (a screenshot, render, document, report or export), ' +
  'link it in your reply as [name](</absolute/path>), with the path in angle brackets so spaces in it work: Kothar ' +
  'makes it a link that opens the file. Also show an image (png, jpg, gif, webp, svg) inline with ' +
  '![caption](</absolute/path.png>). The file must be in your folders.'

// own: a worker's own worktree (worker-checkouts.ts), not the space's.
export type InstructionCheckout = { folder: string; path: string; branch: string; own?: boolean }

export type InstructionParts = {
  // An extension's own chat (Home) gets its extension's role instructions first.
  role?: string
  // Set while sandboxed: the chat may write only here.
  workDir?: string
  checkouts: InstructionCheckout[]
  // The attached folders that aren't git repos, each with its mode.
  folders: FolderPlace[]
  // What extensions add (Extension.instructions), already trimmed, in extension order.
  extensions: string[]
  // "What you can use": what the chat can use from Kothar and each extension, and the nudge to combine them
  // (core-prompts.ts), for a session with Kothar's tools.
  toolbox?: string
  // Settings → Workers' instructions, for a chat that may start workers.
  workers?: string
  // The memory extension's instructions, already trimmed.
  memory: string[]
  // A worker's view of its parent's memory, frozen at launch.
  parentView?: string
  setup?: { name: string; instructions?: string }
  // The chat's context items, in order; only enabled ones count.
  items: ContextItem[]
  // Whose text each part is, for the Inspector: the extension id of each of extensions (in order), of memory, and of
  // role (the extension whose chat this is).
  sources?: { extensions: string[]; memory?: string; role?: string }
}

// A context item as the session sees it: a file pasted in full and tagged, other items as they are.
export const contextTextOf = (items: ContextItem[]) =>
  items.flatMap(({ enabled, section, path, text, binary }) => {
    if (!enabled) return []
    if (binary) return [`The file ${path} is not text, so it isn't pasted here. Open it with your tools when you need it.`]
    if (!text.trim()) return []
    return [section === 'files' ? `<file path="${path}">\n${text.trimEnd()}\n</file>` : text.trim()]
  })

// One labelled part of a session's instructions, for the Inspector: joined with a blank line they make the
// instructions exactly (buildInstructions). extension: the id of the extension whose text it is.
export type InstructionSection = {
  source: 'core' | 'context' | 'extension'
  label: string
  text: string
  extension?: string
  // Where the user edits this core text: a Settings page, with #anchor (kothar:settings/<this>).
  settings?: string
}

export const instructionSections = (parts: InstructionParts): InstructionSection[] => {
  const { role, workDir, checkouts, folders, toolbox, extensions, workers, memory, parentView, setup, items } = parts
  const core = (label: string, text: string): InstructionSection => ({ source: 'core', label, text })
  const from = (extension: string | undefined, label: string, text: string): InstructionSection =>
    extension ? { source: 'extension', label, text, extension } : core(label, text)
  const ids = parts.sources?.extensions ?? []
  return [
    ...(role ? [from(parts.sources?.role, 'Role of this chat', role)] : []),
    ...(workDir !== undefined ? [core('Where you can write', `${WRITE_RULES}\nYour work folder: ${workDir}\n${BROWSER_LAUNCH_RULES}`)] : []),
    ...(checkouts.length
      ? [
          core(
            'Git checkouts',
            [
              CHECKOUT_RULES,
              ...checkouts.map((c) => `- ${c.folder}: ${c.path} (branch ${c.branch})`),
              ...(checkouts.some((c) => c.own) ? [WORKER_CHECKOUT_RULES] : []),
            ].join('\n'),
          ),
        ]
      : []),
    ...(folders.some((f) => f.unborn)
      ? [core('Git folders without commits', [NO_COMMITS_RULES, ...folders.flatMap((f) => (f.unborn ? [`- ${f.path}`] : []))].join('\n'))]
      : []),
    ...(folders.length ? [core('Folder modes', [FOLDER_RULES, ...folderLines(folders)].join('\n'))] : []),
    // Every engine's replies are read in Kothar, which links files and shows images from the chat's folders.
    core('Showing files', FILE_RULES),
    ...(toolbox ? [{ ...core('What you can use', toolbox), settings: corePromptLink('combine') }] : []),
    ...extensions.map((text, i) => from(ids[i], 'Instructions', text)),
    ...(workers !== undefined
      ? [{ ...core('Workers: when to start workers', workers), settings: `${WORKERS_PROMPT.page}#prompt-${WORKERS_PROMPT.page}-${WORKERS_PROMPT.id}` }]
      : []),
    ...memory.map((text) => from(parts.sources?.memory, 'How to read the memory', text)),
    ...(parentView ? [core("Parent chat's memory at launch", `Your parent chat's memory when it started you:\n\n${parentView}`)] : []),
    // The setup's instructions come just before the context items, so the user's own AGENTS.md files read last.
    ...(setup?.instructions
      ? [{ source: 'context' as const, label: `Setup "${setup.name}"`, text: `Instructions from the setup "${setup.name}":\n\n${setup.instructions}` }]
      : []),
    ...contextSectionsOf(items),
  ]
}

const CONTEXT_LABELS: Record<ContextItem['section'], string> = { agents: 'Instructions file', folders: 'Folder', files: 'File' }

const contextSectionsOf = (items: ContextItem[]): InstructionSection[] =>
  items.flatMap((item) =>
    contextTextOf([item]).map((text) => ({ source: 'context' as const, label: `${CONTEXT_LABELS[item.section] ?? 'Context'}: ${item.path}`, text })),
  )

export const buildInstructions = (parts: InstructionParts) =>
  instructionSections(parts)
    .map((section) => section.text)
    .join('\n\n')
