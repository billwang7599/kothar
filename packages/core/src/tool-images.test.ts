// Pictures in tool results: each engine's shape read by adapters/tool-images.ts, Claude Code passing them on, and the
// core saving them in the chat's folder so the log keeps paths and the window can show them.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeCode } from './adapters/claude-code.ts'
import { createFakeAdapter } from './adapters/fake.ts'
import { fakeMachine, sandboxingMachine } from './adapters/test-machine.ts'
import { imagesIn, MAX_TOOL_IMAGE_CHARS, MAX_TOOL_IMAGES, withImages } from './adapters/tool-images.ts'
import { openCore } from './core.ts'
import type { EngineEvent } from './shared.ts'
import { saveToolImages } from './tool-image-files.ts'
import { until } from './test-wait.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kothar-tool-images-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

describe('images in a tool result', () => {
  it("reads Anthropic's, MCP's and ACP's shapes", () => {
    expect(
      imagesIn([
        { type: 'text', text: 'Screenshot taken' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
        { type: 'image', data: PNG, mimeType: 'image/jpeg' },
        { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/webp' } },
      ]),
    ).toEqual([
      { mimeType: 'image/png', data: PNG },
      { mimeType: 'image/jpeg', data: PNG },
      { mimeType: 'image/webp', data: PNG },
    ])
  })

  it('keeps only plain picture types with data, none too big, a few per result', () => {
    expect(imagesIn('text')).toEqual([])
    expect(imagesIn(undefined)).toEqual([])
    expect(
      imagesIn([
        { type: 'image', data: PNG, mimeType: 'image/svg+xml' },
        { type: 'image', data: '', mimeType: 'image/png' },
        { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
        { type: 'image', data: 'a'.repeat(MAX_TOOL_IMAGE_CHARS + 1), mimeType: 'image/png' },
      ]),
    ).toEqual([])
    expect(imagesIn(Array.from({ length: 20 }, () => ({ type: 'image', data: PNG, mimeType: 'image/png' })))).toHaveLength(MAX_TOOL_IMAGES)
    expect(withImages([{ type: 'text', text: 'x' }])).toEqual({})
  })

  it('Claude Code passes a tool result’s pictures on with tool.completed', () => {
    const fake = fakeMachine()
    const events: EngineEvent[] = []
    const session = claudeCode.start(fake.machine, { cwd: '/tmp/project', instructions: '' }, (e) => void events.push(e))
    session.prompt('Take a screenshot')
    const line = (msg: object) => fake.stdout(JSON.stringify(msg) + '\n')
    line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'mcp__kothar__browser_screenshot', input: {} }] } })
    line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [
              { type: 'text', text: 'Took a screenshot' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
            ],
          },
        ],
      },
    })
    expect(events.find((e) => e.type === 'tool.completed')).toEqual({
      type: 'tool.completed',
      toolId: 't1',
      output: 'Took a screenshot',
      isError: false,
      images: [{ mimeType: 'image/png', data: PNG }],
    })
  })

  it('are saved in the chat’s folder, by path; ones that can’t be are left out', () => {
    const dir = tempDir()
    const saved = saveToolImages(dir, 'call/../1', [
      { mimeType: 'image/png', data: PNG },
      { mimeType: 'image/svg+xml', data: PNG },
      { mimeType: 'image/jpeg' },
    ], 0)
    expect(saved).toEqual([{ mimeType: 'image/png', path: join(dir, 'tool-images', '0-call1-0.png') }])
    expect(readFileSync(saved[0]!.path!).toString('base64')).toBe(PNG)
  })
})

describe('in the core', () => {
  it('logs a tool result’s pictures as paths in the chat’s folder, which the chat’s image route serves', async () => {
    const garage = tempDir()
    const core = openCore({
      garage,
      adapters: [
        createFakeAdapter(
          [
            { type: 'tool.started', toolId: 'shot', name: 'browser_screenshot', kind: 'other', summary: '', input: {} },
            { type: 'tool.completed', toolId: 'shot', output: 'Screenshot', isError: false, images: [{ mimeType: 'image/png', data: PNG }] },
          ],
          0,
        ),
      ],
      defaultEngine: 'fake',
      machine: sandboxingMachine,
    })
    cleanups.push(() => core.close(true))
    core.handle({ type: 'engine.setEnabled', engine: 'fake', enabled: true }, () => {})
    core.handle({ type: 'workFolder.set', path: join(garage, 'work') }, () => {})
    core.handle({ type: 'chat.create', name: 'Space', folders: [] }, () => {})
    const chatId = core.chats().find((c) => c.name === 'Space')!.id
    core.handle({ type: 'chat.send', chatId, text: 'Take a screenshot' }, () => {})
    const log = join(garage, 'chats', chatId, 'log.jsonl')
    await until(() => existsSync(log) && readFileSync(log, 'utf8').includes('"tool.completed"'))
    const entry = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .find((e) => e.type === 'tool.completed')
    expect(entry.images).toHaveLength(1)
    expect(entry.images[0].data).toBeUndefined()
    expect(entry.images[0].path.startsWith(join(garage, 'chats', chatId, 'tool-images') + '/')).toBe(true)
    expect(readFileSync(entry.images[0].path).toString('base64')).toBe(PNG)
    expect(core.chatImage(chatId, entry.images[0].path)).toMatchObject({ mimeType: 'image/png' })
  })
})
