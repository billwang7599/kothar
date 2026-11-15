import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { PluggableList } from 'unified'
import { keepImageSrc, MarkdownImage } from './chat-image.tsx'
import { CopyBlock } from './controls.tsx'
import { FileLink } from './file-links.tsx'
import { codeRef, fileRefsIn, type FileRef } from './file-refs.ts'
import { KATEX_OPTIONS, mathText } from './math.ts'

// Agents often write `<br>` for a line break, mostly inside table cells where Markdown has no other way to break a
// line. Raw HTML stays text (agent output is untrusted), so turn just that one tag into a real break. Code spans and
// code blocks are their own node types, so a `<br>` inside them stays literal.
type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> }
const BR = /^<br\s*\/?>$/i
const PHRASING_PARENTS = new Set(['paragraph', 'heading', 'tableCell', 'emphasis', 'strong', 'delete', 'link'])
const brToBreak = (node: MdNode) => {
  for (const [i, child] of (node.children ?? []).entries()) {
    if (child.type === 'html' && PHRASING_PARENTS.has(node.type) && BR.test(child.value?.trim() ?? ''))
      node.children![i] = { type: 'break' }
    else brToBreak(child)
  }
}
const remarkBr = () => brToBreak

// File paths in text and whole code spans become a span marked with the path, which renders as a FileLink. Links,
// code blocks and HTML are left alone.
const refNode = ({ path, line, col }: Omit<FileRef, 'start' | 'end'>, children: MdNode[]): MdNode => ({
  type: 'fileRef',
  children,
  data: { hName: 'span', hProperties: { dataFileRef: path, dataLine: line, dataCol: col } },
})
const SKIPPED = new Set(['link', 'linkReference', 'code', 'html', 'definition', 'fileRef'])
const markRefs = (node: MdNode) => {
  if (!node.children) return
  node.children = node.children.flatMap((child): MdNode[] => {
    if (child.type === 'inlineCode') {
      const ref = codeRef(child.value ?? '')
      return ref ? [refNode(ref, [child])] : [child]
    }
    if (child.type !== 'text') {
      if (!SKIPPED.has(child.type)) markRefs(child)
      return [child]
    }
    const text = child.value ?? ''
    const refs = fileRefsIn(text)
    if (!refs.length) return [child]
    const parts: MdNode[] = []
    let at = 0
    for (const ref of refs) {
      if (ref.start > at) parts.push({ type: 'text', value: text.slice(at, ref.start) })
      parts.push(refNode(ref, [{ type: 'text', value: text.slice(ref.start, ref.end) }]))
      at = ref.end
    }
    if (at < text.length) parts.push({ type: 'text', value: text.slice(at) })
    return parts
  })
}
const remarkFileRefs = () => markRefs

// Math nodes are their own type, so file refs never reach inside a formula. mathText (math.ts) has already escaped
// every $ that isn't math, so a lone $ pair is safe to read as math.
const remarkPlugins: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: true }], remarkBr, remarkFileRefs]
// KATEX_OPTIONS: a bad formula shows its source in red, and trust stays off (no \href from agent output).
const rehypePlugins: PluggableList = [[rehypeKatex, KATEX_OPTIONS]]

const numberOf = (value: unknown) => (value === undefined || value === '' ? undefined : Number(value) || undefined)

type HastNode = NonNullable<ExtraProps['node']>['children'][number]
const textOf = (node: HastNode): string =>
  'value' in node ? node.value : 'children' in node ? node.children.map(textOf).join('') : ''

// An image's src stays as written (a local path or file:// would otherwise be dropped): MarkdownImage decides what
// it may show. Every other URL is cleaned as usual.
const urlTransform = keepImageSrc(defaultUrlTransform)

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  img: ({ src, alt }) => (typeof src === 'string' && src ? <MarkdownImage src={src} alt={alt ?? ''} /> : null),
  span: ({ node: _node, ...props }) => {
    const { 'data-file-ref': path, 'data-line': line, 'data-col': col, ...rest } = props as typeof props & Record<`data-${string}`, unknown>
    if (typeof path !== 'string') return <span {...rest} />
    return (
      <FileLink path={path} line={numberOf(line)} col={numberOf(col)}>
        {rest.children}
      </FileLink>
    )
  },
  // The renderer ends every code block with a newline the fence never had.
  pre: ({ node, ...props }) => (
    <CopyBlock className="code-block" label="Copy code" text={node ? textOf(node).replace(/\n$/, '') : ''}>
      <pre {...props} />
    </CopyBlock>
  ),
}

/** Rendered Markdown. Memoized: parsing is the costliest part of a transcript, and most texts never change. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className: string }) {
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} urlTransform={urlTransform}>
        {mathText(text)}
      </ReactMarkdown>
    </div>
  )
})
