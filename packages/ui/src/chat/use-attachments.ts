// Files waiting to go with the next message: picked, pasted or dropped. There's no size cap: small files are read in
// and ride the message as base64; bigger ones stream to the core at once (uploadFile), with progress on their chip.
// Large ones get a warning (attachmentNotes), and a huge one is attached only once the user confirms.
import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  HUGE_ATTACHMENT_BYTES,
  IMAGE_TYPES,
  INLINE_ATTACHMENT_BYTES,
  INLINE_ATTACHMENTS_TOTAL_BYTES,
  LARGE_ATTACHMENT_BYTES,
  LARGE_ATTACHMENTS_TOTAL_BYTES,
  type Upload,
} from '@kothar/core/shared'
import { dropUpload, uploadFile, type FileUpload } from '../connection.ts'
import { confirm } from '../controls.tsx'
import { formatBytes } from '../format.ts'
import type { Pending } from './attachments.tsx'

export type AttachmentDeps = {
  upload: (file: Blob, onProgress: (fraction: number) => void) => FileUpload
  drop: (id: string) => void
  confirm: (request: { text: string; body: string; ok: string }) => Promise<boolean>
}
const WINDOW_DEPS: AttachmentDeps = { upload: uploadFile, drop: dropUpload, confirm }

/** What a waiting file sends: its contents inline or its upload's id; undefined while it's still uploading. */
export function uploadOf(p: Pending): Upload | undefined {
  if (p.base64 !== undefined) return { name: p.name, mimeType: p.mimeType, base64: p.base64 }
  if (p.uploadId !== undefined) return { name: p.name, mimeType: p.mimeType, uploadId: p.uploadId, size: p.size }
  return undefined
}

/** Whether a waiting file is big enough to warn about. */
export const isLarge = (p: Pick<Pending, 'size'>) => p.size > LARGE_ATTACHMENT_BYTES

/** The size of the waiting files together, and the warnings to show by them (inline, amber). */
export function attachmentNotes(pending: Pick<Pending, 'name' | 'mimeType' | 'size'>[]) {
  const total = pending.reduce((sum, p) => sum + p.size, 0)
  const warnings: string[] = []
  for (const p of pending) {
    if (!isLarge(p)) continue
    warnings.push(
      IMAGE_TYPES.includes(p.mimeType)
        ? `Large: ${p.name} is ${formatBytes(p.size)}, too big to show the agent as a picture. It gets the file's path.`
        : `Large: ${p.name} is ${formatBytes(p.size)}. An agent that reads it may use a lot of context.`,
    )
  }
  if (pending.length > 1 && total > LARGE_ATTACHMENTS_TOTAL_BYTES) {
    warnings.push(`Large: ${formatBytes(total)} in all. Slow to send, and costly in context if agents read it all.`)
  }
  return { total, warnings }
}

const readBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/**
 * The files waiting to be sent. attach takes new ones in, telling the user (notify) about any it couldn't read;
 * unattach removes some, deleting what they had uploaded; sent clears them once a message took them.
 */
export function useAttachments(notify: (message: string) => void, deps: AttachmentDeps = WINDOW_DEPS) {
  const [pending, setPending] = useState<Pending[]>([])
  const pendingRef = useRef(pending)
  // oxlint-disable-next-line react/refs -- the latest list, for attach's inline total and the unmount cleanup
  pendingRef.current = pending
  // Uploads still streaming, by their file's id, so removing the file stops its upload.
  const uploading = useRef(new Map<string, FileUpload>())
  const depsRef = useRef(deps)
  // oxlint-disable-next-line react/refs -- the latest deps, for the unmount cleanup
  depsRef.current = deps

  const forget = (removed: Pending[], drop: boolean) => {
    for (const p of removed) {
      if (p.preview) URL.revokeObjectURL(p.preview)
      uploading.current.get(p.id)?.abort()
      uploading.current.delete(p.id)
      if (drop && p.uploadId) depsRef.current.drop(p.uploadId)
    }
  }
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, on unmount: files never sent are let go
  useEffect(() => () => forget(pendingRef.current, true), [])

  const update = (id: string, change: Partial<Pending>) =>
    setPending((list) => list.map((p) => (p.id === id ? { ...p, ...change } : p)))
  const unattach = (removed: Pending[]) => {
    forget(removed, true)
    const ids = new Set(removed.map((p) => p.id))
    setPending((list) => list.filter((p) => !ids.has(p.id)))
  }
  const sent = (taken: Pending[]) => {
    forget(taken, false)
    const ids = new Set(taken.map((p) => p.id))
    setPending((list) => list.filter((p) => !ids.has(p.id)))
  }
  const attach = async (files: File[]) => {
    let inlineBytes = pendingRef.current.reduce((sum, p) => sum + (p.base64 !== undefined ? p.size : 0), 0)
    for (const file of files) {
      const name = file.name || 'attachment'
      if (file.size > HUGE_ATTACHMENT_BYTES) {
        const ok = await deps.confirm({
          text: `Attach ${name}? It's ${formatBytes(file.size)}.`,
          body: 'Very large files take a while to upload and fill disk space in the chat folder. An agent that reads it may use a lot of context.',
          ok: 'Attach',
        })
        if (!ok) continue
      }
      const mimeType = file.type || 'application/octet-stream'
      const preview = IMAGE_TYPES.includes(mimeType) ? URL.createObjectURL(file) : undefined
      const id = crypto.randomUUID()
      const base = { id, name, mimeType, size: file.size, preview }
      const inline = file.size <= INLINE_ATTACHMENT_BYTES && inlineBytes + file.size <= INLINE_ATTACHMENTS_TOTAL_BYTES
      try {
        if (inline) {
          inlineBytes += file.size
          const base64 = await readBase64(file)
          setPending((list) => [...list, { ...base, base64 }])
          continue
        }
        const upload = deps.upload(file, (progress) => update(id, { progress }))
        uploading.current.set(id, upload)
        setPending((list) => [...list, { ...base, progress: 0 }])
        void upload.done.then(
          ({ id: uploadId }) => {
            // Removed while it streamed: the core keeps it only until it's told.
            if (!uploading.current.delete(id)) return deps.drop(uploadId)
            update(id, { uploadId, progress: undefined })
          },
          () => {
            if (!uploading.current.delete(id)) return
            if (preview) URL.revokeObjectURL(preview)
            setPending((list) => list.filter((p) => p.id !== id))
            notify(`Could not upload ${name}`)
          },
        )
      } catch {
        if (preview) URL.revokeObjectURL(preview)
        notify(`Could not read ${name}`)
      }
    }
  }
  // Files given back by the core (an undone message's): small ones read in, big ones already staged as uploads.
  const restore = (uploads: Upload[]) => {
    const added = uploads.map((upload): Pending => {
      if (!('base64' in upload)) return { ...upload, id: crypto.randomUUID() }
      const bytes = Uint8Array.from(atob(upload.base64), (c) => c.charCodeAt(0))
      const preview = IMAGE_TYPES.includes(upload.mimeType) && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(new Blob([bytes], { type: upload.mimeType }))
        : undefined
      return { ...upload, id: crypto.randomUUID(), size: bytes.length, preview }
    })
    if (added.length) setPending((list) => [...list, ...added])
  }
  return { pending, attach, unattach, sent, restore }
}

/**
 * Dropping files anywhere on the chat attaches them while canAttach. dragging is true while files are held over it;
 * dropHandlers go on the element that takes the drop.
 */
export function useFileDrop(canAttach: boolean, attach: (files: File[]) => Promise<void>) {
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      dragDepth.current++
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!carriesFiles(e) || --dragDepth.current > 0) return
      setDragging(false)
    },
    onDragOver: (e: DragEvent) => carriesFiles(e) && e.preventDefault(),
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (canAttach) void attach([...e.dataTransfer.files])
    },
  }
  return { dragging, dropHandlers }
}
