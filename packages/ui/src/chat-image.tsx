// Pictures in a chat's replies: `![caption](path)` shows the file inline when it's in the chat's places (the core
// serves it, GET /chats/<id>/image, and refuses anything else), and a click opens it full size. A picture on the web
// never loads by itself, since loading it tells the site the user read the reply; a click loads it.
import { createContext, useContext, useState, type ReactNode } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Dialog } from 'radix-ui'
import type { ClientMessage } from '@kothar/core/shared'
import { windowChatImageUrl } from './connection.ts'
import { Button, MOTION } from './controls.tsx'
import { useFound } from './file-links.tsx'
import { isMac } from './shortcuts.ts'

/** The chat whose places a reply's pictures come from. Without it (outside a chat), local pictures aren't shown. */
export type ChatImageScope = { chatId: string; send: (m: ClientMessage) => void; connected: boolean }
export const ChatImages = createContext<ChatImageScope | undefined>(undefined)

export type ImageSource = { kind: 'local'; path: string } | { kind: 'web'; url: string } | { kind: 'other' }

/** What an image's src means: a file (absolute, ~/…, file://… or relative to the chat's places), the web, or neither. */
export function imageSource(src: string): ImageSource {
  const trimmed = src.trim()
  if (/^https?:\/\//i.test(trimmed)) return { kind: 'web', url: trimmed }
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return url.host ? { kind: 'other' } : { kind: 'local', path: decodeURIComponent(url.pathname) }
    } catch {
      return { kind: 'other' }
    }
  }
  // Any other scheme (data:, javascript:, blob:, mailto:) isn't a file in the chat's places.
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { kind: 'other' }
  try {
    return { kind: 'local', path: decodeURIComponent(trimmed) }
  } catch {
    return { kind: 'local', path: trimmed }
  }
}

/** Keeps an image's src as written, so a local path reaches the image component; other URLs go through fallback. */
export const keepImageSrc =
  (fallback: (url: string) => string) =>
  (url: string, key: string): string =>
    key === 'src' ? url : fallback(url)

type Failure = 'missing' | 'too-big' | 'not-image' | 'failed'
const FAILURES: Record<Failure, string> = {
  missing: 'Image not found',
  'too-big': 'Image too big to show (over 25 MB)',
  'not-image': 'Not an image',
  failed: "Couldn't load image",
}
const failureOf = (status: number): Failure =>
  status === 404 ? 'missing' : status === 413 ? 'too-big' : status === 415 ? 'not-image' : 'failed'

const NOTE = 'flex max-w-full items-center gap-8 rounded-lg border bg-raised px-10 py-6 text-sm text-muted'
const IMAGE = 'block max-h-480 max-w-full rounded-lg border object-contain'

/** An image in a reply: a file from the chat's places, or a picture on the web behind a click. */
export function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const source = imageSource(src)
  if (source.kind === 'web') return <WebImage url={source.url} alt={alt} />
  if (source.kind === 'other') return <span className={NOTE}>{alt || 'Image'} (not shown: not a file or web address)</span>
  return <LocalImage path={source.path} alt={alt} />
}

function Figure({ alt, children }: { alt: string; children: ReactNode }) {
  return (
    <span className="my-6 flex max-w-full flex-col items-start gap-4" data-chat-image="">
      {children}
      {alt && <span className="text-sm text-muted">{alt}</span>}
    </span>
  )
}

function LocalImage({ path, alt }: { path: string; alt: string }) {
  const scope = useContext(ChatImages)
  const [failure, setFailure] = useState<Failure>()
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  if (!scope) return <span className={NOTE}>Image: {path}</span>
  const url = windowChatImageUrl(scope.chatId, path)
  if (failure) {
    return (
      <span className={NOTE} role="note" data-image-failure={failure}>
        <span className="min-w-0 wrap-anywhere">
          {FAILURES[failure]}: {path}
        </span>
      </span>
    )
  }
  // An <img> error carries no status, so a quick HEAD says why (missing, too big, not a picture).
  const failed = () =>
    void fetch(url, { method: 'HEAD' }).then(
      (response) => setFailure(response.ok ? 'failed' : failureOf(response.status)),
      () => setFailure('failed'),
    )
  return (
    <Figure alt={alt}>
      <button
        type="button"
        className="block max-w-full cursor-zoom-in rounded-lg focus-visible:outline-2"
        aria-label={`Open ${alt || path} full size`}
        onClick={() => setOpen(true)}
      >
        {/* Space kept while it loads, so the reply doesn't jump twice as the picture arrives. */}
        {!loaded && <span className="block h-160 w-240 max-w-full animate-pulse rounded-lg border bg-raised" aria-hidden="true" />}
        <img
          src={url}
          alt={alt || path}
          title={alt || path}
          decoding="async"
          className={loaded ? IMAGE : 'hidden'}
          onLoad={() => setLoaded(true)}
          onError={failed}
        />
      </button>
      <ImageLightbox open={open} onOpenChange={setOpen} url={url} title={alt || path} path={path} />
    </Figure>
  )
}

function WebImage({ url, alt }: { url: string; alt: string }) {
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState(false)
  if (!shown) {
    return (
      <span className={NOTE} data-web-image={url}>
        <span className="min-w-0 truncate" title={url}>
          {alt ? `${alt}: ` : 'Image: '}
          {url}
        </span>
        <Button size="small" onClick={() => setShown(true)}>
          Load image
        </Button>
      </span>
    )
  }
  return (
    <Figure alt={alt}>
      <button
        type="button"
        className="block max-w-full cursor-zoom-in rounded-lg focus-visible:outline-2"
        aria-label={`Open ${alt || url} full size`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={alt || url} title={url} referrerPolicy="no-referrer" className={IMAGE} />
      </button>
      <ImageLightbox open={open} onOpenChange={setOpen} url={url} title={alt || url} />
    </Figure>
  )
}

/** A tool result's pictures as small thumbnails under its row, each opening full size. */
export function ToolImages({ paths }: { paths: string[] }) {
  return (
    <div className="flex flex-wrap gap-6 pl-26" data-tool-images="">
      {paths.map((path) => (
        <ToolThumbnail key={path} path={path} />
      ))}
    </div>
  )
}

function ToolThumbnail({ path }: { path: string }) {
  const scope = useContext(ChatImages)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!scope) return null
  const name = path.split('/').at(-1) ?? path
  if (failed) return <span className={NOTE}>Image not found: {name}</span>
  const url = windowChatImageUrl(scope.chatId, path)
  return (
    <>
      <button
        type="button"
        className="block cursor-zoom-in rounded-lg focus-visible:outline-2"
        aria-label={`Open ${name} full size`}
        onClick={() => setOpen(true)}
      >
        <img
          src={url}
          alt={name}
          title={name}
          decoding="async"
          className="block h-64 max-w-160 rounded-lg border bg-raised object-cover"
          onError={() => setFailed(true)}
        />
      </button>
      <ImageLightbox open={open} onOpenChange={setOpen} url={url} title={name} path={path} />
    </>
  )
}

/** A picture full size over the window. With path (a file in the chat's places), buttons open it or show it in Finder. */
export function ImageLightbox(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  title: string
  path?: string
}) {
  const { open, onOpenChange, url, title } = props
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <m.div className="fixed inset-0 bg-backdrop" {...MOTION.fade} />
            </Dialog.Overlay>
            <Dialog.Content forceMount asChild aria-describedby={undefined}>
              <m.div
                className="fixed inset-0 m-auto flex size-fit max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] min-w-[min(320px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border bg-panel shadow-overlay"
                {...MOTION.pop}
              >
                <header className="flex h-40 shrink-0 items-center gap-8 border-b pr-8 pl-12">
                  <Dialog.Title className="min-w-0 flex-1 truncate font-semibold">{title}</Dialog.Title>
                  {props.path && <FileButtons path={props.path} />}
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close">
                      ×
                    </Button>
                  </Dialog.Close>
                </header>
                <img
                  src={url}
                  alt={title}
                  referrerPolicy="no-referrer"
                  className="mx-auto block max-h-[calc(100vh-74px)] max-w-[calc(100vw-34px)] object-contain"
                />
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

// Open with the default app, and Show in Finder, on the path the core found for this chat (as a file link's are).
function FileButtons({ path }: { path: string }) {
  const scope = useContext(ChatImages)
  const found = useFound(scope, path)
  if (!scope || !found) return null
  const { chatId, send, connected } = scope
  return (
    <>
      <Button size="small" disabled={!connected} onClick={() => send({ type: 'file.open', chatId, path: found, in: 'app' })}>
        Open
      </Button>
      <Button size="small" disabled={!connected} onClick={() => send({ type: 'reveal', path: found })}>
        {isMac() ? 'Show in Finder' : 'Show in folder'}
      </Button>
    </>
  )
}
