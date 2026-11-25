import { describe, expect, it, vi } from 'vitest'
import * as signing from './signing.ts'
import type { Plan, Probe, Run } from './signing.ts'

const probe = (identities: string[] = [], profiles: string[] = []): Probe => ({
  identities: () => identities,
  hasNotaryProfile: (profile) => profiles.includes(profile),
})
const ME = 'Bill Wang (AB12CD34EF)'
const APPLE_ID = { APPLE_ID: 'me@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop', APPLE_TEAM_ID: 'AB12CD34EF' }

describe('developerIds', () => {
  it('reads Developer ID Application names from security find-identity, without the prefix', () => {
    const output = [
      '  1) 1111111111111111111111111111111111111111 "Apple Development: me@example.com (XYZ)"',
      `  2) 2222222222222222222222222222222222222222 "Developer ID Application: ${ME}"`,
      `  3) 3333333333333333333333333333333333333333 "Developer ID Installer: ${ME}"`,
      '     3 valid identities found',
    ].join('\n')
    expect(signing.developerIds(output)).toEqual([ME])
  })
})

describe('signingPlan', () => {
  it('builds unsigned, with one line saying so, when there is no certificate', () => {
    const plan = signing.signingPlan({}, probe())
    expect(plan).toMatchObject({ signed: false, identity: '-', notary: null })
    expect(plan.message).toMatch(/^Kothar will be UNSIGNED/)
    expect(plan.message.split('\n')).toHaveLength(1)
  })

  it('signs with the one Developer ID in the keychain and notarizes with the kothar-notary profile', () => {
    const plan = signing.signingPlan({}, probe([ME], ['kothar-notary']))
    expect(plan).toMatchObject({ signed: true, identity: ME, notary: { kind: 'profile', profile: 'kothar-notary' } })
    expect(plan.message).toContain(`"Developer ID Application: ${ME}"`)
    expect(plan.message).toContain('"kothar-notary"')
  })

  it('signs but warns it is not notarized without any notary credentials', () => {
    const plan = signing.signingPlan({}, probe([ME]))
    expect(plan).toMatchObject({ signed: true, notary: null })
    expect(plan.message).toContain('NOT notarized')
  })

  it('stays unsigned when KOTHAR_UNSIGNED is set, even with a certificate', () => {
    expect(signing.signingPlan({ KOTHAR_UNSIGNED: '1' }, probe([ME], ['kothar-notary'])).signed).toBe(false)
  })

  it('asks for CSC_NAME when several certificates are installed, and uses it without the prefix', () => {
    const two = probe([ME, 'Other (ZZZ)'])
    expect(() => signing.signingPlan({}, two)).toThrow(/CSC_NAME/)
    expect(signing.signingPlan({ CSC_NAME: `Developer ID Application: ${ME}` }, two).identity).toBe(ME)
  })

  it('leaves the identity to electron-builder for a CSC_LINK certificate', () => {
    const plan = signing.signingPlan({ CSC_LINK: '/certs/kothar.p12', CSC_KEY_PASSWORD: 'x' }, probe())
    expect(plan).toMatchObject({ signed: true, identity: undefined })
  })

  it('prefers the keychain profile over Apple ID variables, and falls back to them', () => {
    expect(signing.signingPlan(APPLE_ID, probe([ME], ['kothar-notary'])).notary).toEqual({ kind: 'profile', profile: 'kothar-notary' })
    expect(signing.signingPlan(APPLE_ID, probe([ME])).notary).toEqual({
      kind: 'apple-id',
      appleId: 'me@example.com',
      password: 'abcd-efgh-ijkl-mnop',
      teamId: 'AB12CD34EF',
    })
  })

  it('uses a named profile from APPLE_KEYCHAIN_PROFILE or KOTHAR_NOTARY_PROFILE', () => {
    expect(signing.signingPlan({ APPLE_KEYCHAIN_PROFILE: 'ci', APPLE_KEYCHAIN: '/k.keychain-db' }, probe([ME])).notary).toEqual({
      kind: 'profile',
      profile: 'ci',
      keychain: '/k.keychain-db',
    })
    expect(signing.signingPlan({ KOTHAR_NOTARY_PROFILE: 'mine' }, probe([ME], ['mine'])).notary).toEqual({ kind: 'profile', profile: 'mine' })
    expect(() => signing.signingPlan({ KOTHAR_NOTARY_PROFILE: 'missing' }, probe([ME]))).toThrow(/No notarytool profile "missing"/)
  })

  it('uses an App Store Connect API key', () => {
    const env = { APPLE_API_KEY: '/k/AuthKey.p8', APPLE_API_KEY_ID: 'KEY', APPLE_API_ISSUER: 'ISS' }
    expect(signing.signingPlan(env, probe([ME])).notary).toEqual({ kind: 'api-key', key: '/k/AuthKey.p8', keyId: 'KEY', issuer: 'ISS' })
  })

  it('stops on a half-set group of Apple variables instead of skipping notarization', () => {
    expect(() => signing.signingPlan({ APPLE_ID: 'me@example.com' }, probe([ME]))).toThrow(
      'APPLE_ID is set, but not APPLE_APP_SPECIFIC_PASSWORD or APPLE_TEAM_ID',
    )
  })
})

describe('notarytool arguments', () => {
  it('submits with a keychain profile and waits for a JSON verdict', () => {
    expect(signing.submitArgs('/r/Kothar.dmg', { kind: 'profile', profile: 'kothar-notary' })).toEqual([
      'notarytool', 'submit', '/r/Kothar.dmg', '--keychain-profile', 'kothar-notary', '--wait', '--output-format', 'json',
    ])
    expect(signing.submitArgs('/a.zip', { kind: 'profile', profile: 'p', keychain: '/k' })).toContain('--keychain')
  })

  it('submits with an Apple ID and an API key, and hides the password when printing', () => {
    const args = signing.submitArgs('/a.zip', { kind: 'apple-id', appleId: 'me@example.com', password: 'secret-pw', teamId: 'T' })
    expect(args).toEqual(['notarytool', 'submit', '/a.zip', '--apple-id', 'me@example.com', '--password', 'secret-pw', '--team-id', 'T', '--wait', '--output-format', 'json'])
    expect(signing.shown('xcrun', args)).not.toContain('secret-pw')
    expect(signing.submitArgs('/a.zip', { kind: 'api-key', key: '/k.p8', keyId: 'K', issuer: 'I' }).slice(3, 9)).toEqual([
      '--key', '/k.p8', '--key-id', 'K', '--issuer', 'I',
    ])
  })

  it('staples with xcrun stapler', () => {
    expect(signing.stapleArgs('/r/Kothar.dmg')).toEqual(['stapler', 'staple', '/r/Kothar.dmg'])
  })

  it('reads the verdict from the last JSON line', () => {
    expect(signing.parseSubmit('Conducting pre-submission checks...\n{"id":"abc","status":"Accepted"}\n')).toEqual({
      id: 'abc',
      status: 'Accepted',
      accepted: true,
    })
    expect(signing.parseSubmit('{"id":"abc","status":"Invalid"}').accepted).toBe(false)
  })
})

describe('hooks', () => {
  const notarized: Plan = { signed: true, identity: ME, notary: { kind: 'profile', profile: 'kothar-notary' }, message: '' }
  const context = { electronPlatformName: 'darwin', appOutDir: '/out/mac-arm64', packager: { appInfo: { productFilename: 'Kothar' } } }
  const accepting = () => vi.fn<Run>((_command, args) => (args[1] === 'submit' ? '{"id":"abc","status":"Accepted"}' : ''))

  it('zips, notarizes and staples the app after signing', async () => {
    const run = accepting()
    await signing.afterSign(notarized, run)(context)
    expect(run.mock.calls.map(([command, args]) => [command, args[0], args[1]])).toEqual([
      ['ditto', '-c', '-k'],
      ['xcrun', 'notarytool', 'submit'],
      ['xcrun', 'stapler', 'staple'],
    ])
    expect(run.mock.calls[2]?.[1]).toEqual(['stapler', 'staple', '/out/mac-arm64/Kothar.app'])
  })

  it('notarizes and staples each DMG, and nothing else', async () => {
    const run = accepting()
    await signing.afterAllArtifactBuild(notarized, run)({ artifactPaths: ['/r/Kothar.dmg', '/r/Kothar.dmg.blockmap'] })
    expect(run.mock.calls.map(([, args]) => args.slice(0, 3))).toEqual([
      ['notarytool', 'submit', '/r/Kothar.dmg'],
      ['stapler', 'staple', '/r/Kothar.dmg'],
    ])
  })

  it('fails the build with Apple’s log when the submission is rejected', async () => {
    const run = vi.fn<Run>((_command, args) =>
      args[1] === 'submit' ? '{"id":"abc","status":"Invalid"}' : args[1] === 'log' ? '{"issues":["not signed"]}' : '',
    )
    await expect(signing.afterAllArtifactBuild(notarized, run)({ artifactPaths: ['/r/Kothar.dmg'] })).rejects.toThrow(
      /answered "Invalid".*\n.*not signed/s,
    )
    expect(run.mock.calls.some(([, args]) => args[1] === 'staple')).toBe(false)
  })

  it('runs nothing for an unsigned or unnotarized build', async () => {
    const run = accepting()
    const unsigned = signing.signingPlan({}, probe())
    await signing.afterSign(unsigned, run)(context)
    await signing.afterAllArtifactBuild({ ...notarized, notary: null }, run)({ artifactPaths: ['/r/Kothar.dmg'] })
    expect(run).not.toHaveBeenCalled()
  })
})
