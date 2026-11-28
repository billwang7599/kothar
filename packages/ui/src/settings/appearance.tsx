// Settings → Appearance: the theme and how things show; where file paths show and the shortcuts are under Advanced.
// These live in this window, not the garage.
import { CHAT_NOUN, Select, Switch } from '../controls.tsx'
import { LAUNCHER_PLACES, placeLaunchers, useLauncherPlace, type LauncherPlace } from '../launchers.ts'
import { showPaths, usePathsShown } from '../paths.ts'
import { ShortcutsPage } from '../shortcuts-page.tsx'
import { showReportsByDefault, showStepsByDefault, useReportsDefault, useStepsDefault } from '../steps.ts'
import { Appearance } from '../themes.tsx'
import { Advanced, Section, SettingRow } from './rows.tsx'
import { ANCHORS, settingAnchor } from './search.ts'

const LAUNCHER_HINT =
  'Buttons that open extensions such as Notes and Artifacts. Top puts them under Home, Bottom above Settings. Hidden or not, each still opens from its tab in the right panel and its shortcut.'

function Display() {
  const place = useLauncherPlace()
  const steps = useStepsDefault()
  const reports = useReportsDefault()
  return (
    <Section id={ANCHORS.display} title="Display">
      <SettingRow id={settingAnchor('launchers')} name="Extension launchers" hint={LAUNCHER_HINT}>
        <Select
          label="Extension launchers"
          value={place}
          options={LAUNCHER_PLACES}
          onChange={(picked) => placeLaunchers(picked as LauncherPlace)}
        />
      </SettingRow>
      <SettingRow
        id={settingAnchor('steps')}
        name="Thinking and tool calls unfolded"
        hint={`Instead of folding them into "N steps". Each ${CHAT_NOUN.one} can override this in its Context panel.`}
      >
        <Switch label="Show thinking and tool calls unfolded" checked={steps} onChange={showStepsByDefault} />
      </SettingRow>
      <SettingRow
        id={settingAnchor('reports')}
        name="Worker reports unfolded"
        hint={`Folded, a report shows one line until opened. Each ${CHAT_NOUN.one} can override this in its General tab.`}
      >
        <Switch label="Show worker reports unfolded" checked={reports} onChange={showReportsByDefault} />
      </SettingRow>
    </Section>
  )
}

function ShownPaths() {
  const paths = usePathsShown()
  return (
    <Section id={ANCHORS.paths} title="File paths">
      <SettingRow id={settingAnchor('paths', 'header')} name="At the top of a space">
        <Switch label="Show paths at the top of a space" checked={paths.header} onChange={(on) => showPaths('header', on)} />
      </SettingRow>
      <SettingRow id={settingAnchor('paths', 'context')} name="In the Context panel">
        <Switch label="Show paths in the Context panel" checked={paths.context} onChange={(on) => showPaths('context', on)} />
      </SettingRow>
    </Section>
  )
}

export function AppearancePage({ openMarketplace }: { openMarketplace?: () => void }) {
  return (
    <>
      <div id={ANCHORS.theme} className="flex scroll-mt-12 flex-col rounded-sm transition-[background-color,box-shadow]">
        <Appearance browse={openMarketplace} />
      </div>
      <Display />
      <Advanced page="appearance">
        <ShownPaths />
        <Section id={ANCHORS.shortcuts} title="Shortcuts" hint="Click an action’s keys, then press new ones." plain>
          <ShortcutsPage />
        </Section>
      </Advanced>
    </>
  )
}
