// Where the Download buttons point. GitHub's /releases/latest/download/<name> always redirects to that file in the
// newest published (non-pre-release) release, and the release workflow uploads an unversioned Kothar-arm64.dmg to each
// release, so the buttons follow every new release with no site rebuild and no API call at build time.

export const REPO = 'https://github.com/billwang7599/kothar'
export const RELEASES = `${REPO}/releases`
export const DOWNLOAD = `${RELEASES}/latest/download/Kothar-arm64.dmg`

export interface Release {
  /** The newest release's DMG. */
  href: string
}

export function latestRelease(): Release {
  return { href: DOWNLOAD }
}
