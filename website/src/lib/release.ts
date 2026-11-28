// The latest published release, fetched once at build time so the Download buttons point straight at the DMG.
// Any failure (offline, rate limit, no release yet) falls back to the Releases page so the build never breaks.

export const REPO = 'https://github.com/billwang7599/kothar'
export const RELEASES = `${REPO}/releases`

export interface Release {
  /** Direct DMG link, or the Releases page when none was found. */
  href: string
  /** e.g. "v0.1.0", or undefined on fallback. */
  version?: string
}

interface ApiAsset {
  name: string
  browser_download_url: string
}

let cached: Promise<Release> | undefined

async function fetchLatest(): Promise<Release> {
  try {
    const res = await fetch('https://api.github.com/repos/billwang7599/kothar/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kothar-website-build' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as { tag_name?: string; assets?: ApiAsset[] }
    const dmg = data.assets?.find((a) => a.name.endsWith('-arm64.dmg'))
    if (!dmg) throw new Error('no arm64 DMG in the latest release')
    return { href: dmg.browser_download_url, version: data.tag_name }
  } catch (err) {
    console.warn(`[release] falling back to the Releases page: ${(err as Error).message}`)
    return { href: RELEASES }
  }
}

export function latestRelease(): Promise<Release> {
  cached ??= fetchLatest()
  return cached
}
