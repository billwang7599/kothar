// @vitest-environment jsdom
// Attaching files up to the largest attachment in Settings: small ones read in, big ones streamed to the core, huge
// ones (with the limit past them, or none) only once confirmed.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { DEFAULT_ATTACHMENT_LIMIT, HUGE_ATTACHMENT_BYTES, INLINE_ATTACHMENT_BYTES, LARGE_ATTACHMENT_BYTES } from '@kothar/core/shared'
import { UploadRefused } from '../connection.ts'
import { attachmentNotes, uploadOf, useAttachments, type AttachmentDeps } from './use-attachments.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** A file that says it's size bytes, without holding them. */
const sized = (name: string, size: number, type = 'application/octet-stream') => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function fakeDeps(answer = true) {
  const uploads: { name: string; progress: (f: number) => void; finish: (id: string) => void; fail: () => void; aborted: boolean }[] = []
  const dropped: string[] = []
  const asked: string[] = []
  const deps: AttachmentDeps = {
    upload: (file, progress) => {
      let finish!: (id: string) => void
      let fail!: () => void
      const done = new Promise<{ id: string; size: number }>((resolve, reject) => {
        finish = (id) => resolve({ id, size: file.size })
        fail = () => reject(new Error('stopped'))
      })
      const entry = { name: (file as File).name, progress, finish, fail, aborted: false }
      uploads.push(entry)
      return {
        done,
        abort: () => {
          entry.aborted = true
          fail()
        },
      }
    },
    drop: (id) => dropped.push(id),
    confirm: async ({ text }) => {
      asked.push(text)
      return answer
    },
  }
  return { deps, uploads, dropped, asked }
}

// limit: the largest attachment, the default unless given ('none': no limit); setLimit changes it, as Settings does.
function mount(deps: AttachmentDeps, limit: number | 'none' = DEFAULT_ATTACHMENT_LIMIT) {
  const notes: string[] = []
  const hook: { current?: ReturnType<typeof useAttachments> } = {}
  function Probe({ limit }: { limit: number | undefined }) {
    hook.current = useAttachments((m) => notes.push(m), limit, deps)
    return null
  }
  const render = (next: number | 'none') => act(() => root.render(<Probe limit={next === 'none' ? undefined : next} />))
  render(limit)
  return { hook: hook as { current: ReturnType<typeof useAttachments> }, notes, setLimit: render }
}

test('reads a small file in, and streams a big one with progress, sending it by its upload id once done', async () => {
  const fake = fakeDeps()
  const { hook } = mount(fake.deps)
  await act(() => hook.current.attach([new File(['hello'], 'a.txt', { type: 'text/plain' }), sized('clip.mov', LARGE_ATTACHMENT_BYTES * 7)]))
  expect(fake.uploads.map((u) => u.name)).toEqual(['clip.mov'])
  const [small, big] = hook.current.pending
  expect(uploadOf(small!)).toEqual({ name: 'a.txt', mimeType: 'text/plain', base64: btoa('hello') })
  expect(big).toMatchObject({ name: 'clip.mov', size: LARGE_ATTACHMENT_BYTES * 7, progress: 0 })
  expect(uploadOf(big!)).toBeUndefined()

  act(() => fake.uploads[0]!.progress(0.5))
  expect(hook.current.pending[1]!.progress).toBe(0.5)
  await act(async () => fake.uploads[0]!.finish('a'.repeat(32)))
  expect(uploadOf(hook.current.pending[1]!)).toEqual({
    name: 'clip.mov',
    mimeType: 'application/octet-stream',
    uploadId: 'a'.repeat(32),
    size: LARGE_ATTACHMENT_BYTES * 7,
  })
  // Sent: the core took the upload, so nothing is dropped.
  act(() => hook.current.sent(hook.current.pending))
  expect(hook.current.pending).toEqual([])
  expect(fake.dropped).toEqual([])
})

test('a file just over the inline size streams too; nothing is refused for size', async () => {
  const fake = fakeDeps()
  const { hook, notes } = mount(fake.deps)
  await act(() => hook.current.attach([sized('mid.bin', INLINE_ATTACHMENT_BYTES + 1)]))
  expect(fake.uploads).toHaveLength(1)
  expect(notes).toEqual([])
  expect(fake.asked).toEqual([])
})

test('refuses a file past the largest attachment, 200 MB by default, and a new limit applies to the next attach', async () => {
  const fake = fakeDeps()
  const { hook, notes, setLimit } = mount(fake.deps)
  await act(() => hook.current.attach([sized('movie.mov', 340_000_000), sized('fits.bin', DEFAULT_ATTACHMENT_LIMIT)]))
  expect(notes).toEqual(['movie.mov is 340 MB. The largest attachment is 200 MB (change it in Settings).'])
  expect(fake.uploads.map((u) => u.name)).toEqual(['fits.bin'])
  expect(fake.asked).toEqual([])

  setLimit(25_000_000)
  await act(() => hook.current.attach([sized('clip.mov', 30_000_000)]))
  expect(notes.at(-1)).toBe('clip.mov is 30 MB. The largest attachment is 25 MB (change it in Settings).')
  // No limit: the same file and a far bigger one go (the huge one once confirmed).
  setLimit('none')
  await act(() => hook.current.attach([sized('clip.mov', 30_000_000), sized('disk.img', 5_000_000_000)]))
  expect(fake.uploads.map((u) => u.name)).toEqual(['fits.bin', 'clip.mov', 'disk.img'])
  expect(fake.asked).toEqual(["Attach disk.img? It's 5 GB."])
  expect(notes).toHaveLength(2)
})

test("shows the core's reason when it refuses an upload for size", async () => {
  const fake = fakeDeps()
  const refusing: AttachmentDeps = {
    ...fake.deps,
    upload: (file, progress) => {
      const upload = fake.deps.upload(file, progress)
      return { ...upload, done: Promise.reject(new UploadRefused('The file is 300 MB, bigger than the largest attachment, 200 MB (change it in Settings).')) }
    },
  }
  const { hook, notes } = mount(refusing, 'none')
  await act(() => hook.current.attach([sized('big.bin', 300_000_000)]))
  await act(async () => {})
  expect(hook.current.pending).toEqual([])
  expect(notes).toEqual(['big.bin: The file is 300 MB, bigger than the largest attachment, 200 MB (change it in Settings).'])
})

test('asks before attaching a huge file only with the limit past it, leaving it out if the user says no', async () => {
  // Under the default limit a file past HUGE_ATTACHMENT_BYTES is refused outright, with nothing to confirm.
  const refused = fakeDeps()
  const capped = mount(refused.deps)
  await act(() => capped.hook.current.attach([sized('disk.img', HUGE_ATTACHMENT_BYTES + 1)]))
  expect(refused.asked).toEqual([])
  expect(capped.notes).toHaveLength(1)

  const no = fakeDeps(false)
  const first = mount(no.deps, 1_000_000_000)
  await act(() => first.hook.current.attach([sized('disk.img', HUGE_ATTACHMENT_BYTES + 1)]))
  expect(no.asked).toEqual(['Attach disk.img? It\'s 500 MB.'])
  expect(first.hook.current.pending).toEqual([])
  expect(no.uploads).toEqual([])

  const yes = fakeDeps(true)
  const second = mount(yes.deps, 'none')
  await act(() => second.hook.current.attach([sized('disk.img', HUGE_ATTACHMENT_BYTES * 2)]))
  expect(yes.asked).toHaveLength(1)
  expect(yes.uploads.map((u) => u.name)).toEqual(['disk.img'])
})

test('removing a file stops its upload, or deletes it from the core once uploaded; a failed upload says so', async () => {
  const fake = fakeDeps()
  const { hook, notes } = mount(fake.deps)
  await act(() => hook.current.attach([sized('one.bin', LARGE_ATTACHMENT_BYTES), sized('two.bin', LARGE_ATTACHMENT_BYTES), sized('three.bin', LARGE_ATTACHMENT_BYTES)]))
  await act(async () => fake.uploads[1]!.finish('b'.repeat(32)))
  const [one, two] = hook.current.pending
  await act(async () => hook.current.unattach([one!, two!]))
  expect(fake.uploads[0]!.aborted).toBe(true)
  expect(fake.dropped).toEqual(['b'.repeat(32)])
  expect(notes).toEqual([])

  await act(async () => fake.uploads[2]!.fail())
  expect(hook.current.pending).toEqual([])
  expect(notes).toEqual(['Could not upload three.bin'])
})

test('warns about large files and a large total under the limit, and says a large picture goes to the agent by path', () => {
  expect(attachmentNotes([{ name: 'a.txt', mimeType: 'text/plain', size: 10 }])).toEqual({ total: 10, warnings: [] })
  const { total, warnings } = attachmentNotes([
    { name: 'shot.png', mimeType: 'image/png', size: 30_000_000 },
    { name: 'data.csv', mimeType: 'text/csv', size: 50_000_000 },
  ])
  expect(total).toBe(80_000_000)
  expect(warnings).toEqual([
    "Large: shot.png is 30 MB, too big to show the agent as a picture. It gets the file's path.",
    'Large: data.csv is 50 MB. An agent that reads it may use a lot of context.',
    'Large: 80 MB in all. Slow to send, and costly in context if agents read it all.',
  ])
})
