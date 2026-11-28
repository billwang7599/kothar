// Settings → Engines → Advanced → Engine tools: every built-in tool of each engine that's on, each with a switch, under
// two master switches: Engine tools for every engine (at the top) and one per engine, in its header. A master off turns
// every tool off, core ones too; the per-tool choices stay saved, shown greyed out, and come back as they were. All on
// and All off are different: they change those per-tool choices, for an engine, one of its groups, or what a filter
// shows.
//
// Each engine folds (folded at first) and each group in it folds (open at first); both remember it in localStorage. A
// folded header still says how many tools are on, and in amber how many the user turned off. A filter opens whatever
// has a match without remembering it, and search (revealSetting) opens the way to one tool the same way.
import { useState, type ReactNode } from 'react'
import type { ClientMessage, EngineInfo, EngineToolRow, EngineToolsSettings, ToolGroup } from '@kothar/core/shared'
import { Button, GROUP, Hint, Switch } from '../controls.tsx'
import { SettingRow } from './rows.tsx'
import { engineToolAnchor, TOOL_GROUP_LABELS } from './search.ts'

const GROUPS: Record<ToolGroup, { label: string; hint: string }> = {
  core: {
    label: TOOL_GROUP_LABELS.core,
    hint: 'What the engine works with: commands, edits, reads, searches. On by default: its model was trained on these exact tools, and Kothar sees and asks about every call.',
  },
  replaced: {
    label: TOOL_GROUP_LABELS.replaced,
    hint: 'Kothar or an extension replaces these with a version of its own, which you can see, open and stop. Off while that version is on.',
  },
  outside: {
    label: TOOL_GROUP_LABELS.outside,
    hint: "Acts where Kothar can't see, stop or log it, such as schedules, notifications and publishing. Off by default.",
  },
}
const GROUP_ORDER: ToolGroup[] = ['core', 'replaced', 'outside']

const NEW_HINT = "The engine has this tool and Kothar doesn't know it yet. It's on, and asks before each use."
const CORE_CAPABILITIES = new Set(['shell', 'edit', 'read', 'search'])
const WHAT: Record<string, string> = {
  shell: 'run commands',
  edit: 'edit files',
  read: 'read files',
  search: 'search files',
}

export const ENGINE_TOOLS_OFF =
  "Engine tools are off: engines can't run commands, edit or read files themselves. Only Kothar's tools are available: its MCP tools, workers, extensions and MCP servers."

type Send = (m: ClientMessage) => void
type Props = {
  settings?: EngineToolsSettings
  engines: EngineInfo[]
  connected: boolean
  send: Send
}

/** The master switch for every engine, at the top of Engine tools. */
export function EngineToolsMaster({ settings, connected, send }: Omit<Props, 'engines'>) {
  if (!settings) return null
  return (
    <div className={`${GROUP} mb-16`}>
      <SettingRow
        name={
          <Hint text="Each engine's own built-in tools. Off, every engine runs with none of them, leaving the agent only Kothar's tools. Your choices per tool are kept.">
            <span className="self-start">Engine tools</span>
          </Hint>
        }
        description={!settings.enabled && <span className="text-amber">{ENGINE_TOOLS_OFF}</span>}
      >
        <Switch
          label="Engine tools"
          checked={settings.enabled}
          disabled={!connected}
          onChange={(enabled) => send({ type: 'engineTools.setEnabled', enabled })}
        />
      </SettingRow>
    </div>
  )
}

type Show = 'all' | 'on' | 'off'
type Filter = { text: string; show: Show }
const SHOWS: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

const fold = (text: string) => text.toLowerCase()
const filtering = (filter: Filter) => !!filter.text.trim() || filter.show !== 'all'

/** Whether a tool is shown: every word typed is in its name or kind, and it's on or off as picked. */
export function matches(tool: EngineToolRow, filter: Filter) {
  if (filter.show === 'on' && !tool.on) return false
  if (filter.show === 'off' && tool.on) return false
  const words = fold(filter.text).split(/\s+/).filter(Boolean)
  const haystack = fold(`${tool.name} ${tool.capability ?? ''} ${tool.isNew ? 'new' : ''}`)
  return words.every((w) => haystack.includes(w))
}

/** Each engine's tools, for the engines that are on and whose tools Kothar can switch, with a filter above them. */
export function EngineToolsSections({ settings, engines, connected, send }: Props) {
  const [filter, setFilter] = useState<Filter>({ text: '', show: 'all' })
  if (!settings) return null
  const on = new Set(engines.filter((engine) => engine.enabled).map((engine) => engine.id))
  const shown = settings.engines.filter((engine) => on.has(engine.engine))
  if (!shown.length) return null
  const active = filtering(filter)
  const anyMatch = shown.some((engine) => engine.tools.some((tool) => matches(tool, filter)))
  return (
    <div className="flex flex-col">
      <FilterRow filter={filter} setFilter={setFilter} />
      {active && !anyMatch && <p className="py-12 text-sm text-muted">No tools match.</p>}
      <div className="flex flex-col gap-8">
        {shown.map((engine) => (
          <EngineToolsSection
            key={engine.engine}
            engine={engine}
            all={settings.enabled}
            filter={filter}
            connected={connected}
            send={send}
          />
        ))}
      </div>
    </div>
  )
}

function FilterRow({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-8 pb-12">
      <input
        type="search"
        aria-label="Filter tools"
        placeholder="Filter tools"
        value={filter.text}
        onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        className="h-26 min-w-120 flex-1 text-sm"
      />
      <div role="radiogroup" aria-label="Show tools" className="flex h-26 shrink-0 rounded border bg-bg p-2 shadow-sunken">
        {SHOWS.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={filter.show === s.value}
            onClick={() => setFilter({ ...filter, show: s.value })}
            className="rounded-sm px-10 text-sm text-muted transition-[background-color,color] hover:text-text aria-checked:bg-raised aria-checked:text-text aria-checked:shadow-raised"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// What a folded header says: how many are on, and in amber how many the user turned off that are on by default.
function Summary({ tools, live, offNote }: { tools: EngineToolRow[]; live: boolean; offNote?: string }) {
  const onCount = live ? tools.filter((t) => t.on).length : 0
  const turnedOff = tools.filter((t) => !t.on && t.defaultOn).length
  return (
    <span className="flex min-w-0 shrink items-center gap-6 truncate text-sm font-normal text-muted">
      <span className="truncate">
        {onCount} of {tools.length} on
      </span>
      {offNote ? (
        <span className="truncate text-amber">{offNote}</span>
      ) : (
        turnedOff > 0 && (
          <Hint text="Tools that are on by default and you turned off.">
            <span className="truncate text-amber">{turnedOff} turned off</span>
          </Hint>
        )
      )}
    </span>
  )
}

/** A folding part that remembers being open under key, opened by a filter or by search without remembering it. */
function Fold({
  storageKey,
  defaultOpen,
  forceOpen,
  className,
  summary,
  children,
  label,
  level,
}: {
  level: keyof typeof FOLDS
  storageKey: string
  defaultOpen: boolean
  forceOpen?: boolean
  className?: string
  summary: ReactNode
  children: ReactNode
  label: string
}) {
  const [stored, setStored] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved === null ? defaultOpen : saved === 'true'
  })
  const [revealed, setRevealed] = useState(false)
  const open = forceOpen || revealed || stored
  return (
    <details
      aria-label={label}
      className={`${FOLDS[level].group} ${className ?? ''}`}
      open={open}
      onToggle={(e) => {
        const details = e.currentTarget
        if (details.open === open) return
        if ('revealed' in details.dataset) {
          delete details.dataset.revealed
          setRevealed(true)
          return
        }
        // While a filter holds it open, folding it only lasts until the filter is cleared.
        if (forceOpen) return
        setRevealed(false)
        setStored(details.open)
        localStorage.setItem(storageKey, String(details.open))
      }}
    >
      {summary}
      {children}
    </details>
  )
}

// controls.tsx's Chevron turns with any open details around it, Advanced's too; this one only with its own fold.
// Named per level, as an open engine around a folded group would turn the group's too.
const FOLDS = {
  engine: { group: 'group/engine', turn: 'group-open/engine:before:rotate-90' },
  tools: { group: 'group/tools', turn: 'group-open/tools:before:rotate-90' },
}
function FoldChevron({ level }: { level: keyof typeof FOLDS }) {
  return (
    <span className={`w-10 shrink-0 text-faint before:inline-block before:text-[14px] before:leading-none before:transition-transform before:duration-120 before:content-['›'] ${FOLDS[level].turn}`} />
  )
}

// The engine master switch sits in the header: a click on it must not fold the engine.
const keepFold = (e: { preventDefault: () => void }) => e.preventDefault()

type SectionProps = {
  engine: EngineToolsSettings['engines'][number]
  all: boolean
  filter: Filter
  connected: boolean
  send: Send
}

/** One tool per message, saved only where it differs from the default; those already as asked are skipped. */
function setAll(send: Send, engine: string, tools: EngineToolRow[], on: boolean) {
  for (const tool of tools) {
    if (tool.on === on) continue
    send({ type: 'engineTools.setTool', engine, tool: tool.name, on: on === tool.defaultOn ? undefined : on })
  }
}

function EngineToolsSection({ engine, all, filter, connected, send }: SectionProps) {
  const live = all && engine.enabled
  const changed = engine.tools.some((tool) => tool.saved)
  const active = filtering(filter)
  const visible = engine.tools.filter((tool) => matches(tool, filter))
  if (active && !visible.length) return null
  const offCore = live
    ? [
        ...new Set(
          engine.tools
            .filter(
              (t) => !t.on && t.capability && CORE_CAPABILITIES.has(t.capability) && allOff(engine.tools, t.capability),
            )
            .map((t) => t.capability!),
        ),
      ]
    : []
  const offNote = !all ? 'Off with Engine tools' : !engine.enabled ? 'All off' : undefined
  const groups = GROUP_ORDER.map((group) => ({ group, tools: visible.filter((t) => t.group === group) })).filter(
    (g) => g.tools.length,
  )
  return (
    <section aria-label={`${engine.name} tools`} className={`${GROUP} px-0`}>
      <Fold
        label={engine.name}
        level="engine"
        storageKey={`kothar.settings.engineTools.${engine.engine}`}
        defaultOpen={false}
        forceOpen={active}
        summary={
          <summary className="flex min-h-40 cursor-pointer list-none items-center gap-8 px-14 py-6 [&::-webkit-details-marker]:hidden">
            <FoldChevron level="engine" />
            <h3 className="shrink-0 font-semibold">{engine.name}</h3>
            <span className="flex min-w-0 flex-1">
              <Summary tools={engine.tools} live={live} offNote={offNote} />
            </span>
            <span onClick={keepFold} className="flex">
              <Hint text="Turns every tool of this engine off for now, keeping your choice for each.">
                <span className="flex">
                  <Switch
                    label={`All ${engine.name} tools`}
                    checked={live}
                    disabled={!connected || !all}
                    onChange={(enabled) => send({ type: 'engineTools.setEnabled', engine: engine.engine, enabled })}
                  />
                </span>
              </Hint>
            </span>
          </summary>
        }
      >
        <div className="flex flex-col border-t px-14 pb-6">
          <div className="flex flex-wrap items-center gap-6 py-8">
            <BulkButtons
              name={engine.name}
              tools={visible}
              filtered={active}
              disabled={!connected || !live}
              set={(on) => setAll(send, engine.engine, visible, on)}
            />
            <span className="flex-1" />
            {changed && (
              <Button
                size="small"
                variant="ghost"
                disabled={!connected}
                onClick={() => send({ type: 'engineTools.reset', engine: engine.engine })}
              >
                Reset to defaults
              </Button>
            )}
          </div>
          {!all && <p className="pb-8 text-sm text-amber">Off with Engine tools, above.</p>}
          {all && !engine.enabled && (
            <p className="pb-8 text-sm text-amber">
              All off: {engine.name} can't run commands, edit or read files itself. Only Kothar's tools are available.
            </p>
          )}
          {offCore.map((capability) => (
            <p key={capability} className="pb-8 text-sm text-amber">
              {engine.name} can't {WHAT[capability]} any more, and Kothar has no tool of its own for that yet.
            </p>
          ))}
          {groups.map(({ group, tools }) => (
            <ToolGroupFold
              key={group}
              engine={engine.engine}
              engineName={engine.name}
              group={group}
              tools={tools}
              filtered={active}
              live={live}
              connected={connected}
              send={send}
            />
          ))}
        </div>
      </Fold>
    </section>
  )
}

function BulkButtons({
  name,
  tools,
  filtered,
  disabled,
  set,
}: {
  name: string
  tools: EngineToolRow[]
  filtered: boolean
  disabled: boolean
  set: (on: boolean) => void
}) {
  const toTurnOn = tools.filter((t) => !t.on).length
  const toTurnOff = tools.filter((t) => t.on).length
  // With a filter on, they say they act only on what it shows.
  const onLabel = filtered ? `Turn on ${tools.length} shown` : 'All on'
  const offLabel = filtered ? `Turn off ${tools.length} shown` : 'All off'
  return (
    <>
      <Button
        size="small"
        aria-label={filtered ? `${onLabel} (${name})` : `${name}: all on`}
        disabled={disabled || !toTurnOn}
        onClick={() => set(true)}
      >
        {onLabel}
      </Button>
      <Button
        size="small"
        aria-label={filtered ? `${offLabel} (${name})` : `${name}: all off`}
        disabled={disabled || !toTurnOff}
        onClick={() => set(false)}
      >
        {offLabel}
      </Button>
    </>
  )
}

function ToolGroupFold({
  engine,
  engineName,
  group,
  tools,
  filtered,
  live,
  connected,
  send,
}: {
  engine: string
  engineName: string
  group: ToolGroup
  tools: EngineToolRow[]
  filtered: boolean
  live: boolean
  connected: boolean
  send: Send
}) {
  const info = GROUPS[group]
  const label = `${engineName} ${info.label}`
  const toTurnOn = tools.filter((t) => !t.on).length
  const toTurnOff = tools.filter((t) => t.on).length
  const disabled = !connected || !live
  const shown = filtered ? ' shown' : ''
  return (
    <Fold
      label={label}
      level="tools"
      storageKey={`kothar.settings.engineTools.${engine}.${group}`}
      defaultOpen
      forceOpen={filtered}
      className="not-first:mt-4"
      summary={
        <summary className="flex min-h-30 cursor-pointer list-none items-center gap-8 border-t py-4 text-sm [&::-webkit-details-marker]:hidden">
          <FoldChevron level="tools" />
          <Hint text={info.hint}>
            <span className="shrink-0 font-medium">{info.label}</span>
          </Hint>
          <span className="flex min-w-0 flex-1">
            <Summary tools={tools} live={live} />
          </span>
          <span onClick={keepFold} className="flex shrink-0 gap-2">
            <Button
              size="small"
              variant="ghost"
              aria-label={`Turn on ${tools.length}${shown} ${label} tools`}
              disabled={disabled || !toTurnOn}
              onClick={() => setAll(send, engine, tools, true)}
            >
              All on
            </Button>
            <Button
              size="small"
              variant="ghost"
              aria-label={`Turn off ${tools.length}${shown} ${label} tools`}
              disabled={disabled || !toTurnOff}
              onClick={() => setAll(send, engine, tools, false)}
            >
              All off
            </Button>
          </span>
        </summary>
      }
    >
      <ul className="flex flex-col pb-4 pl-18">
        {tools.map((tool) => (
          <ToolRow key={tool.name} engine={engine} tool={tool} live={live} connected={connected} send={send} />
        ))}
      </ul>
    </Fold>
  )
}

// Every tool for that capability is off, so the engine has no way left to do it.
const allOff = (tools: EngineToolRow[], capability: string) =>
  tools.filter((t) => t.capability === capability).every((t) => !t.on)

type RowProps = {
  engine: string
  tool: EngineToolRow
  live: boolean
  connected: boolean
  send: Send
}

function ToolRow({ engine, tool, live, connected, send }: RowProps) {
  const replaced = tool.replacedBy && !tool.on ? `${tool.replacedBy} instead` : ''
  const changed = tool.saved && tool.on !== tool.defaultOn ? `${tool.defaultOn ? 'on' : 'off'} by default` : ''
  const meta = [tool.capability, replaced, changed].filter(Boolean).join(' · ')
  return (
    <li
      id={engineToolAnchor(engine, tool.name)}
      className="flex min-h-30 scroll-mt-12 items-center gap-8 rounded-sm py-2 transition-[background-color,box-shadow] not-first:border-t not-first:border-border/50"
    >
      <Hint text={tool.name}>
        <span className="min-w-0 shrink truncate font-mono text-[12.5px]">
          {tool.name}
        </span>
      </Hint>
      {tool.isNew && (
        <Hint text={NEW_HINT}>
          <span className="shrink-0 rounded-sm border border-amber/40 px-4 text-xs text-amber">New</span>
        </Hint>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted">{meta}</span>
      <Switch
        size="small"
        label={`${tool.name} on`}
        checked={live && tool.on}
        disabled={!connected || !live}
        onChange={(on) =>
          send({ type: 'engineTools.setTool', engine, tool: tool.name, on: on === tool.defaultOn ? undefined : on })
        }
      />
    </li>
  )
}
