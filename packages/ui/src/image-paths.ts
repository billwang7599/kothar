import { keptRanges } from './math.ts'

// Agents write `![caption](/Users/me/Library/Application Support/…/shot.png)`. Markdown ends a link's destination at
// its first space, so a path with a space stays raw text and the picture never shows. Before parsing, imagePathText
// wraps such a path in angle brackets (`![caption](</Users/me/…/shot.png>)`), the form Markdown reads with spaces.
// Only images whose destination is a local file (/…, ~/… or file://…) ending in a picture's extension, with a space in
// it, are touched; an optional "title" may follow. Code (spans and blocks), HTML, autolinks, web addresses, paths
// already in angle brackets and %20-encoded paths are left exactly as written. A reply still streaming stays text
// until its closing parenthesis arrives, so it never shows a half-read image.

const EXTENSIONS = 'png|jpe?g|gif|webp|svg|avif|heic|heif|bmp|ico|tiff?'
const IMAGE = new RegExp(
  `!\\[([^\\]\\n]*)\\]\\([ \\t]*((?:/|~/|file://)[^\\n<>()]*?\\.(?:${EXTENSIONS}))((?:[ \\t]+"[^"\\n]*")?)[ \\t]*\\)`,
  'gi',
)

/** The text with each local image path that has a space in it wrapped in angle brackets, so it parses as an image. */
export function imagePathText(text: string): string {
  if (!text.includes('](')) return text
  const found = [...text.matchAll(IMAGE)].filter((match) => /\s/.test(match[2]!))
  if (!found.length) return text
  // Parsed only when there's something to rewrite: most replies have no such image.
  const { inline, block } = keptRanges(text)
  const kept = [...inline, ...block]
  let out = ''
  let at = 0
  for (const match of found) {
    const start = match.index
    if (kept.some(([from, to]) => start < to && start + match[0].length > from)) continue
    const [, alt, path, title] = match
    out += `${text.slice(at, start)}![${alt}](<${path}>${title})`
    at = start + match[0].length
  }
  return out + text.slice(at)
}
