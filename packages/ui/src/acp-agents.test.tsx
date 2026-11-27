// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ClientMessage, EngineInfo } from '@kothar/core/shared'
import { joinArgs, parseEnv, splitArgs } from './settings/acp-agents.tsx'
import { EnginesPage } from './settings/engines.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLElement
beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const GEMINI = { id: 'acp-gemini', name: 'Gemini', command: 'gemini', args: ['--experimental-acp'], env: { GEMINI_API_KEY: 'k' } }
const ENGINES: EngineInfo[] = [
  { id: 'claude-code', name: 'Claude Code', enabled: true, installed: true, signedIn: true },
  { id: 'acp-gemini', name: 'Gemini', enabled: false, installed: true, signedIn: true, acp: GEMINI },
]

function render(sent: ClientMessage[] = []) {
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <MotionConfig transition={{ duration: 0 }}>
          <Tooltip.Provider>
            <EnginesPage engines={ENGINES} connected send={(m) => sent.push(m)} />
          </Tooltip.Provider>
        </MotionConfig>
      </LazyMotion>,
    ),
  )
  return sent
}

const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!
const type = (label: string, value: string) => {
  const field = [...container.querySelectorAll('label')].find((l) => l.textContent === label)!
  const input = document.getElementById(field.htmlFor) as HTMLInputElement | HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('splits arguments like a shell, quotes keeping spaces, and joins them back', () => {
  expect(splitArgs(`acp --dir "{cwd}" --name 'my agent'  ""`)).toEqual(['acp', '--dir', '{cwd}', '--name', 'my agent', ''])
  expect(splitArgs(joinArgs(['a b', 'c', '']))).toEqual(['a b', 'c', ''])
  expect(parseEnv('A=1\nB=x=y\nnot a pair\n')).toEqual({ A: '1', B: 'x=y' })
})

test('adds an ACP agent from the form', () => {
  const sent = render()
  act(() => button('Add ACP agent').click())
  expect(button('Add').disabled).toBe(true)
  type('Name', 'My Agent')
  type('Command', 'my-agent')
  type('Arguments', 'acp --cwd {cwd}')
  type('Environment', 'TOKEN=abc')
  type('Writable folders', '~/.my-agent\n')
  act(() => button('Add').click())
  expect(sent).toEqual([
    {
      type: 'acpAgent.save',
      agent: { name: 'My Agent', command: 'my-agent', args: ['acp', '--cwd', '{cwd}'], env: { TOKEN: 'abc' }, writable: ['~/.my-agent'] },
    },
  ])
  expect(container.querySelector('form')).toBeNull()
})

test('edits an added agent under its id; built-in engines have no Edit or Remove', () => {
  const sent = render()
  expect(container.textContent).toContain('Gemini')
  expect([...container.querySelectorAll('button')].filter((b) => b.textContent === 'Edit')).toHaveLength(1)
  act(() => button('Edit').click())
  const form = container.querySelector('form[aria-label="Edit Gemini"]')
  expect(form).not.toBeNull()
  type('Arguments', '--experimental-acp --yolo')
  act(() => button('Save').click())
  expect(sent).toEqual([{ type: 'acpAgent.save', agent: { ...GEMINI, args: ['--experimental-acp', '--yolo'] } }])
})
