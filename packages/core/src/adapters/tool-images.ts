// Pictures in a tool's result, in the shapes engines send them: Anthropic's ({ type: 'image', source: { type:
// 'base64', media_type, data } }, Claude Code), MCP's ({ type: 'image', data, mimeType }, pi, Codex, ACP), and ACP's
// wrapper ({ type: 'content', content: … }). Each adapter passes them on as tool.completed's images, and the core saves
// them (tool-image-files.ts). Only plain picture types, a few per result, none too big.
import type { ToolImage } from '@kothar/extension-api'

export const TOOL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_TOOL_IMAGES = 8
// 25 MB once decoded, as base64.
export const MAX_TOOL_IMAGE_CHARS = Math.ceil((25 * 1024 * 1024 * 4) / 3)

const imageOf = (block: any): ToolImage | undefined => {
  if (block?.type === 'content') return imageOf(block.content)
  if (block?.type !== 'image') return undefined
  const source = block.source?.type === 'base64' ? block.source : undefined
  const mimeType = String(source ? source.media_type : (block.mimeType ?? block.mime_type ?? '')).toLowerCase()
  const data = source ? source.data : block.data
  if (!TOOL_IMAGE_TYPES.includes(mimeType) || typeof data !== 'string' || !data) return undefined
  if (data.length > MAX_TOOL_IMAGE_CHARS) return undefined
  return { mimeType, data }
}

/** The pictures in a tool result's content blocks, if any. */
export function imagesIn(content: unknown): ToolImage[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => imageOf(block) ?? []).slice(0, MAX_TOOL_IMAGES)
}

/** tool.completed's images field: absent when there are none. */
export const withImages = (content: unknown) => {
  const images = imagesIn(content)
  return images.length ? { images } : {}
}
