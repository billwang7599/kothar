// Usage as each engine reports it, read into Kothar's words. Sessions' turn.usage is covered by each adapter's own
// tests, from recorded output; these cover the rest: older output, one-shot calls.
import { describe, expect, it } from 'vitest'
import type { Usage } from '../shared.ts'
import { claudeCode, claudeUsage } from './claude-code.ts'
import { codex, codexUsage } from './codex.ts'
import { fakeMachine } from './test-machine.ts'

const request = { cwd: '/tmp/home', system: 'S', prompt: 'P', model: 'm', timeoutMs: 1000 }

describe('Claude Code', () => {
  const model = (inputTokens: number, costUSD: number) => ({
    inputTokens,
    outputTokens: 10,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 5,
    costUSD,
  })

  it('reads model_usage_since_last_result when the result has it, else the change in modelUsage', () => {
    const seen = new Map<string, Usage>()
    // Older versions: running totals only.
    expect(claudeUsage({ modelUsage: { a: model(100, 0.5) } }, seen)).toEqual([
      { model: 'a', inputTokens: 100, outputTokens: 10, cacheWriteTokens: 5, costUsd: 0.5 },
    ])
    expect(claudeUsage({ modelUsage: { a: model(150, 0.75), b: model(7, 0.01) } }, seen)).toEqual([
      { model: 'a', inputTokens: 50, costUsd: 0.25 },
      { model: 'b', inputTokens: 7, outputTokens: 10, cacheWriteTokens: 5, costUsd: 0.01 },
    ])
    // Newer: the calls since the last result, whatever the totals say.
    const since = { model_usage_since_last_result: { a: model(3, 0.002) }, modelUsage: { a: model(999, 9) } }
    expect(claudeUsage(since, seen)).toEqual([{ model: 'a', inputTokens: 3, outputTokens: 10, cacheWriteTokens: 5, costUsd: 0.002 }])
    expect(claudeUsage({ type: 'result' }, seen)).toEqual([])
  })

  it('reports what a one-shot call used, even one that failed', async () => {
    const reply = (fields: object) =>
      fakeMachine({ claude: { code: 0, stdout: JSON.stringify({ type: 'result', result: 'ok', modelUsage: { m: model(40, 0.001) }, ...fields }), stderr: '' } })
    const used: Usage[] = []
    expect(await claudeCode.complete!(reply({}).machine, { ...request, onUsage: (u) => used.push(u) })).toBe('ok')
    await expect(claudeCode.complete!(reply({ is_error: true, result: 'nope' }).machine, { ...request, onUsage: (u) => used.push(u) })).rejects.toThrow('nope')
    expect(used).toEqual([
      { model: 'm', inputTokens: 40, outputTokens: 10, cacheWriteTokens: 5, costUsd: 0.001 },
      { model: 'm', inputTokens: 40, outputTokens: 10, cacheWriteTokens: 5, costUsd: 0.001 },
    ])
  })
})

describe('Codex', () => {
  it('counts cached input apart from input, and reports no cost', () => {
    expect(codexUsage({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50, reasoningOutputTokens: 20 }, 'gpt')).toEqual({
      model: 'gpt',
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 800,
    })
    expect(codexUsage({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 3 })).toEqual({ inputTokens: 10, outputTokens: 3 })
    expect(codexUsage(undefined)).toBeUndefined()
  })

  it('reports what a one-shot call used, from exec’s turn.completed', async () => {
    const stdout = [
      { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } },
      { type: 'turn.completed', usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 9 } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n')
    const fake = fakeMachine({ '/bin/sh': { code: 0, stdout, stderr: '' } })
    const used: Usage[] = []
    expect(await codex.complete!(fake.machine, { ...request, onUsage: (u) => used.push(u) })).toBe('hi')
    expect(used).toEqual([{ model: 'm', inputTokens: 400, outputTokens: 9, cacheReadTokens: 100 }])
  })
})
