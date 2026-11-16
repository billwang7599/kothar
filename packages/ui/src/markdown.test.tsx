// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { domAnimation, LazyMotion } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { COPIED_MS } from './controls.tsx'
import { Markdown } from './markdown.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const markdown = (text: string) => (
  <LazyMotion features={domAnimation} strict>
    <Tooltip.Provider delayDuration={0}>
      <Markdown className="assistant" text={text} />
    </Tooltip.Provider>
  </LazyMotion>
)
const render = (text: string) => renderToStaticMarkup(markdown(text))

test('renders emphasis, fenced code and GFM tables', () => {
  const html = render('Some **bold** text.\n\n```ts\nconst x = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |')
  expect(html).toContain('<strong>bold</strong>')
  expect(html).toMatch(/<pre><code[^>]*>const x = 1\n<\/code><\/pre>/)
  expect(html).toContain('<table>')
})

test('opens links outside the app', () => {
  expect(render('[docs](https://example.com)')).toContain(
    '<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>',
  )
})

test('never renders raw HTML', () => {
  const html = render('hi <script>alert(1)</script> there')
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})

test('<br> in a table cell or paragraph is a line break', () => {
  const html = render('| grid |\n|---|\n| `1 2 3`<br>`4 5 6`<br/>`7 8 9` |\n\none<BR />two')
  expect(html).toContain('<td><code>1 2 3</code><br/>\n<code>4 5 6</code><br/>\n<code>7 8 9</code></td>')
  expect(html).toContain('one<br/>\ntwo')
  expect(html).not.toContain('&lt;br')
})

test('<br> inside code stays literal', () => {
  const html = render('`a<br>b`\n\n```\nx<br>y\n```')
  expect(html).toContain('<code>a&lt;br&gt;b</code>')
  expect(html).toContain('x&lt;br&gt;y')
})

test('other HTML tags still render as text, next to a <br>', () => {
  const html = render('<b>bold</b><br><img src=x onerror=alert(1)>')
  expect(html).not.toContain('<b>')
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;<br/>\n&lt;img')
})

test('entities, strikethrough and task lists', () => {
  const html = render('a&nbsp;b &lt;tag&gt; ~~gone~~\n\n- [x] done\n- [ ] todo')
  expect(html).toContain('a\u00a0b &lt;tag&gt; <del>gone</del>')
  expect(html).toContain('<li class="task-list-item"><input type="checkbox" disabled="" checked=""/> done</li>')
})

let root: Root
let container: HTMLElement
const setClipboard = (clipboard?: Partial<Clipboard>) =>
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
const copyButton = () => container.querySelector<HTMLButtonElement>('pre')!.parentElement!.querySelector('button')!
const label = () => copyButton().getAttribute('aria-label')

beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (navigator as unknown as Record<string, unknown>).clipboard
  vi.useRealTimers()
})

test('only code blocks get a copy button, not inline code', () => {
  act(() => root.render(markdown('Use `npm ci` first.')))
  expect(container.querySelector('button')).toBeNull()
  act(() => root.render(markdown('Run:\n\n```sh\nnpm ci\n```\n\nThen:\n\n    npm test')))
  expect([...container.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
    'Copy code',
    'Copy code',
  ])
})

test('a code block copies its raw code without the fence, then shows Copied for a moment', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const writeText = vi.fn().mockResolvedValue(undefined)
  setClipboard({ writeText })
  act(() => root.render(markdown('Run:\n\n```sh\nnpm ci\nnpm test\n```')))
  expect(label()).toBe('Copy code')
  await act(async () => copyButton().click())
  expect(writeText).toHaveBeenCalledWith('npm ci\nnpm test')
  expect(label()).toBe('Copied')
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Copied')
  act(() => vi.advanceTimersByTime(COPIED_MS - 1))
  expect(label()).toBe('Copied')
  act(() => vi.advanceTimersByTime(1))
  expect(label()).toBe('Copy code')
})

test('a copy that fails says so on the button instead of throwing', async () => {
  for (const clipboard of [{ writeText: vi.fn().mockRejectedValue(new Error('denied')) }, undefined]) {
    setClipboard(clipboard)
    act(() => root.render(<></>))
    act(() => root.render(markdown('```\nx\n```')))
    await act(async () => copyButton().click())
    expect(label()).toBe("Couldn't copy")
  }
})

test('renders display math in both styles', () => {
  for (const text of ['$$\nx^2 + y^2\n$$', '\\[\nx^2 + y^2\n\\]', '$$x^2 + y^2$$']) {
    const html = render(text)
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain('$$')
  }
})

test('renders inline math in both styles', () => {
  for (const text of ['so $x^2$ grows', 'so \\(x^2\\) grows']) {
    const html = render(text)
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('katex-display')
    expect(html).toContain('so ')
    expect(html).toContain(' grows')
  }
})

test('keeps the underscores in a formula rather than reading them as italics', () => {
  const html = render('$$\n{l:r} = \\frac{1}{r_{wp}} \\sum_{i} a_i b_i\n$$')
  expect(html).not.toContain('<em>')
  // The MathML copy keeps the TeX source.
  expect(html).toContain('r_{wp}')
})

test('leaves dollar amounts as text', () => {
  const html = render('It costs $5 and $10, or $1,200.50 in total.')
  expect(html).not.toContain('katex')
  expect(html).toContain('It costs $5 and $10, or $1,200.50 in total.')
})

test('leaves math in code as code', () => {
  const html = render('Run `echo $x$` then:\n\n```\n$$\na_1\n$$\n```')
  expect(html).not.toContain('katex')
  expect(html).toContain('<code>echo $x$</code>')
  expect(html).toContain('$$\na_1\n$$')
})

test('a $$ block still streaming stays text until it closes', () => {
  const partial = render('The ratio:\n\n$$\n\\frac{1}{r_')
  expect(partial).not.toContain('katex')
  expect(partial).toContain('$$')
  expect(render('The ratio:\n\n$$\n\\frac{1}{r_{wp}}\n$$')).toContain('katex-display')
})

test('shows a formula KaTeX cannot read as its source, in red, without throwing', () => {
  const html = render('$$\n\\frac{1}{\n$$\n\nand $\\notacommand{x}$ after')
  expect(html).toContain('katex-error')
  expect(html).toContain('var(--red)')
  expect(html).toContain('\\notacommand{x}')
  expect(html).toContain('after')
})

test('never runs \\href from a formula', () => {
  const html = render('$\\href{https://example.com}{x}$')
  expect(html).not.toContain('href="https://example.com"')
})
