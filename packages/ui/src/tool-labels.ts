// Friendly labels for Kothar's own tools in a chat's tool rows. The row still shows the tool's real name and, when
// open, its full arguments and output: a label only adds words, it never hides what was called.

/** A short label for the row, and an optional detail drawn from the call's arguments. */
export type ToolLabel = { label: string; detail?: string }

// Engines name an MCP server's tools in their own ways: mcp__kothar__x (Claude Code, Codex, pi), kothar_x,
// kothar/x or kothar.x (ACP agents).
const KOTHAR_TOOL = /^(?:mcp__kothar__|kothar[_/.])([a-z_]+)$/

/** The bare name of a Kothar tool (spawn_worker), or undefined for any other tool. */
export function kotharToolName(name: string): string | undefined {
  return KOTHAR_TOOL.exec(name)?.[1]
}

type Args = Record<string, unknown>
type Labeler = (args: Args, chatName: (chatId: string) => string) => ToolLabel

const text = (value: unknown): string | undefined => {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  const line = value.replace(/\s+/g, ' ').trim()
  return line || undefined
}

const quoted = (value: unknown) => {
  const t = text(value)
  return t === undefined ? undefined : `"${t}"`
}

const labeled = (label: string, detail?: string): ToolLabel => (detail === undefined ? { label } : { label, detail })

const LABELS: Record<string, Labeler> = {
  // Workers and other chats
  spawn_worker: (a) => labeled('Started worker', text(a.task)),
  send_message: (a, name) => labeled(`Sent message to ${name(String(a.chatId ?? ''))}`, text(a.text)),
  read_chat: (a, name) => labeled(`Read chat ${name(String(a.chatId ?? ''))}`),
  list_chats: () => labeled('Listed chats'),
  stop_chat: (a, name) => labeled(`Stopped ${name(String(a.chatId ?? ''))}`),
  review_worker: (a, name) => {
    const verb = { merge: 'Merged', squash: 'Squashed', discard: 'Discarded', keep: 'Kept' }[String(a.action)]
    return labeled(`${verb ?? 'Reviewed'} worker ${name(String(a.workerId ?? ''))}`)
  },
  create_chat: (a) => labeled('Created space', text(a.name)),
  // Memory
  zoom: (a) => labeled('Opened memory', text(a.id)),
  date: (a) => labeled('Looked up date', text(a.id)),
  forget: (a) => labeled('Asked to forget messages', Array.isArray(a.ids) ? a.ids.join(', ') : undefined),
  // Notes
  list_notes: () => labeled('Listed notes'),
  search_notes: (a) => labeled('Searched notes', quoted(a.query)),
  read_note: (a) => labeled('Read note', text(a.name)),
  write_note: (a) => labeled('Wrote note', text(a.name)),
  delete_note: (a) => labeled('Deleted note', text(a.name)),
  // Processes
  start_process: (a) => labeled(`Started process${text(a.name) ? ` ${text(a.name)}` : ''}`, text(a.command)),
  list_processes: () => labeled('Listed processes'),
  read_output: (a) => labeled('Read output of', text(a.id)),
  stop_process: (a) => labeled('Stopped process', text(a.id)),
  // Browser
  browser_open: (a) => labeled('Opened', text(a.url)),
  browser_snapshot: () => labeled('Read the page'),
  browser_act: () => labeled('Clicked on the page'),
  browser_type: (a) => labeled('Typed on the page', quoted(a.text)),
  browser_screenshot: () => labeled('Took a screenshot'),
  browser_tabs: () => labeled('Checked browser tabs'),
  browser_upload: () => labeled('Uploaded a file'),
  browser_cdp: (a) => labeled('Sent a DevTools command', text(a.method)),
  ask_user_in_browser: () => labeled('Asked you in the browser'),
  show_browser: () => labeled('Showed the browser'),
  // Artifacts
  create_artifact: (a) => labeled('Made artifact', text(a.title)),
  update_artifact: (a) => labeled('Updated artifact', text(a.artifact)),
  list_artifacts: () => labeled('Listed artifacts'),
  read_artifact: (a) => labeled('Read artifact', text(a.artifact)),
  // Plan
  submit_plan: (a) => labeled('Submitted plan', text(a.goal)),
  update_plan_step: (a) => labeled('Updated plan step', [text(a.step), text(a.status)].filter(Boolean).join(': ') || undefined),
  read_plan: () => labeled('Read plan'),
  // Skills
  read_skill: (a) => labeled('Read skill', text(a.name)),
  read_skill_file: (a) => labeled('Read skill file', [text(a.name), text(a.file)].filter(Boolean).join(' / ') || undefined),
  create_skill: (a) => labeled('Made skill', text(a.name)),
  // Deep research
  deep_research: (a) => labeled('Started deep research', text(a.question)),
}

/**
 * The friendly label for a known Kothar tool call, or undefined for any other tool (engine tools, other MCP
 * servers, Kothar tools without a label yet), which keep today's row. chatName turns a chat id into its name.
 */
export function toolLabel(name: string, input: unknown, chatName: (chatId: string) => string = (id) => id): ToolLabel | undefined {
  const bare = kotharToolName(name)
  const labeler = bare === undefined ? undefined : LABELS[bare]
  if (!labeler) return undefined
  const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Args) : {}
  return labeler(args, chatName)
}

/** A call's full arguments, as shown when its row is open: pretty JSON, or the engine's summary without them. */
export function rawArguments(input: unknown, summary: string): string {
  if (input === undefined) return summary
  try {
    return JSON.stringify(input, null, 2) ?? summary
  } catch {
    return summary
  }
}
