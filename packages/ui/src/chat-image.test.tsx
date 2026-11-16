// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ClientMessage } from '@kothar/core/shared'
import { ChatImages, imageSource, ToolImages } from './chat-image.tsx'
import { fileLinksChecked, forgetFileLinks } from './file-links.tsx'
import { Markdown } from './markdown.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let host: HTMLDivElement
let sent: ClientMessage[]

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  forgetFileLinks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function render(text: string, inChat = true) {
  const body = <Markdown className="assistant" text={text} />
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider delayDuration={0}>
            {inChat ? (
              <ChatImages.Provider value={{ chatId: 'space', send: (m) => sent.push(m), connected: true }}>{body}</ChatImages.Provider>
            ) : (
              body
            )}
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
}

const images = () => [...host.querySelectorAll('img')]
const pathOf = (img: HTMLImageElement) => new URL(img.src).searchParams.get('path')

test('reads an image src as a file, the web or neither', () => {
  expect(imageSource('/work/a.png')).toEqual({ kind: 'local', path: '/work/a.png' })
  expect(imageSource('~/a.png')).toEqual({ kind: 'local', path: '~/a.png' })
  expect(imageSource('out/my%20chart.png')).toEqual({ kind: 'local', path: 'out/my chart.png' })
  expect(imageSource('file:///Users/me/a%20b.png')).toEqual({ kind: 'local', path: '/Users/me/a b.png' })
  expect(imageSource('file://server/share/a.png')).toEqual({ kind: 'other' })
  expect(imageSource('https://example.com/a.png')).toEqual({ kind: 'web', url: 'https://example.com/a.png' })
  expect(imageSource('javascript:alert(1)')).toEqual({ kind: 'other' })
  expect(imageSource('data:image/png;base64,AAAA')).toEqual({ kind: 'other' })
})

test('shows a local image from the core, with its caption and space kept while it loads', () => {
  render('Here:\n\n![Loss curve](/work/space/chart.png)')
  const [img] = images()
  expect(img).toBeDefined()
  const url = new URL(img!.src)
  expect(url.pathname).toBe('/chats/space/image')
  expect(pathOf(img!)).toBe('/work/space/chart.png')
  expect(img!.alt).toBe('Loss curve')
  expect(img!.className).toContain('hidden')
  expect(host.querySelector('[data-chat-image] .animate-pulse')).not.toBeNull()
  expect(host.textContent).toContain('Loss curve')
  act(() => img!.dispatchEvent(new Event('load')))
  expect(img!.className).toContain('max-h-480')
  expect(host.querySelector('.animate-pulse')).toBeNull()
})

test('a relative path and a file:// URL go to the core as written, for it to find in the chat’s places', () => {
  render('![a](out/chart.png) and ![b](file:///Users/me/shot.png) and ![c](<my plots/c.png>)')
  expect(images().map(pathOf)).toEqual(['out/chart.png', '/Users/me/shot.png', 'my plots/c.png'])
})

test('a missing or too big file says so inline instead of a broken image', async () => {
  const statuses = [404, 413]
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: statuses.shift() })))
  render('![gone](/work/gone.png)\n\n![huge](/work/huge.png)')
  const [gone, huge] = images()
  await act(async () => {
    gone!.dispatchEvent(new Event('error'))
    huge!.dispatchEvent(new Event('error'))
  })
  const notes = [...host.querySelectorAll('[data-image-failure]')].map((n) => n.textContent)
  expect(notes).toEqual(['Image not found: /work/gone.png', 'Image too big to show (over 25 MB): /work/huge.png'])
  expect(images()).toEqual([])
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/chats/space/image'), { method: 'HEAD' })
})

test('a web image never loads by itself; Load image loads it without a referrer', () => {
  render('![logo](https://tracker.example/pixel.png)')
  expect(images()).toEqual([])
  expect(host.textContent).toContain('https://tracker.example/pixel.png')
  const load = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Load image')!
  act(() => load.click())
  const [img] = images()
  expect(img!.src).toBe('https://tracker.example/pixel.png')
  expect(img!.getAttribute('referrerpolicy')).toBe('no-referrer')
})

test('a half-streamed image is text until its ) arrives', () => {
  render('Look: ![chart](/work/space/chart.pn')
  expect(images()).toEqual([])
  expect(host.textContent).toContain('![chart](/work/space/chart.pn')
  render('Look: ![chart](/work/space/chart.png)')
  expect(images()).toHaveLength(1)
})

test('outside a chat, and for other schemes, nothing loads', () => {
  render('![a](/work/a.png)', false)
  expect(images()).toEqual([])
  expect(host.textContent).toContain('Image: /work/a.png')
  render('![x](javascript:alert(1)) ![y](data:image/png;base64,AAAA)')
  expect(images()).toEqual([])
})

test('a click opens the image full size, with Open and Show in Finder; Esc closes it', () => {
  render('![Loss curve](chart.png)')
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Open Loss curve full size"]')!.click())
  const dialog = () => document.querySelector('[role="dialog"]')
  expect(dialog()?.querySelector('h2')?.textContent).toBe('Loss curve')
  expect(dialog()?.querySelector('img')?.src).toContain('/chats/space/image')
  // The buttons wait for the core to find the file, as a file link does.
  act(() => vi.advanceTimersByTime(50))
  expect(sent).toContainEqual({ type: 'files.check', chatId: 'space', paths: ['chart.png'] })
  act(() => fileLinksChecked({ type: 'files.checked', chatId: 'space', paths: { 'chart.png': '/work/space/chart.png' } }))
  const button = (text: string) => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === text)!
  act(() => button('Open').click())
  act(() => button(/Mac/.test(navigator.platform) ? 'Show in Finder' : 'Show in folder').click())
  expect(sent).toContainEqual({ type: 'file.open', chatId: 'space', path: '/work/space/chart.png', in: 'app' })
  expect(sent).toContainEqual({ type: 'reveal', path: '/work/space/chart.png' })
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  // Closed, and fading out: jsdom never ends the exit animation.
  expect(dialog()?.getAttribute('data-state') ?? 'closed').toBe('closed')
})

test("a tool result's pictures show as thumbnails that open full size", () => {
  const paths = ['/g/chats/space/tool-images/a-t1-0.png', '/g/chats/space/tool-images/a-t1-1.png']
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <ChatImages.Provider value={{ chatId: 'space', send: (m) => sent.push(m), connected: true }}>
            <ToolImages paths={paths} />
          </ChatImages.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
  expect(images().map(pathOf)).toEqual(paths)
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Open a-t1-1.png full size"]')!.click())
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('a-t1-1.png')
  act(() => images()[0]!.dispatchEvent(new Event('error')))
  expect(host.textContent).toContain('Image not found: a-t1-0.png')
})
