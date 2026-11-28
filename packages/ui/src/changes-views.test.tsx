// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ExtensionAction, ExtensionView } from '@kothar/extension-api'
import { Tooltip } from 'radix-ui'
import { ExtensionViewer } from './extension-view.tsx'
import { diffLines } from './diff-view.tsx'
import { currentPopup, openPopup } from './panel-tab.ts'
import { splitPath } from './path-label.tsx'

// The views the Changes tab and its pop-out are drawn with: path rows, flat sections, a pop-out button and a diff with
// comments.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  openPopup(null)
})

const draw = (view: ExtensionView, acted: ExtensionAction[] = [], extension = 'git') =>
  act(() =>
    root.render(
      <Tooltip.Provider>
        <ExtensionViewer view={view} act={(a) => acted.push(a)} extension={extension} />
      </Tooltip.Provider>,
    ),
  )

test('a path splits into its folders and its name', () => {
  expect(splitPath('extensions/browser/package.json')).toEqual({ dir: 'extensions/browser/', name: 'package.json' })
  expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  expect(splitPath('a/b/')).toEqual({ dir: 'a/', name: 'b' })
})

test("a path row cuts its folders from the left and never pushes its counts off the row", () => {
  draw({
    type: 'list',
    items: [{ key: 'a', label: 'extensions/account-rotation/package.json', path: true, detail: '+12 −3' }],
  })
  const path = host.querySelector('[data-path]')!
  expect(path.getAttribute('title')).toBe('extensions/account-rotation/package.json')
  const dir = path.querySelector('[data-path-dir]')!
  // Right to left, so the ellipsis is at the start and the end of the folders stays; it gives way first.
  expect(dir.className).toContain('[direction:rtl]')
  expect(dir.className).toContain('truncate')
  expect(dir.className).toContain('shrink-[1000]')
  expect(dir.textContent).toBe('\u200eextensions/account-rotation/\u200e')
  expect(path.querySelector('[data-path-name]')!.textContent).toBe('package.json')
  expect(path.className).toContain('min-w-0')
  expect(host.querySelector('[data-detail]')!.textContent).toBe('+12 −3')
})

test('a section is a flat header that folds, cuts its title and long badges, and has buttons at its end', () => {
  const acted: ExtensionAction[] = []
  const branch = 'kothar-worker/kothar/4603242d-remove-the-hard-size-limit-on'
  draw(
    {
      type: 'section',
      title: 'kothar · worker Remove the hard size limit on attachments (to review)',
      badges: [{ text: branch }],
      buttons: [{ type: 'button', label: 'Pop out', action: { name: 'popout' }, popup: 'changes-review' }],
      children: [{ type: 'text', text: 'Inside' }],
    },
    acted,
  )
  const section = host.querySelector('section[data-section]')!
  expect(section.className).toContain('border-t')
  expect(section.className).not.toContain('rounded')
  const title = section.querySelector('button[aria-expanded] span.truncate')!
  expect(title.getAttribute('title')).toContain('Remove the hard size limit')
  const badge = [...section.querySelectorAll('[data-badges] span')].find((s) => s.textContent === branch)!
  expect(badge.className).toContain('truncate')
  expect(badge.className).toContain('max-w-full')
  expect(host.textContent).toContain('Inside')
  // The pop-out button sends its action, then opens the extension's popup.
  const popout = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Pop out')!
  act(() => popout.click())
  return new Promise<void>((done) =>
    setTimeout(() => {
      expect(acted).toEqual([{ name: 'popout' }])
      expect(currentPopup()).toBe('extension:git/changes-review')
      act(() => (section.querySelector('button[aria-expanded]') as HTMLButtonElement).click())
      expect(host.textContent).not.toContain('Inside')
      done()
    }),
  )
})

const DIFF = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'].join('\n')

test('a diff numbers its lines from the hunk header and wraps instead of scrolling sideways', () => {
  expect(diffLines(DIFF).map((l) => [l.kind, l.old, l.new])).toEqual([
    ['meta', undefined, undefined],
    ['meta', undefined, undefined],
    ['meta', undefined, undefined],
    ['hunk', undefined, undefined],
    ['context', 1, 1],
    ['del', 2, undefined],
    ['add', undefined, 2],
    ['context', 3, 3],
  ])
  draw({ type: 'diff', key: 'k', text: DIFF })
  const box = host.querySelector('[data-diff]')!
  expect(box.className).toContain('overflow-x-hidden')
  expect(host.querySelector('[data-line="6"] span:last-child')!.className).toContain('whitespace-pre-wrap')
  expect(host.querySelector('[data-line="6"] span')!.textContent).toBe('2')
  // Without a comment action, lines can't be picked.
  act(() => (host.querySelector('[data-line="6"]') as HTMLElement).click())
  expect(host.querySelector('textarea')).toBeNull()
})

const type = (box: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!

test('the user comments on a line or a Shift-clicked range, and edits and deletes comments', () => {
  const acted: ExtensionAction[] = []
  const node: ExtensionView = { type: 'diff', key: 'k2', text: DIFF, comment: 'comment', remove: 'uncomment' }
  draw(node, acted)
  // A hunk header takes no comment.
  act(() => (host.querySelector('[data-line="3"]') as HTMLElement).click())
  expect(host.querySelector('textarea')).toBeNull()
  act(() => (host.querySelector('[data-line="5"]') as HTMLElement).click())
  act(() => (host.querySelector('[data-line="6"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const box = host.querySelector('textarea')!
  expect(box.getAttribute('aria-label')).toBe('Comment on these lines')
  // The box sits under the range's last line.
  expect(box.closest('[role=listitem]')!.querySelector('[data-line]')!.getAttribute('data-line')).toBe('6')
  type(box, '  Lower case  ')
  act(() => button('Save').click())
  expect(acted).toEqual([{ name: 'comment', value: { start: 5, end: 6, text: 'Lower case' } }])
  expect(host.querySelector('textarea')).toBeNull()

  // The extension sends it back: drawn under its last line, with Edit and Delete.
  draw({ ...node, comments: [{ id: 'c1', text: 'Lower case', start: 5, end: 6 }, { id: 'c2', text: 'Old one', label: 'a.txt, line 9' }] }, acted)
  const drawn = host.querySelector('[data-comment="c1"]')!
  expect(drawn.closest('[role=listitem]')!.querySelector('[data-line]')!.getAttribute('data-line')).toBe('6')
  expect(host.textContent).toContain('On lines no longer in this diff')
  expect(host.querySelector('[data-comment="c2"]')!.textContent).toContain('a.txt, line 9')
  act(() => (drawn.querySelector('button') as HTMLButtonElement).click())
  const edit = host.querySelector('textarea[aria-label="Edit comment"]') as HTMLTextAreaElement
  expect(edit.value).toBe('Lower case')
  type(edit, 'Lower case, please')
  act(() => button('Save').click())
  act(() => ([...host.querySelectorAll('[data-comment="c2"] button')].find((b) => b.textContent === 'Delete') as HTMLButtonElement).click())
  expect(acted.slice(1)).toEqual([
    { name: 'comment', value: { id: 'c1', text: 'Lower case, please' } },
    { name: 'uncomment', value: 'c2' },
  ])
})

test('a half-written comment survives the view drawing again', () => {
  const node: ExtensionView = { type: 'diff', key: 'k3', text: DIFF, comment: 'comment' }
  draw(node)
  act(() => (host.querySelector('[data-line="7"]') as HTMLElement).click())
  type(host.querySelector('textarea')!, 'Half')
  act(() => root.render(<></>))
  draw(node)
  expect(host.querySelector('textarea')!.value).toBe('Half')
})
