// Runs the real Kothar core (no fake engine) on a throwaway garage, serving the built UI, for recording demos.
//
//   npm run build -w @kothar/ui
//   KOTHAR_GARAGE=/tmp/demo-garage KOTHAR_PORT=4417 KOTHAR_TOKEN=demo node scripts/demo/serve.ts
//
// The engines use their own default sign-in (claude, pi, ...), as the desktop app does with no saved account.
import { fileURLToPath } from 'node:url'
import { closeOnSignals, startCore } from '@kothar/core/main'

const env = { ...process.env }
delete env.KOTHAR_DEV
delete env.KOTHAR_ENGINE
if (!env.KOTHAR_GARAGE) {
  console.error('Set KOTHAR_GARAGE to a throwaway folder: the demo must never touch your real garage.')
  process.exit(1)
}
env.KOTHAR_PORT ||= '4417'
const uiDir = fileURLToPath(new URL('../../packages/ui/dist', import.meta.url))
const kothar = await startCore({ env, uiDir })
console.log(`Kothar demo core on ${kothar.uiUrl} (garage ${kothar.garage})`)
console.log(`Open ${kothar.openUrl}`)
closeOnSignals(kothar.close)
