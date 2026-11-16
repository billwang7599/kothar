import { expect, test } from 'vitest'
import { mathSpans, mathText } from './math.ts'

test('leaves text without math as it is', () => {
  expect(mathText('Plain **text**, no math.')).toBe('Plain **text**, no math.')
})

test('keeps a $…$ pair and a $$ block', () => {
  expect(mathText('the sum $a_1 + b_1$ here')).toBe('the sum $a_1 + b_1$ here')
  expect(mathText('$$\nx_1 = \\frac{1}{r_{wp}}\n$$')).toBe('$$\nx_1 = \\frac{1}{r_{wp}}\n$$')
})

test('puts a one-line $$…$$ on lines of its own, a full stop after it inside', () => {
  expect(mathText('$$E=mc^2$$')).toBe('$$\nE=mc^2\n$$')
  expect(mathText('$$E=mc^2$$.')).toBe('$$\nE=mc^2.\n$$')
  expect(mathText('  $$\n  a\n  $$')).toBe('  $$\n  a\n  $$')
})

test('leaves $$…$$ in the middle of a line to remark-math', () => {
  expect(mathText('- $$a$$ and $$b$$')).toBe('- $$a$$ and $$b$$')
})

test('turns \\[…\\] and \\(…\\) into dollars', () => {
  expect(mathText('\\[\n\\int_0^1 f\n\\]')).toBe('$$\n\\int_0^1 f\n$$')
  expect(mathText('\\[ x^2 \\]')).toBe('$$\nx^2\n$$')
  expect(mathText('a \\( x_1 \\) and \\[y_2\\] mid')).toBe('a $x_1$ and $$y_2$$ mid')
})

test('escapes dollar amounts', () => {
  expect(mathText('costs $5 and $10')).toBe('costs \\$5 and \\$10')
  expect(mathText('between $5-$10 and $1,200.50.')).toBe('between \\$5-\\$10 and \\$1,200.50.')
  expect(mathText('$3k now, $2.5M later')).toBe('\\$3k now, \\$2.5M later')
  expect(mathText('a lone $ sign')).toBe('a lone \\$ sign')
})

test('escapes shell variables that would pair up', () => {
  expect(mathText('HOME/bin:$PATH and $HOME')).toBe('HOME/bin:\\$PATH and \\$HOME')
})

test('keeps an escaped dollar escaped', () => {
  expect(mathText('price \\$5 is $x$')).toBe('price \\$5 is $x$')
})

test('a pair never spans paragraphs', () => {
  expect(mathText('$a\n\nb$')).toBe('\\$a\n\nb\\$')
})

test('leaves code and HTML exactly as written', () => {
  expect(mathText('run `echo $HOME and $PATH`')).toBe('run `echo $HOME and $PATH`')
  expect(mathText('```\n$x$ and $$\n\\(y\\)\n```\nafter $y$')).toBe('```\n$x$ and $$\n\\(y\\)\n```\nafter $y$')
  expect(mathText('text\n\n    indented $5 and $$\n')).toBe('text\n\n    indented $5 and $$\n')
  expect(mathText('see <https://example.com/$5> now')).toBe('see <https://example.com/$5> now')
})

test('an unclosed $$ (a reply still streaming) stays text', () => {
  expect(mathText('$$\nx_1 = \\frac{1}{2')).toBe('\\$\\$\nx_1 = \\frac{1}{2')
  expect(mathText('$$\\frac{1}{2')).toBe('\\$\\$\\frac{1}{2')
  expect(mathText('so $x + ')).toBe('so \\$x + ')
  expect(mathText('so \\(x + ')).toBe('so \\(x + ')
})

// What the Notes editor draws: [tex, display, source] for each formula.
const spans = (text: string) => mathSpans(text).map((s) => [s.tex, s.display, text.slice(s.from, s.to)])

test('mathSpans finds the formulas chat draws, in both delimiter styles', () => {
  expect(spans('$$\nx_1 = y\n$$')).toEqual([['x_1 = y', true, '$$\nx_1 = y\n$$']])
  expect(spans('\\[\n\\int f\n\\]')).toEqual([['\\int f', true, '\\[\n\\int f\n\\]']])
  expect(spans('$$E=mc^2$$.')).toEqual([['E=mc^2.', true, '$$E=mc^2$$.']])
  expect(spans('a $x_1$ and \\(y_2\\) and $$z$$ mid')).toEqual([
    ['x_1', false, '$x_1$'],
    ['y_2', false, '\\(y_2\\)'],
    ['z', false, '$$z$$'],
  ])
})

test('mathSpans leaves dollar amounts, code and an unclosed block alone', () => {
  expect(spans('costs $5 and $10, or $1,200.50, see $HOME:$PATH')).toEqual([])
  expect(spans('`$a$` and\n\n```\n$$\nb\n$$\n```')).toEqual([])
  expect(spans('$$\nx = 1 \\\\\ny = ')).toEqual([])
  expect(spans('no math here')).toEqual([])
})

test('mathSpans takes code ranges from the caller when it has them', () => {
  // The caller says the first formula is code, so only the second is math.
  expect(mathSpans('$a$ $b$', { inline: [[0, 3]], block: [] }).map((s) => s.tex)).toEqual(['b'])
})
