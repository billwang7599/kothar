// How `npm run package` signs and notarizes Kothar.app and its DMG (packages/desktop/README.md has the one-time setup).
// electron-builder.config.cjs calls signingPlan() once and hands the result to electron-builder and to the two hooks
// below. Everything that decides or builds a command is a plain function, so it's tested without signing anything.
// Erasable TypeScript only: Node loads this file as is.
//
// Signing identity, first match wins:
//   KOTHAR_UNSIGNED=1             force an ad-hoc build even with a certificate installed
//   CSC_LINK (+ CSC_KEY_PASSWORD) a .p12 file (path or base64); electron-builder imports it into a temporary keychain
//   CSC_NAME                      the certificate's name in your keychain, such as "Bill Wang (AB12CD34EF)"
//   the keychain                  the one "Developer ID Application" certificate in your login keychain
// With none, the app gets an ad-hoc signature, which Apple Silicon needs to run it at all, and runs only on the Mac that
// built it.
//
// Notarization (only when signed), first match wins:
//   APPLE_KEYCHAIN_PROFILE (+ APPLE_KEYCHAIN)                 a notarytool profile you name
//   the kothar-notary profile                                 saved once with `xcrun notarytool store-credentials`
//                                                             (KOTHAR_NOTARY_PROFILE names another)
//   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID    an Apple ID with an app-specific password
//   APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER       an App Store Connect API key
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_PROFILE = 'kothar-notary'
const DEVELOPER_ID = 'Developer ID Application: '
// Where older notarytool versions keep a profile: a generic password with this service, one account per profile. Newer
// ones (Xcode 16+, macOS 15+) keep it in the data-protection keychain, which `security` can't see, so that lookup is
// only a fast first try and notarytool itself has the last word (checkNotaryProfile).
const NOTARY_SERVICE = 'com.apple.gke.notary.tool'
const notaryAccount = (profile: string) => `${NOTARY_SERVICE}.saved-creds.${profile}`

export type Env = Record<string, string | undefined>
export type Notary =
  | { kind: 'profile'; profile: string; keychain?: string }
  | { kind: 'apple-id'; appleId: string; password: string; teamId: string }
  | { kind: 'api-key'; key: string; keyId: string; issuer: string }
export type Plan = {
  signed: boolean
  /** The certificate's name without its prefix; '-' for ad-hoc; undefined for the certificate in CSC_LINK. */
  identity: string | undefined
  notary: Notary | null
  /** One line for the start of the build. */
  message: string
}
/** Whether a notarytool profile works, and if not, notarytool's own words. */
export type ProfileCheck = { found: true } | { found: false; error: string }
/** What the Mac answers; tests pass their own. */
export type Probe = { identities(): string[]; notaryProfile(profile: string, keychain?: string): ProfileCheck }
/** Runs a command and returns its stdout (execFileSync's shape); tests pass a fake. */
export type Run = (command: string, args: string[], options: object) => string | Buffer | null

/** notarytool's stderr without its harmless "stepSQLStatement … Cache.db" noise. */
export function notaryErrors(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => line.trim() && !/stepSQLStatement|Cache\.db/.test(line))
    .join('\n')
    .trim()
}

/** Checks a notarytool profile. First the old keychain item, which is instant and offline; then `notarytool history`,
 * which signs in to Apple with the profile, so it finds profiles in the data-protection keychain too. It needs the
 * network: offline, a working profile counts as missing. */
export function checkNotaryProfile(profile: string, keychain: string | undefined, run: Run = execFileSync): ProfileCheck {
  if (!keychain) {
    try {
      // Without -w it reads only the item's attributes, so it never asks for the keychain password.
      run('security', ['find-generic-password', '-s', NOTARY_SERVICE, '-a', notaryAccount(profile)], { stdio: 'ignore' })
      return { found: true }
    } catch {
      // Not there; ask notarytool.
    }
  }
  const auth = ['--keychain-profile', profile, ...(keychain ? ['--keychain', keychain] : [])]
  try {
    run('xcrun', ['notarytool', 'history', ...auth, '--output-format', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 60_000,
    })
    return { found: true }
  } catch (error) {
    const stderr = notaryErrors(String((error as { stderr?: unknown }).stderr ?? ''))
    return { found: false, error: stderr || (error as Error).message }
  }
}

/** The "Developer ID Application" names in `security find-identity -v -p codesigning` output, without the prefix. */
export function developerIds(output: string): string[] {
  const names: string[] = []
  for (const line of output.split('\n')) {
    const name = /"Developer ID Application: (.+)"/.exec(line)?.[1]
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

const macProbe: Probe = {
  identities() {
    try {
      return developerIds(execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }))
    } catch {
      return []
    }
  },
  notaryProfile: (profile, keychain) => checkNotaryProfile(profile, keychain),
}

const value = (env: Env, name: string) => env[name]?.trim() || undefined

/** Throws when some, but not all, of a group of variables are set: a half-done setup should stop the build, not
 * quietly ship something unnotarized. */
function whole(env: Env, names: string[]): boolean {
  const present = names.filter((name) => value(env, name))
  if (present.length > 0 && present.length < names.length) {
    const missing = names.filter((name) => !value(env, name))
    throw new Error(`${present.join(' and ')} ${present.length === 1 ? 'is' : 'are'} set, but not ${missing.join(' or ')}`)
  }
  return present.length === names.length
}

function pickNotary(env: Env, probe: Probe): Notary | null {
  // A profile you name has to work: better to stop now, with notarytool's reason, than after the app is built.
  const missing = (profile: string, variable: string, check: ProfileCheck) =>
    new Error(`No working notarytool profile "${profile}" (${variable})${check.found ? '' : `: ${check.error}`}`)
  const named = value(env, 'APPLE_KEYCHAIN_PROFILE')
  if (named) {
    const keychain = value(env, 'APPLE_KEYCHAIN')
    const check = probe.notaryProfile(named, keychain)
    if (!check.found) throw missing(named, 'APPLE_KEYCHAIN_PROFILE', check)
    return { kind: 'profile', profile: named, ...(keychain && { keychain }) }
  }
  const chosen = value(env, 'KOTHAR_NOTARY_PROFILE')
  const profile = chosen ?? DEFAULT_PROFILE
  const appleId = whole(env, ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])
  const apiKey = whole(env, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])
  const check = probe.notaryProfile(profile)
  if (check.found) return { kind: 'profile', profile }
  if (chosen) throw missing(profile, 'KOTHAR_NOTARY_PROFILE', check)
  if (appleId) {
    return {
      kind: 'apple-id',
      appleId: value(env, 'APPLE_ID')!,
      password: value(env, 'APPLE_APP_SPECIFIC_PASSWORD')!,
      teamId: value(env, 'APPLE_TEAM_ID')!,
    }
  }
  if (apiKey) {
    return {
      kind: 'api-key',
      key: value(env, 'APPLE_API_KEY')!,
      keyId: value(env, 'APPLE_API_KEY_ID')!,
      issuer: value(env, 'APPLE_API_ISSUER')!,
    }
  }
  return null
}

/** Decides how this build is signed and notarized. */
export function signingPlan(env: Env, probe: Probe = macProbe): Plan {
  const unsigned = (why: string): Plan => ({
    signed: false,
    identity: '-',
    notary: null,
    message: `Kothar will be UNSIGNED (ad-hoc signature only, runs on this Mac): ${why}. See packages/desktop/README.md to sign it.`,
  })
  if (env.KOTHAR_UNSIGNED === '1' || env.KOTHAR_UNSIGNED === 'true') return unsigned('KOTHAR_UNSIGNED is set')

  let identity: string | undefined
  let source: string
  const named = value(env, 'CSC_NAME')
  if (value(env, 'CSC_LINK')) {
    source = 'the certificate in CSC_LINK'
  } else if (named) {
    // electron-builder wants the name without its prefix.
    identity = named.replace(/^Developer ID Application:\s*/, '')
    source = `"${DEVELOPER_ID}${identity}"`
  } else {
    const found = probe.identities()
    if (found.length === 0) return unsigned('no Developer ID Application certificate in your keychain')
    if (found.length > 1) {
      const names = found.map((name) => `"${name}"`).join(', ')
      throw new Error(`Several Developer ID Application certificates are in your keychain; pick one with CSC_NAME: ${names}`)
    }
    identity = found[0]
    source = `"${DEVELOPER_ID}${identity}"`
  }

  const notary = pickNotary(env, probe)
  const how = !notary
    ? `NOT notarized (no "${DEFAULT_PROFILE}" notarytool profile or Apple credentials), so other Macs will warn about it`
    : notary.kind === 'profile'
      ? `notarized with the notarytool profile "${notary.profile}"`
      : notary.kind === 'apple-id'
        ? `notarized as ${notary.appleId}`
        : 'notarized with an App Store Connect API key'
  return { signed: true, identity, notary, message: `Kothar will be signed with ${source} and ${how}.` }
}

/** notarytool's sign-in arguments. */
export function notaryAuth(notary: Notary): string[] {
  switch (notary.kind) {
    case 'profile':
      return ['--keychain-profile', notary.profile, ...(notary.keychain ? ['--keychain', notary.keychain] : [])]
    case 'apple-id':
      return ['--apple-id', notary.appleId, '--password', notary.password, '--team-id', notary.teamId]
    case 'api-key':
      return ['--key', notary.key, '--key-id', notary.keyId, '--issuer', notary.issuer]
  }
}

/** `xcrun` arguments that upload a file to Apple's notary service and wait for its verdict, as JSON. */
export const submitArgs = (file: string, notary: Notary) => [
  'notarytool', 'submit', file, ...notaryAuth(notary), '--wait', '--output-format', 'json',
]
/** `xcrun` arguments that fetch the notary's log for a rejected submission. */
export const logArgs = (id: string, notary: Notary) => ['notarytool', 'log', id, ...notaryAuth(notary)]
/** `xcrun` arguments that attach the notarization ticket to a file, so Gatekeeper accepts it offline. */
export const stapleArgs = (file: string) => ['stapler', 'staple', file]
/** `ditto` arguments that zip an app for upload (notarytool takes a zip, dmg or pkg, not a bare .app). */
export const zipArgs = (app: string, zip: string) => ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]

/** The submission's id and whether Apple accepted it, from `notarytool submit --output-format json`. notarytool can
 * exit 0 for a rejected submission, so the status is what counts. */
export function parseSubmit(output: string): { id: string; status: string; accepted: boolean } {
  let result: { id?: unknown; status?: unknown }
  try {
    result = JSON.parse(output.trim().split('\n').filter(Boolean).at(-1) ?? '')
  } catch {
    throw new Error(`notarytool gave no JSON result:\n${output}`)
  }
  const status = String(result.status)
  return { id: String(result.id), status, accepted: status === 'Accepted' }
}

/** A command line safe to print: the app-specific password is hidden. */
export const shown = (command: string, args: string[]) =>
  [command, ...args.map((arg, i) => (args[i - 1] === '--password' ? '********' : /\s/.test(arg) ? `"${arg}"` : arg))].join(' ')

/** Uploads a file to Apple's notary service and waits; throws, with Apple's log, unless it's accepted. Stapling is the
 * caller's job (a zip can't be stapled; the app it holds is). */
export function notarize(file: string, notary: Notary, run: Run = execFileSync): string {
  const args = submitArgs(file, notary)
  console.log(`  • notarizing ${file}, which can take a few minutes: ${shown('xcrun', args)}`)
  const result = parseSubmit(String(run('xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })))
  if (!result.accepted) {
    let log = ''
    try {
      log = String(run('xcrun', logArgs(result.id, notary), { encoding: 'utf8' }))
    } catch {
      // The verdict alone still says what went wrong.
    }
    throw new Error(`Apple's notary service answered "${result.status}" for ${file} (submission ${result.id})\n${log}`)
  }
  return result.id
}

type SignContext = { electronPlatformName: string; appOutDir: string; packager: { appInfo: { productFilename: string } } }

/** electron-builder's afterSign hook: notarizes and staples Kothar.app before it goes into the DMG. */
export function afterSign(plan: Plan, run: Run = execFileSync) {
  return async (context: SignContext) => {
    if (context.electronPlatformName !== 'darwin' || !plan.signed || !plan.notary) return
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    const zip = `${app.slice(0, -'.app'.length)}-notarize.zip`
    run('ditto', zipArgs(app, zip), { stdio: 'inherit' })
    try {
      notarize(zip, plan.notary, run)
    } finally {
      rmSync(zip, { force: true })
    }
    // Apple issued the ticket for the zip's contents; staple it onto the app itself.
    run('xcrun', stapleArgs(app), { stdio: 'inherit' })
  }
}

/** electron-builder's afterAllArtifactBuild hook: notarizes and staples each DMG (which electron-builder signed). */
export function afterAllArtifactBuild(plan: Plan, run: Run = execFileSync) {
  return async (result: { artifactPaths: string[] }): Promise<string[]> => {
    if (!plan.signed || !plan.notary) return []
    for (const file of result.artifactPaths.filter((path) => path.endsWith('.dmg'))) {
      notarize(file, plan.notary, run)
      run('xcrun', stapleArgs(file), { stdio: 'inherit' })
    }
    return []
  }
}
