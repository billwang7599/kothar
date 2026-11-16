// Pictures from tool results, saved in the chat's folder (tool-images/) as they arrive, so the log keeps a path rather
// than the bytes, and the window shows them through the chat's image route (file-links.ts image). Deleting the chat
// deletes them with its folder.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolImage } from '@kothar/extension-api'
import { TOOL_IMAGE_TYPES } from './adapters/tool-images.ts'

export const TOOL_IMAGES_DIR = 'tool-images'

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** Saves each picture with data and returns them with their paths instead; any it can't save are left out. */
export function saveToolImages(chatDir: string, toolId: string, images: ToolImage[], now = Date.now()): ToolImage[] {
  const dir = join(chatDir, TOOL_IMAGES_DIR)
  // Tool ids repeat across sessions (Codex numbers its items), so the time keeps names apart.
  const stem = `${now.toString(36)}-${toolId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'tool'}`
  const saved: ToolImage[] = []
  for (const [i, image] of images.entries()) {
    const ext = EXTENSIONS[image.mimeType]
    if (!ext || !TOOL_IMAGE_TYPES.includes(image.mimeType) || typeof image.data !== 'string') continue
    try {
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${stem}-${i}.${ext}`)
      writeFileSync(path, Buffer.from(image.data, 'base64'))
      saved.push({ mimeType: image.mimeType, path })
    } catch {}
  }
  return saved
}
