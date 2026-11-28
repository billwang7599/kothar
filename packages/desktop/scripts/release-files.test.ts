import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { checkFeed, ghArgs, parseFeed, prepare, releaseAssets, sha512 } from './release-files.ts'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

// A release/ folder as electron-builder leaves it, with tiny stand-ins for the DMG and zip.
function releaseDir(version = '0.2.0', edit: (feed: string) => string = (feed) => feed) {
  const dir = mkdtempSync(join(tmpdir(), 'kothar-release-'))
  dirs.push(dir)
  const zip = `Kothar-${version}-arm64-mac.zip`
  writeFileSync(join(dir, `Kothar-${version}-arm64.dmg`), 'dmg bytes')
  writeFileSync(join(dir, zip), 'zip bytes')
  writeFileSync(join(dir, `${zip}.blockmap`), 'blockmap')
  const hash = sha512(join(dir, zip))
  const feed = [
    `version: ${version}`,
    'files:',
    `  - url: ${zip}`,
    `    sha512: ${hash}`,
    '    size: 9',
    `path: ${zip}`,
    `sha512: ${hash}`,
    "releaseDate: '2026-11-28T17:26:37.413Z'",
    '',
  ].join('\n')
  writeFileSync(join(dir, 'latest-mac.yml'), edit(feed))
  return dir
}

it('reads latest-mac.yml as electron-builder writes it', () => {
  const feed = parseFeed(
    [
      'version: 0.1.0',
      'files:',
      '  - url: Kothar-0.1.0-arm64-mac.zip',
      '    sha512: HjXO+A==',
      '    size: 123084196',
      'path: Kothar-0.1.0-arm64-mac.zip',
      'sha512: HjXO+A==',
      "releaseDate: '2026-11-28T17:26:37.413Z'",
    ].join('\n'),
  )
  expect(feed).toEqual({
    version: '0.1.0',
    files: [{ url: 'Kothar-0.1.0-arm64-mac.zip', sha512: 'HjXO+A==', size: 123084196 }],
    path: 'Kothar-0.1.0-arm64-mac.zip',
    sha512: 'HjXO+A==',
  })
})

it('accepts a feed that matches its files', () => {
  expect(checkFeed(releaseDir(), '0.2.0')).toEqual([])
})

it('catches a wrong version, hash or size, and a missing zip or blockmap', () => {
  expect(checkFeed(releaseDir(), '0.3.0')).toContain('latest-mac.yml is for version 0.2.0, not 0.3.0.')
  const tampered = releaseDir()
  writeFileSync(join(tampered, 'Kothar-0.2.0-arm64-mac.zip'), 'zip byte!')
  expect(checkFeed(tampered, '0.2.0')).toEqual([
    "Kothar-0.2.0-arm64-mac.zip's sha512 doesn't match latest-mac.yml.",
    "latest-mac.yml's top-level sha512 doesn't match Kothar-0.2.0-arm64-mac.zip.",
  ])
  expect(checkFeed(releaseDir('0.2.0', (f) => f.replace('size: 9', 'size: 10')), '0.2.0')).toEqual([
    'Kothar-0.2.0-arm64-mac.zip is 9 bytes, but latest-mac.yml says 10.',
  ])
  const noBlockmap = releaseDir()
  rmSync(join(noBlockmap, 'Kothar-0.2.0-arm64-mac.zip.blockmap'))
  expect(checkFeed(noBlockmap, '0.2.0')).toEqual(['Kothar-0.2.0-arm64-mac.zip.blockmap is missing.'])
  const empty = mkdtempSync(join(tmpdir(), 'kothar-release-'))
  dirs.push(empty)
  expect(checkFeed(empty, '0.2.0')[0]).toMatch(/no latest-mac.yml/)
})

it('prepare writes the checksums and the unversioned DMG, and lists every file to upload', () => {
  const dir = releaseDir()
  const files = prepare(dir, '0.2.0')
  expect(files.map((f) => f.slice(dir.length + 1))).toEqual(releaseAssets('0.2.0'))
  for (const file of files) expect(existsSync(file)).toBe(true)
  expect(readFileSync(join(dir, 'Kothar-arm64.dmg'), 'utf8')).toBe('dmg bytes')
  expect(readFileSync(join(dir, 'Kothar-arm64.dmg.sha256'), 'utf8')).toMatch(/^[0-9a-f]{64} {2}Kothar-arm64\.dmg\n$/)
})

it('prepare stops on a bad feed before writing anything', () => {
  const dir = releaseDir()
  expect(() => prepare(dir, '0.3.0')).toThrow(/Kothar-0.3.0-arm64.dmg isn't in/)
  expect(existsSync(join(dir, 'Kothar-arm64.dmg'))).toBe(false)
})

it('creates the release, as a pre-release for a hyphenated tag, or adds to one that exists', () => {
  expect(ghArgs('v0.2.0', ['a', 'b'], false)).toEqual([
    'release', 'create', 'v0.2.0', 'a', 'b', '--verify-tag', '--generate-notes', '--title', 'Kothar 0.2.0',
  ])
  expect(ghArgs('v0.2.0-beta.1', ['a'], false).at(-1)).toBe('--prerelease')
  expect(ghArgs('v0.2.0', ['a'], true)).toEqual(['release', 'upload', 'v0.2.0', 'a', '--clobber'])
})
