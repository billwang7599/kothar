// The files a GitHub Release of Kothar holds, checked and ready to upload. Used by the release workflow and for a
// release built on your own Mac (CONTRIBUTING.md, "Releasing"). Erasable TypeScript only: Node runs this file as is.
//
//   node scripts/release-files.ts prepare        check release/ and add the unversioned DMG copy
//   node scripts/release-files.ts upload v0.2.0  prepare, then create the GitHub Release for that tag with every file,
//                                                or add the files to it if it exists (gh, signed in, run locally)
//
// A release holds:
//   Kothar-<v>-arm64.dmg                      what people download
//   Kothar-arm64.dmg                          the same DMG, unversioned: …/releases/latest/download/Kothar-arm64.dmg
//                                             (the website's Download button) always fetches the newest
//   Kothar-<v>-arm64-mac.zip (+ .blockmap)    what auto-update installs (Squirrel.Mac updates from a zip)
//   latest-mac.yml                            what auto-update reads first: the version, and the zip's name, size and
//                                             sha512. A mismatch makes every Kothar refuse the update, so it's checked.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const UNVERSIONED_DMG = 'Kothar-arm64.dmg'
export const dmgName = (version: string) => `Kothar-${version}-arm64.dmg`
export const zipName = (version: string) => `Kothar-${version}-arm64-mac.zip`

export type FeedFile = { url: string; sha512: string; size: number }
export type Feed = { version: string; files: FeedFile[]; path?: string; sha512?: string }

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2')

/** Reads the parts of latest-mac.yml the updater relies on. electron-builder writes it in one fixed shape. */
export function parseFeed(text: string): Feed {
  const feed: Feed = { version: '', files: [] }
  let file: Partial<FeedFile> | undefined
  for (const line of text.split('\n')) {
    const item = /^\s+-\s+(\w+):\s*(.*)$/.exec(line)
    const nested = /^\s+(\w+):\s*(.*)$/.exec(line)
    const top = /^(\w+):\s*(.*)$/.exec(line)
    if (item) {
      file = {}
      feed.files.push(file as FeedFile)
    }
    const [, key, raw] = item ?? (file && nested) ?? top ?? []
    if (!key || raw === undefined) continue
    const value = unquote(raw)
    if (top) file = undefined
    if (file) {
      if (key === 'url') file.url = value
      else if (key === 'sha512') file.sha512 = value
      else if (key === 'size') file.size = Number(value)
    } else if (key === 'version') feed.version = value
    else if (key === 'path') feed.path = value
    else if (key === 'sha512') feed.sha512 = value
  }
  return feed
}

/** A file's sha512, base64, as latest-mac.yml has it. */
export const sha512 = (file: string) => createHash('sha512').update(readFileSync(file)).digest('base64')

/** What's wrong with latest-mac.yml in dir, as sentences; empty when the updater will accept it. */
export function checkFeed(dir: string, version: string): string[] {
  const feedFile = join(dir, 'latest-mac.yml')
  if (!existsSync(feedFile)) return [`There's no latest-mac.yml in ${dir}. Is the "publish" entry in electron-builder.config.cjs there?`]
  const feed = parseFeed(readFileSync(feedFile, 'utf8'))
  const problems: string[] = []
  if (feed.version !== version) problems.push(`latest-mac.yml is for version ${feed.version || '(none)'}, not ${version}.`)
  const zip = zipName(version)
  if (!feed.files.some((f) => f.url === zip)) problems.push(`latest-mac.yml doesn't list ${zip}, which is what the updater installs.`)
  if (feed.path !== undefined && feed.path !== zip) problems.push(`latest-mac.yml's path is ${feed.path}, not ${zip}.`)
  for (const entry of feed.files) {
    const file = join(dir, entry.url)
    if (!existsSync(file)) {
      problems.push(`latest-mac.yml lists ${entry.url}, which isn't in ${dir}.`)
      continue
    }
    if (statSync(file).size !== entry.size) problems.push(`${entry.url} is ${statSync(file).size} bytes, but latest-mac.yml says ${entry.size}.`)
    const actual = sha512(file)
    if (actual !== entry.sha512) problems.push(`${entry.url}'s sha512 doesn't match latest-mac.yml.`)
    if (entry.url === feed.path && feed.sha512 !== undefined && feed.sha512 !== actual) {
      problems.push(`latest-mac.yml's top-level sha512 doesn't match ${entry.url}.`)
    }
  }
  if (!existsSync(join(dir, `${zip}.blockmap`))) problems.push(`${zip}.blockmap is missing.`)
  return problems
}

/** Every file the release uploads, in order. */
export const releaseAssets = (version: string) => {
  const dmg = dmgName(version)
  const zip = zipName(version)
  return [dmg, UNVERSIONED_DMG, zip, `${zip}.blockmap`, 'latest-mac.yml']
}

/** Checks dir and writes the unversioned DMG; throws with every problem found. Returns the paths. */
export function prepare(dir: string, version: string): string[] {
  const dmg = join(dir, dmgName(version))
  const problems = existsSync(dmg) ? [] : [`${dmgName(version)} isn't in ${dir}. Run npm run package first.`]
  problems.push(...checkFeed(dir, version))
  if (problems.length > 0) throw new Error(`The release files aren't right:\n- ${problems.join('\n- ')}`)
  copyFileSync(dmg, join(dir, UNVERSIONED_DMG))
  return releaseAssets(version).map((name) => join(dir, name))
}

/** gh's arguments: create the release (a tag with a hyphen is a pre-release), or add the files to one that exists. */
export function ghArgs(tag: string, files: string[], exists: boolean): string[] {
  if (exists) return ['release', 'upload', tag, ...files, '--clobber']
  return [
    'release', 'create', tag, ...files, '--verify-tag', '--generate-notes', '--title', `Kothar ${tag.replace(/^v/, '')}`,
    ...(tag.includes('-') ? ['--prerelease'] : []),
  ]
}

if (import.meta.main) {
  const desktop = fileURLToPath(new URL('..', import.meta.url))
  const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version as string
  const dir = join(desktop, 'release')
  const [command, tag] = process.argv.slice(2)
  try {
    if (command === 'prepare') {
      for (const file of prepare(dir, version)) console.log(`  ✓ ${basename(file)}`)
    } else if (command === 'upload' && tag) {
      if (tag !== `v${version}`) throw new Error(`The tag is ${tag}, but packages/desktop/package.json says ${version}.`)
      const files = prepare(dir, version)
      let exists = true
      try {
        execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore' })
      } catch {
        exists = false
      }
      execFileSync('gh', ghArgs(tag, files, exists), { stdio: 'inherit' })
    } else {
      console.error('Usage: node scripts/release-files.ts prepare | upload <tag>')
      process.exitCode = 2
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
