// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ExtensionAction, ExtensionView } from '@kothar/extension-api'
import { Tooltip } from 'radix-ui'
import { ExtensionViewer, Marked } from './extension-view.tsx'

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
})

test('marked text highlights its ranges, and odd ranges never lose or reorder text', () => {
  expect(renderToStaticMarkup(<Marked text="Groceries" marks={[[0, 3]]} />)).toBe('<mark class="rounded-sm bg-accent/25 text-inherit">Gro</mark>ceries')
  // Unsorted, overlapping, out of range and not numbers.
  const odd = [[5, 99], [1, 3], [2, 6], [-4, 0], ['x', 2]] as unknown as [number, number][]
  const html = renderToStaticMarkup(<Marked text="abcdefgh" marks={odd} />)
  expect(html.replace(/<[^>]+>/g, '')).toBe('abcdefgh')
  expect([...html.matchAll(/<mark[^>]*>([^<]*)<\/mark>/g)].map((m) => m[1])).toEqual(['bc', 'def', 'gh'])
})

test('a list row shows its excerpt with marks and its extra button, which the arrows skip', () => {
  const acted: ExtensionAction[] = []
  const view: ExtensionView = {
    type: 'stack',
    children: [
      { type: 'search', action: 'search', placeholder: 'Search' },
      {
        type: 'list',
        label: 'Notes',
        items: [
          {
            key: 'a',
            label: 'Groceries',
            marks: [[0, 3]],
            excerpt: { text: '…buy milk today', marks: [[5, 9]] },
            action: { name: 'open', value: 'a' },
            button: { label: 'Link', action: { name: 'link', value: 'a' } },
          },
          { key: 'b', label: 'Plans', action: { name: 'open', value: 'b' } },
        ],
      },
    ],
  }
  act(() => root.render(<Tooltip.Provider><ExtensionViewer view={view} act={(a) => acted.push(a)} /></Tooltip.Provider>))
  expect(host.querySelector('[data-excerpt]')!.innerHTML).toContain('<mark class="rounded-sm bg-accent/25 text-inherit">milk</mark>')
  expect([...host.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Gro', 'milk'])
  const link = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Link')!
  act(() => link.click())
  expect(acted).toEqual([{ name: 'link', value: 'a' }])
  // ArrowDown from the search box goes to the first row, then the next row, never the Link button.
  const press = (el: Element, key: string) => act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
  press(host.querySelector('input[type=search]')!, 'ArrowDown')
  expect(document.activeElement!.textContent).toContain('Groceries')
  press(document.activeElement!, 'ArrowDown')
  expect(document.activeElement!.textContent).toBe('Plans')
})

test('a catalog row keeps label and badges, its description and its actions apart, so long text never runs over them', () => {
  const long = 'Read and write issues, pull requests, code search and Actions in your repositories. '.repeat(6)
  const view: ExtensionView = {
    type: 'list',
    label: 'Catalog',
    items: [
      {
        key: 'github',
        label: 'GitHub',
        description: long,
        detail: 'a very long status that should be cut short rather than push the row wider than the panel',
        badges: [{ text: 'GitHub', tone: 'muted' }, { text: 'Remote', tone: 'faint' }, { text: 'Sign-in', tone: 'faint' }],
        button: { label: 'Add', action: { name: 'pick', value: 'github' } },
        link: { text: 'Docs', url: 'https://example.com/docs' },
      },
    ],
  }
  act(() => root.render(<Tooltip.Provider><ExtensionViewer view={view} act={() => {}} /></Tooltip.Provider>))
  const li = host.querySelector('li')!
  const head = li.querySelector('[data-row-head]')!
  const badges = li.querySelector('[data-badges]')!
  const description = li.querySelector('[data-description]')!
  const actions = li.querySelector('[data-row-actions]')!
  // Badges sit beside the label on the first line; the description and the actions are separate boxes.
  expect(head.contains(badges)).toBe(true)
  expect([...badges.children].map((b) => b.textContent)).toEqual(['GitHub', 'Remote', 'Sign-in'])
  expect(description.contains(badges) || badges.contains(description)).toBe(false)
  expect(actions.contains(description) || description.contains(actions) || actions.contains(badges)).toBe(false)
  expect(actions.textContent).toBe('AddDocs')
  // The description is ordinary text, clamped to two lines, whole on hover.
  expect(description.className).toContain('line-clamp-2')
  expect(description.className).not.toContain('font-mono')
  expect(description.getAttribute('title')).toBe(long)
  // Nothing that holds text refuses to shrink: only the actions keep their width, and the badges wrap.
  for (const el of [head, description, li.querySelector('[data-detail]')!]) expect(el.className).not.toMatch(/\bshrink-0\b/)
  expect(badges.className).toContain('flex-wrap')
  expect(li.querySelector('[data-detail]')!.className).toContain('truncate')
  expect(actions.className).toContain('shrink-0')
  expect(li.lastElementChild).toBe(actions)
})
