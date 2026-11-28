// The Settings dialog: its pages, search, and navigation. Each page's content lives in settings/.
import { Fragment, useEffect, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Dialog, Tabs } from 'radix-ui'
import { Button, MOTION, NAV_LABEL, useReturnFocus } from './controls.tsx'
import { AppearancePage } from './settings/appearance.tsx'
import { CommunityExtensionsPage } from './settings/community.tsx'
import { EnginesPage } from './settings/engines.tsx'
import { extensionPages, ExtensionsPage } from './settings/extensions.tsx'
import { revealSetting, searchSettings, settingsIndex, type SettingEntry } from './settings/search.ts'
import { NAV_GROUPS, type Page, type PageProps } from './settings/types.ts'
import { GeneralPage, PERMISSIONS_INTRO, PermissionsPage } from './settings/work-folder.tsx'
import { AgentsPage } from './settings/workers.tsx'

const PAGES = [
  {
    id: 'general',
    group: 'Options',
    title: 'General',
    body: (props: PageProps) => <GeneralPage {...props} />,
  },
  {
    id: 'engines',
    group: 'Options',
    title: 'Engines',
    intro: 'The engines Kothar runs, the accounts they run as, and the models each kind of work uses.',
    body: (props: PageProps) => <EnginesPage {...props} />,
  },
  {
    id: 'agents',
    group: 'Options',
    title: 'Agents',
    intro: 'Workers, saved setups, and what agents are told.',
    body: (props: PageProps) => <AgentsPage {...props} />,
  },
  {
    id: 'permissions',
    group: 'Options',
    title: 'Permissions',
    intro: PERMISSIONS_INTRO,
    body: (props: PageProps) => <PermissionsPage {...props} />,
  },
  {
    id: 'appearance',
    group: 'Options',
    title: 'Appearance',
    body: ({ openMarketplace }: PageProps) => <AppearancePage openMarketplace={openMarketplace} />,
  },
  {
    id: 'extensions',
    group: 'Extensions',
    title: 'Built-in extensions',
    intro: 'Extensions that ship with Kothar. One with settings or a setup gets its own page while it is on.',
    body: (props: PageProps) => <ExtensionsPage {...props} />,
  },
  {
    id: 'community-extensions',
    group: 'Extensions',
    title: 'Community hub',
    intro: 'Extensions installed from the Marketplace or a folder. Each stays off until you turn it on, and changes apply when Kothar restarts.',
    body: (props: PageProps) => <CommunityExtensionsPage {...props} />,
  },
] as const satisfies readonly Page[]

/**
 * Pages that became sections of another, so links to them (the app's own, kothar:settings/<page> links the core and
 * extensions send, such as the Inspector's Edit) still land in the right place.
 */
export const MOVED_PAGES = {
  work: { page: 'general' },
  shortcuts: { page: 'appearance', anchor: 'section-shortcuts' },
  accounts: { page: 'engines', anchor: 'section-accounts' },
  models: { page: 'engines', anchor: 'section-models' },
  workers: { page: 'agents', anchor: 'section-workers' },
  setups: { page: 'agents', anchor: 'section-setups' },
  prompts: { page: 'agents', anchor: 'section-prompts' },
  context: { page: 'agents', anchor: 'section-context' },
} as const satisfies Record<string, { page: (typeof PAGES)[number]['id']; anchor?: string }>

type PageId = (typeof PAGES)[number]['id'] | keyof typeof MOVED_PAGES | `extension:${string}`
/** A page, and optionally (after #) the id of what to show on it, as in a kothar:settings/<page>#<anchor> link. */
export type SettingsPage = PageId | `${PageId}#${string}`

/** The page a link to page opens, and where on it to go: the anchor it names, else where a moved page went. */
export const pageOf = (link: string): { page: string; anchor?: string } => {
  const [page = '', anchor] = link.split(/#(.*)/s)
  const moved = (MOVED_PAGES as Record<string, { page: string; anchor?: string }>)[page] ?? { page }
  return anchor ? { page: moved.page, anchor } : moved
}

type SettingsProps = PageProps & {
  open: boolean
  page: SettingsPage
  openPage: (page: SettingsPage) => void
  close: () => void
}

export function SettingsDialog({ open, page, openPage, close, ...props }: SettingsProps) {
  const focus = useReturnFocus()
  const pages: readonly Page[] = [...PAGES, ...extensionPages(props.extensions, props.communityExtensions ?? false)]
  const moved = pageOf(page)
  const current = pages.find((p) => p.id === moved.page) ?? PAGES[0]
  // A link to a place on a page, or to a page that's now a section of another: show it.
  useEffect(() => {
    if (open && moved.anchor) revealSetting(moved.anchor)
  }, [open, page, moved.anchor])
  const [query, setQuery] = useState('')
  const { engines, extensions, corePrompts, communityExtensions, workFolder, engineTools } = props
  const index = settingsIndex({ engines, extensions, corePrompts, communityExtensions, workFolder, engineTools })
  const titleOf = (id: string) => pages.find((p) => p.id === id)?.title ?? id
  const results = searchSettings(index, query, titleOf).filter((r) => pages.some((p) => p.id === r.page))
  const go = (entry: SettingEntry) => {
    openPage(entry.page as SettingsPage)
    revealSetting(entry.anchor)
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (open) return
        setQuery('')
        close()
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <m.div className="fixed inset-0 bg-backdrop" {...MOTION.fade} />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={focus.remember}
              onCloseAutoFocus={focus.restore}
            >
              <m.div
                className="fixed inset-0 m-auto flex h-[min(680px,calc(100vh-32px))] w-[min(900px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-bg text-text shadow-overlay"
                {...MOTION.pop}
              >
                <Dialog.Title className="sr-only">Settings</Dialog.Title>
                <Tabs.Root
                  className="flex min-w-0 flex-1 max-[600px]:flex-col"
                  orientation="vertical"
                  value={current.id}
                  onValueChange={(id) => openPage(id as SettingsPage)}
                >
                  <div className="flex w-200 shrink-0 flex-col border-r bg-panel max-[720px]:w-170 max-[600px]:w-auto max-[600px]:border-r-0 max-[600px]:border-b">
                    <SearchBox query={query} setQuery={setQuery} first={results[0]} go={go} />
                    {query.trim() ? (
                      <Results results={results} titleOf={titleOf} go={go} />
                    ) : (
                      <Tabs.List
                        aria-label="Settings"
                        className="flex min-h-0 flex-1 scroll-inset flex-col gap-1 overflow-y-auto pt-0 pr-0 pb-12 pl-8 max-[600px]:flex-row max-[600px]:flex-wrap max-[600px]:pt-4 max-[600px]:pb-8 max-[600px]:pl-8"
                      >
                        {NAV_GROUPS.map((group) => (
                          <Fragment key={group}>
                            <div className={`${NAV_LABEL} max-[600px]:hidden`}>{group}</div>
                            {pages
                              .filter((p) => p.group === group)
                              .map((p) => (
                                <Tabs.Trigger key={p.id} value={p.id} asChild>
                                  <button className="flex h-control min-w-0 shrink-0 items-center rounded px-8 text-left text-muted transition-colors hover:bg-raised hover:text-text data-[state=active]:bg-raised data-[state=active]:text-text">
                                    <span className="truncate">{p.title}</span>
                                  </button>
                                </Tabs.Trigger>
                              ))}
                          </Fragment>
                        ))}
                      </Tabs.List>
                    )}
                  </div>
                  {pages.map((p) => (
                    <Tabs.Content key={p.id} value={p.id} asChild>
                      <m.div
                        className="min-h-0 min-w-0 flex-1 scroll-inset overflow-x-hidden overflow-y-auto pt-20 pr-18 pb-32 pl-32 [--scroll-top:48px] focus-visible:-outline-offset-2 max-[600px]:pr-2 max-[600px]:pl-16"
                        initial={MOTION.fade.initial}
                        animate={MOTION.fade.animate}
                      >
                        <h2 className="pr-24 text-[16px] font-semibold">{p.title}</h2>
                        {p.intro && <p className="mt-4 max-w-[60ch] pr-24 text-sm text-muted">{p.intro}</p>}
                        <div className="mt-20 flex max-w-[680px] flex-col">{p.body(props)}</div>
                      </m.div>
                    </Tabs.Content>
                  ))}
                </Tabs.Root>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Close" className="absolute top-14 right-14">
                    ×
                  </Button>
                </Dialog.Close>
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

type SearchProps = { query: string; setQuery: (q: string) => void; first?: SettingEntry; go: (entry: SettingEntry) => void }

// Filters every setting on every page; Enter goes to the first match, Esc clears what's typed before it closes Settings.
function SearchBox({ query, setQuery, first, go }: SearchProps) {
  return (
    <div className="shrink-0 px-8 pt-12 pb-4 max-[600px]:pr-44">
      <input
        type="search"
        aria-label="Search settings"
        placeholder="Search settings"
        className="h-control w-full min-w-0 text-sm"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && first) {
            e.preventDefault()
            go(first)
          }
          if (e.key === 'Escape' && query) {
            e.preventDefault()
            e.stopPropagation()
            setQuery('')
          }
        }}
      />
    </div>
  )
}

function Results({ results, titleOf, go }: { results: SettingEntry[]; titleOf: (page: string) => string; go: (entry: SettingEntry) => void }) {
  if (!results.length) return <p className="px-16 pt-8 text-sm text-muted">No settings match.</p>
  return (
    <ul aria-label="Matching settings" className="flex min-h-0 flex-1 scroll-inset flex-col gap-1 overflow-y-auto pt-4 pr-0 pb-12 pl-8 max-[600px]:max-h-200">
      {results.map((entry) => (
        <li key={`${entry.page} ${entry.anchor}`} className="min-w-0">
          <button
            type="button"
            className="flex w-full min-w-0 flex-col items-start rounded px-8 py-4 text-left transition-colors hover:bg-raised"
            onClick={() => go(entry)}
          >
            <span className="w-full truncate">{entry.label}</span>
            <span className="w-full truncate text-xs text-faint">
              {[titleOf(entry.page), entry.section !== entry.label && entry.section, entry.advanced && 'Advanced'].filter(Boolean).join(' › ')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
