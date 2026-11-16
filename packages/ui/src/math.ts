import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

// Models write math four ways: $$…$$ and \[…\] for display, $…$ and \(…\) inline. remark-math reads only the dollar
// forms, and reads a lone $ as math wherever two of them meet, so "costs $5 and $10" would turn into a formula. Before
// parsing, mathText rewrites the text so remark-math sees exactly the math meant:
// - \[…\] and \(…\) become $$…$$ and $…$.
// - $$ on a line of its own (or starting one) opens a display block, put on lines of its own so it renders as one. A
//   block not yet closed (a reply still streaming) stays text: its $$ is escaped until the closing $$ arrives.
// - A lone $ counts only in pairs, by Pandoc's rule: the opening $ is followed by a non-space and isn't a money
//   amount ("$5 "), the closing one follows a non-space and isn't followed by a letter or digit. Every other lone $ is
//   escaped, so it stays a dollar sign.
// Code (fenced, indented and inline), raw HTML and autolinks are left exactly as written.

type Edit = { at: number; length: number; text: string }
type Range = [number, number]
/** One formula in a text: where it is (the delimiters included), its TeX and whether it's a display block. */
export type MathSpan = { from: number; to: number; tex: string; display: boolean }
/** Where a text may not be touched: inline code, HTML and autolinks (inline), code blocks (block). */
export type KeptRanges = { inline: Range[]; block: Range[] }

/**
 * KaTeX's options wherever Kothar draws math. A formula it can't read shows its source in the theme's red rather than
 * breaking the text. trust stays off: no \href, \url or \includegraphics.
 */
export const KATEX_OPTIONS = { throwOnError: false, errorColor: 'var(--red)', strict: 'ignore' } as const
type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] }

const parser = unified().use(remarkParse).use(remarkGfm)

// Inside these, a character is never math.
const KEPT = new Set(['code', 'inlineCode', 'html'])

// Where the text may not be touched: code, HTML and autolinks (a link whose source isn't "[…](…)").
export function keptRanges(text: string): KeptRanges {
  const inline: Range[] = []
  const block: Range[] = []
  const walk = (node: Node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) {
      if (node.type === 'code') {
        block.push([start, end])
        return
      }
      if (KEPT.has(node.type) || (node.type === 'link' && text[start] !== '[')) {
        inline.push([start, end])
        return
      }
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(parser.parse(text) as Node)
  return { inline, block }
}

// The text with kept characters blanked out (lines stay lines), so the scans below never see them: inline code as \uE000,
// block code as \uE001, which also ends a paragraph for pairing.
function masked(text: string, { inline, block }: KeptRanges) {
  const chars = text.split('')
  const blank = ([start, end]: Range, mark: string) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = mark
  }
  for (const range of inline) blank(range, '\uE000')
  for (const range of block) blank(range, '\uE001')
  return chars.join('')
}

// A backslash before i that isn't itself escaped.
const escaped = (text: string, i: number) => {
  let n = 0
  while (i - 1 - n >= 0 && text[i - 1 - n] === '\\') n++
  return n % 2 === 1
}

const lineStart = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1
const lineEnd = (text: string, i: number) => {
  const end = text.indexOf('\n', i)
  return end === -1 ? text.length : end
}
// Only spaces (at most three, as Markdown allows before a block) between the line's start and i.
const opensLine = (text: string, i: number) => /^ {0,3}$/.test(text.slice(lineStart(text, i), i))
const indentAt = (text: string, i: number) => text.slice(lineStart(text, i), i)

const inside = (ranges: Range[], i: number) => ranges.some(([start, end]) => i >= start && i < end)

// Display blocks, $$…$$ or \[…\], that start a line. Each becomes "$$\n…\n$$" on lines of its own.
function displayBlocks(text: string, edits: Edit[], done: Range[], spans: MathSpan[]) {
  const opener = /\$\$|\\\[/g
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    const at = match.index
    if (inside(done, at) || escaped(text, at) || !opensLine(text, at)) continue
    // A $$$ run isn't a fence of ours.
    if (match[0] === '$$' && (text[at + 2] === '$' || text[at - 1] === '$')) continue
    const close = match[0] === '$$' ? '$$' : '\\]'
    // The first closer decides: one ending its line (a full stop or comma may follow) ends the block; one with more
    // text after it makes this inline math, or no math, left to remark-math.
    let end = text.indexOf(close, at + 2)
    while (end !== -1 && (escaped(text, end) || (close === '$$' && text[end + 2] === '$'))) end = text.indexOf(close, end + 1)
    if (end === -1) {
      // Unclosed (still streaming, or a lone $$): text, not a block that runs to the end of the message.
      if (match[0] === '$$') edits.push({ at, length: 2, text: '\\$\\$' })
      continue
    }
    const tail = /^[ \t]*([.,;:]?)[ \t]*$/.exec(text.slice(end + 2, lineEnd(text, end)))
    const body = text.slice(at + 2, end)
    // A block of code or a blank line before the closer: it was never one block.
    if (!tail || /[\uE000\uE001]/.test(body) || /\n[ \t]*\n/.test(body)) continue
    const indent = indentAt(text, at)
    const inner = body.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
    const stop = tail[1] ?? ''
    edits.push({ at, length: lineEnd(text, end) - at, text: `$$\n${indent}${inner}${stop}\n${indent}$$` })
    done.push([at, lineEnd(text, end)])
    spans.push({ from: at, to: lineEnd(text, end), tex: `${inner}${stop}`, display: true })
    opener.lastIndex = lineEnd(text, end)
  }
}

// \[…\] in the middle of a line: math, though not on lines of its own, so remark-math's $$…$$ in text.
// \(…\) anywhere: inline math. Neither crosses a blank line or code.
function bracketPairs(text: string, edits: Edit[], done: Range[], spans: MathSpan[]) {
  const opener = /\\\(|\\\[/g
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    const at = match.index
    if (inside(done, at) || escaped(text, at)) continue
    const close = match[0] === '\\(' ? '\\)' : '\\]'
    let end = text.indexOf(close, at + 2)
    while (end !== -1 && escaped(text, end)) end = text.indexOf(close, end + 2)
    if (end === -1) continue
    const body = text.slice(at + 2, end)
    if (/[\uE000\uE001]/.test(body) || /\n[ \t]*\n/.test(body) || !body.trim()) continue
    const fence = match[0] === '\\(' ? '$' : '$$'
    edits.push({ at, length: end + 2 - at, text: `${fence}${body.trim()}${fence}` })
    done.push([at, end + 2])
    spans.push({ from: at, to: end + 2, tex: body.trim(), display: false })
    opener.lastIndex = end + 2
  }
}

// "$5", "$1,200.50", "$3k" followed by a space, punctuation or the end: an amount, not the start of math.
const MONEY = /\$\d[\d,]*(\.\d+)?[kKmMbB]?(?=[\s.,;:!?)\]/-]|$)/y
const money = (text: string, i: number) => ((MONEY.lastIndex = i), MONEY.test(text))
const BLANK = /\n[ \t]*\n/y
const blankAt = (text: string, i: number) => ((BLANK.lastIndex = i), BLANK.test(text))

// Lone dollars: kept in pairs that read as math, escaped otherwise.
function dollarPairs(text: string, edits: Edit[], done: Range[], spans: MathSpan[]) {
  const isLone = (i: number) => text[i] === '$' && text[i - 1] !== '$' && text[i + 1] !== '$' && !escaped(text, i) && !inside(done, i)
  const opens = (i: number) => /\S/.test(text[i + 1] ?? '') && !money(text, i)
  const closes = (i: number) => /\S/.test(text[i - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[i + 1] ?? '')
  for (let i = 0; i < text.length; i++) {
    if (!isLone(i)) continue
    let pair = -1
    if (opens(i)) {
      for (let j = i + 1; j < text.length; j++) {
        // A paragraph (blank line) or a code block ends the search.
        if (text[j] === '\uE001' || (text[j] === '\n' && blankAt(text, j))) break
        if (isLone(j) && j > i + 1 && closes(j)) {
          pair = j
          break
        }
      }
    }
    if (pair === -1) {
      edits.push({ at: i, length: 1, text: '\\$' })
      continue
    }
    const tex = text.slice(i + 1, pair)
    if (!/[\uE000\uE001]/.test(tex)) spans.push({ from: i, to: pair + 1, tex, display: false })
    i = pair
  }
}

// $$…$$ that doesn't open a line (or does, with more text after its closer): remark-math reads it as math in the
// text, needing no rewrite. Found so its inside isn't paired again, and so the editor draws it.
function textDoubles(text: string, done: Range[], spans: MathSpan[]) {
  const isFence = (i: number) => text.startsWith('$$', i) && text[i + 2] !== '$' && text[i - 1] !== '$' && !escaped(text, i)
  for (let i = text.indexOf('$$'); i !== -1; i = text.indexOf('$$', i + 1)) {
    if (inside(done, i) || !isFence(i)) continue
    let end = -1
    for (let j = i + 2; j < text.length; j++) {
      if (text[j] === '\uE001' || (text[j] === '\n' && blankAt(text, j))) break
      if (isFence(j)) {
        end = j
        break
      }
    }
    if (end === -1) continue
    const tex = text.slice(i + 2, end)
    if (tex.trim() && !/[\uE000\uE001]/.test(tex)) {
      done.push([i, end + 2])
      spans.push({ from: i, to: end + 2, tex: tex.trim(), display: false })
    }
    i = end + 1
  }
}

function scan(text: string, kept: KeptRanges) {
  const masks = masked(text, kept)
  const edits: Edit[] = []
  const done: Range[] = []
  const spans: MathSpan[] = []
  displayBlocks(masks, edits, done, spans)
  bracketPairs(masks, edits, done, spans)
  textDoubles(masks, done, spans)
  dollarPairs(masks, edits, done, spans)
  return { edits, spans: spans.sort((a, b) => a.from - b.from) }
}

/** The text with its math written the way remark-math reads it, and every dollar that isn't math escaped. */
export function mathText(text: string): string {
  if (!/[$\\]/.test(text)) return text
  const { edits } = scan(text, keptRanges(text))
  if (!edits.length) return text
  edits.sort((a, b) => a.at - b.at)
  let out = ''
  let at = 0
  for (const edit of edits) {
    if (edit.at < at) continue
    out += text.slice(at, edit.at) + edit.text
    at = edit.at + edit.length
  }
  return out + text.slice(at)
}

/**
 * The formulas in a text, by the same rules as mathText, in order: what chat draws as math, the Notes editor draws
 * too. kept: where code, HTML and autolinks are, when the caller already knows (the editor, from its own syntax tree);
 * otherwise the text is parsed for them.
 */
export function mathSpans(text: string, kept: KeptRanges = keptRanges(text)): MathSpan[] {
  if (!/[$\\]/.test(text)) return []
  return scan(text, kept).spans
}
