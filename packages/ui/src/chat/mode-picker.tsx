// The composer's mode picker: one menu, beside the thinking level, listing every mode extensions offer in this chat
// (Extension.composerToggles), such as Deep research and Plan first. It lists whatever the core sends, so a new
// extension's mode shows up without a change here. One mode at a time, for the next message only: the core turns any
// other off when one is picked, and back to none once a message takes it; the picker follows what the core says.
// Picking the picked mode again, or No mode, clears it. In a narrow composer (its @container) the trigger shows only
// the icon, with its name kept for screen readers and in the hover hint.
import { DropdownMenu } from 'radix-ui'
import type { ClientMessage, ComposerToggleInfo } from '@kothar/core/shared'
import { Hint } from '../controls.tsx'

type Icon = NonNullable<ComposerToggleInfo['icon']>

const ICONS: Record<Icon | 'none', string> = {
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3l3.2 3.2',
  globe: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM2.5 8h11M8 2.5c1.6 1.7 2.3 3.5 2.3 5.5S9.6 11.8 8 13.5M8 2.5C6.4 4.2 5.7 6 5.7 8s.7 3.8 2.3 5.5',
  book: 'M3 3.5h3.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H3zM13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H13z',
  sparkle: 'M8 2.5l1.3 3.7 3.7 1.3-3.7 1.3L8 12.5l-1.3-3.7L3 7.5l3.7-1.3z',
  bolt: 'M9 2.5L4 9h4l-1 4.5L12 7H8z',
  // No mode picked: three sliders.
  none: 'M3 4.5h10M3 8h10M3 11.5h10M6 3v3M10.5 6.5v3M5 10v3',
}

function ModeIcon({ icon }: { icon: Icon | 'none' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" className="shrink-0">
      <path d={ICONS[icon]} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Below this composer width, the trigger drops its visible label (kept for screen readers).
export const COLLAPSED_LABEL = 'truncate @max-[600px]:sr-only'
const NONE = 'Mode'
const NONE_HINT = 'Mode for your next message'

const ITEM =
  'flex min-h-26 cursor-default items-center gap-8 rounded-sm py-4 pr-12 pl-8 text-sm outline-none data-disabled:text-faint data-highlighted:bg-raised'

type Props = {
  modes: readonly ComposerToggleInfo[]
  chatId: string
  disabled: boolean
  send: (m: ClientMessage) => void
}

const keyOf = (m: ComposerToggleInfo) => `${m.extension}\n${m.id}`

export function ModePicker({ modes, chatId, disabled, send }: Props) {
  if (!modes.length) return null
  // The core keeps at most one on; should two ever arrive on, the first wins here.
  const picked = modes.find((m) => m.on)
  const set = (mode: ComposerToggleInfo, on: boolean) =>
    send({ type: 'extension.toggle', chatId, extension: mode.extension, toggle: mode.id, on })
  const label = picked?.label ?? NONE
  // The hint always names the mode, as the label may be hidden.
  const said = picked ? (picked.activeHint ?? picked.hint) : undefined
  const hint = !picked ? NONE_HINT : said && !said.toLowerCase().includes(picked.label.toLowerCase()) ? `${picked.label}: ${said}` : (said ?? picked.label)
  return (
    <DropdownMenu.Root modal={false}>
      <Hint text={hint}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={picked ? `Mode: ${picked.label}` : NONE_HINT}
            data-mode-picker={picked ? keyOf(picked) : ''}
            className={`flex h-26 max-w-180 min-w-0 shrink-0 items-center gap-6 rounded border pr-6 pl-8 text-sm whitespace-nowrap transition-[background-color,border-color,color,box-shadow] @max-[600px]:pr-4 @max-[600px]:pl-5 disabled:cursor-default disabled:opacity-50 data-[state=open]:border-border max-[900px]:max-w-150 ${
              picked
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-transparent text-muted enabled:hover:border-border enabled:hover:text-text enabled:hover:shadow-raised data-[state=open]:text-text'
            }`}
          >
            <ModeIcon icon={picked?.icon ?? 'none'} />
            <span className={COLLAPSED_LABEL}>{label}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" aria-hidden="true" className="shrink-0 text-faint @max-[600px]:hidden">
              <path d="M1 1l4 4 4-4" strokeWidth="1.5" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
      </Hint>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side="top"
          sideOffset={4}
          collisionPadding={8}
          className="z-40 flex max-w-[min(320px,calc(100vw-16px))] min-w-180 flex-col rounded-lg border bg-panel p-4 text-text shadow-floating outline-none"
        >
          <DropdownMenu.Label className="flex h-22 items-center px-8 text-xs text-faint">For your next message</DropdownMenu.Label>
          <DropdownMenu.Item className={ITEM} data-mode="" onSelect={() => picked && set(picked, false)}>
            <span className="w-12 shrink-0 text-accent">{picked ? '' : '✓'}</span>
            <span className="text-muted">
              <ModeIcon icon="none" />
            </span>
            No mode
          </DropdownMenu.Item>
          {modes.map((mode) => {
            const on = mode === picked
            return (
              <DropdownMenu.Item key={keyOf(mode)} className={ITEM} data-mode={keyOf(mode)} onSelect={() => set(mode, !on)}>
                <span className="w-12 shrink-0 self-start pt-2 text-accent">{on ? '✓' : ''}</span>
                <span className="self-start pt-2 text-muted">{mode.icon ? <ModeIcon icon={mode.icon} /> : <span className="block w-14" />}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{mode.label}</span>
                  {mode.hint && <span className="text-xs whitespace-normal text-muted">{mode.hint}</span>}
                </span>
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
