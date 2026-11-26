import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Extension } from '@kothar/extension-api'
import { claudeCode } from './adapters/claude-code.ts'
import { codex } from './adapters/codex.ts'
import { createFakeAdapter } from './adapters/fake.ts'
import { opencode } from './adapters/opencode.ts'
import { pi } from './adapters/pi.ts'
import { newCliToken, writeCliAccess } from './cli-access.ts'
import { openCore } from './core.ts'
import { loadCommunityExtensions, loadExtensions } from './extensions.ts'
import { localMachine } from './machine.ts'
import { startServer } from './server.ts'
import type { Adapter, Machine } from './shared.ts'

const ENGINES: Adapter[] = [claudeCode, pi, codex, opencode]
const STOCK_EXTENSIONS_DIR = fileURLToPath(new URL('../../../extensions/', import.meta.url))

export function envVar(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[`KOTHAR_${name}`]
}

/** Kothar's garage: `~/Library/Application Support/Kothar`. */
export const defaultGarage = (home = homedir()) => join(home, 'Library', 'Application Support', 'Kothar')

/**
 * The engines Kothar offers. The fake engine (scripted replies, no model) is for development and tests only: it's
 * registered when KOTHAR_DEV is set (npm run dev sets it) or KOTHAR_ENGINE names it, never in the packaged app.
 */
export function registeredAdapters(env: Record<string, string | undefined>): Adapter[] {
  const fake = envVar(env, 'DEV') || envVar(env, 'ENGINE') === 'fake'
  return fake ? [...ENGINES, createFakeAdapter(undefined, undefined, { steering: true })] : ENGINES
}

export async function startCore(
  options: {
    env?: Record<string, string | undefined>
    uiDir?: string
    adapters?: Adapter[]
    extensions?: Extension[]
    machine?: Machine
    // The user's home folder: where the garage is found, and what the core treats as home. Tests pass their own.
    home?: string
    // Where the built-in extensions are: the repo's extensions/ unless a packaged app ships them elsewhere.
    extensionsDir?: string
    // How this host restarts Kothar; see openCore's restart.
    restart?: () => void
    // Tests pass a stub, so no terminal really opens.
    openTerminal?: (dir: string, choice?: string) => Promise<void>
    // Shows a path in Finder; the desktop app passes Electron's, tests a stub.
    reveal?: (path: string) => Promise<void>
  } = {},
) {
  const { env = process.env, home, uiDir, machine = localMachine } = options
  const adapters = options.adapters ?? registeredAdapters(env)
  const extensionsDir = options.extensionsDir ?? STOCK_EXTENSIONS_DIR
  const { extensions, brokenExtensions } = options.extensions ? { extensions: options.extensions, brokenExtensions: [] } : await loadExtensions(extensionsDir)
  const port = Number(envVar(env, 'PORT') ?? 4317)
  const garage = envVar(env, 'GARAGE') ?? defaultGarage(home)
  const uiUrl = uiDir ? `http://127.0.0.1:${port}` : (envVar(env, 'UI_ORIGIN') ?? 'http://localhost:4318')
  const token = envVar(env, 'TOKEN') || randomBytes(32).toString('base64url')

  const engine = envVar(env, 'ENGINE')
  const defaultEngine = engine ?? adapters[0]?.id ?? ''
  const marketplaceUrl = envVar(env, 'MARKETPLACE_URL')
  const githubToken = envVar(env, 'GITHUB_TOKEN')
  const community = options.extensions ? [] : await loadCommunityExtensions(
    garage,
    (id) => savedOn(garage, id),
    (id) => savedSwitch(garage, id),
  )
  const core = openCore({
    garage,
    adapters,
    defaultEngine,
    machine,
    extensions,
    brokenExtensions,
    community,
    ...(home && { home }),
    marketplaceUrl,
    githubToken,
    ...(options.restart && { restart: options.restart }),
    ...(options.openTerminal && { openTerminal: options.openTerminal }),
    ...(options.reveal && { reveal: options.reveal }),
  })
  if (engine) core.setEngineEnabled(engine, true)
  const work = envVar(env, 'WORK')
  if (work) core.setWorkFolder(work)
  await core.refreshEngines()
  const cliToken = newCliToken()
  const server = await startServer({ core, port, uiOrigin: uiUrl, token, uiDir, cliToken })
  const removeCliAccess = writeCliAccess(garage, { port: server.port, token: cliToken, pid: process.pid })
  // Sessions need the server's MCP address, so what was queued before the last quit runs only now.
  core.resume()
  return {
    core,
    garage,
    port: server.port,
    uiUrl,
    token,
    openUrl: `${uiUrl}/#token=${encodeURIComponent(token)}`,
    close: async (force = false) => {
      removeCliAccess()
      await Promise.all([core.close(force), server.close()])
    },
  }
}

// Whether settings.json has community extensions on and this one turned on, read before the core opens so only
// extensions that are on get imported.
export function savedOn(garage: string, id: string) {
  return savedSettings(garage)?.communityExtensions === true && savedSwitch(garage, id)
}

// The extension's own switch in settings.json, whatever the Community extensions switch says.
export function savedSwitch(garage: string, id: string) {
  return savedSettings(garage)?.extensions?.[id]?.enabled === true
}

function savedSettings(garage: string) {
  try {
    return JSON.parse(readFileSync(join(garage, 'settings.json'), 'utf8'))
  } catch {
    return undefined
  }
}

// Runs the core and restarts it in this process when asked (npm run dev): the old one stops every chat as quitting does,
// and the new one reads the settings and community extensions again on the same port and token, so the UI reconnects.
export async function runRestartable(start: (restart: () => void) => ReturnType<typeof startCore>) {
  let restarting: Promise<void> | undefined
  const restart = () => {
    restarting ??= (async () => {
      await kothar.close()
      kothar = await start(restart)
      console.log('Kothar restarted.')
    })().finally(() => (restarting = undefined))
  }
  let kothar = await start(restart)
  return { current: () => kothar, close: async (force = false) => kothar.close(force) }
}

export function closeOnSignals(close: (force?: boolean) => Promise<void>) {
  let signals = 0
  const shutdown = async () => {
    signals++
    if (signals === 1) {
      console.log('Stopping engines… press Ctrl+C again to force quit.')
      await close()
      process.exit(signals > 1 ? 1 : 0)
    }
    if (signals > 2) process.exit(1)
    console.log('Force quitting… press Ctrl+C again to quit now.')
    await close(true)
    process.exit(1)
  }
  // Engines sit in their own process groups, so a closed terminal's SIGHUP reaches only the core.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown)
}

if (import.meta.main) {
  try {
    const env = { ...process.env }
    // The UI must find the core again after a restart, so the token stays the same.
    env.KOTHAR_TOKEN ||= randomBytes(32).toString('base64url')
    const run = await runRestartable((restart) => startCore({ env, restart }))
    const kothar = run.current()
    console.log(`Kothar core on ws://127.0.0.1:${kothar.port} (garage ${kothar.garage})`)
    console.log(`Open ${kothar.openUrl}`)
    closeOnSignals(run.close)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
