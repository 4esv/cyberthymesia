import { test, expect } from 'claude-code/testing'
import { chooseTail, cleanCuts, isPrompt, messageBytes } from '../hooks/tail'

type M = Parameters<typeof messageBytes>[0]
const user = (text: string): M => ({ role: 'user', text, toolUses: [] })
const asst = (text: string, ids: string[] = []): M => ({ role: 'assistant', text, toolUses: ids.map(id => ({ tool_use_id: id, name: 'Bash', input: {} }) as never) })
const result = (id: string, text = 'out'): M => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false } as never] })

test('messageBytes counts text, tool input and tool results', () => {
  expect(messageBytes(user('abcd'))).toBe(4)
  expect(messageBytes({ role: 'assistant', text: 'ab', toolUses: [{ tool_use_id: 'x', name: 'B', input: { a: 1 }, text: 'zz' } as never] })).toBe(2 + '{"a":1}'.length + 2)
  expect(messageBytes(result('x', 'héllo'))).toBe(6)
})

test('isPrompt: user words with no tool results', () => {
  expect(isPrompt(user('hi'))).toBe(true)
  expect(isPrompt(user('   '))).toBe(false)
  expect(isPrompt(asst('hi'))).toBe(false)
  expect(isPrompt({ ...result('x'), text: 'words' })).toBe(false)
})

test('cleanCuts marks every cut between a use and its result as dirty', () => {
  const ms = [user('p'), asst('', ['t1']), result('t1'), asst('done')]
  expect(cleanCuts(ms)).toEqual([true, true, false, true, true])
})

test('cleanCuts: a use with no result does not block', () => {
  expect(cleanCuts([user('p'), asst('', ['lost']), asst('next')])).toEqual([true, true, true, true])
})

test('chooseTail: too short a transcript has no cut', () => {
  expect(chooseTail([], 10)).toBeUndefined()
  expect(chooseTail([user('a')], 10)).toBeUndefined()
})

test('chooseTail picks the latest prompt whose suffix reaches the target', () => {
  const ms = [user('aaaa'), asst('bbbb'), user('cccc'), asst('dddd'), user('eeee'), asst('ffff')]
  // suffix at 4 = 8, at 2 = 16, at 0 not allowed
  expect(chooseTail(ms, 8)).toEqual({ index: 4, kind: 'prompt', tailBytes: 8 })
  expect(chooseTail(ms, 9)).toEqual({ index: 2, kind: 'prompt', tailBytes: 16 })
})

test('chooseTail never cuts to index 0 and takes the earliest prompt when none reaches the target', () => {
  const ms = [user('aaaa'), asst('bbbb'), user('cccc'), asst('dddd')]
  // target 1000 is never reached; earliest allowed prompt is index 2 (not 0)
  expect(chooseTail(ms, 1000)).toEqual({ index: 2, kind: 'prompt', tailBytes: 8 })
})

test('chooseTail never splits a tool use from its result', () => {
  // The only later prompt boundary candidates sit inside the pair; the prompt at 3 is clean.
  const ms = [user('p0'), asst('', ['t1']), result('t1', 'x'.repeat(100)), user('p1'), asst('end')]
  const c = chooseTail(ms, 10)
  expect(c?.index).toBe(3)
  const clean = cleanCuts(ms)
  expect(clean[c!.index]).toBe(true)
})

test('chooseTail: a dirty prompt boundary is skipped', () => {
  // A "prompt" (user with words) between a use and its result is not a legal cut.
  const odd: M = { role: 'user', text: 'interjection', toolUses: [] }
  const ms = [user('p0'), asst('', ['t1']), odd, result('t1'), asst('after')]
  expect(cleanCuts(ms)[2]).toBe(false)
  const c = chooseTail(ms, 10)
  expect(c?.index).toBe(1)
  expect(c?.kind).toBe('round')
  expect(cleanCuts(ms)[c!.index]).toBe(true)
})

test('chooseTail falls back to an assistant round for one prompt and a long run', () => {
  const ms: M[] = [user('p0'), user('p1')]
  for (let i = 0; i < 20; i++) ms.push(asst('x'.repeat(100), [`t${i}`]), result(`t${i}`, 'y'.repeat(100)))
  // the prompt at 1 leaves far more than 2x target
  const c = chooseTail(ms, 500)
  expect(c?.kind).toBe('round')
  expect(ms[c!.index]!.role).toBe('assistant')
  expect(cleanCuts(ms)[c!.index]).toBe(true)
  expect(c!.index).toBeGreaterThan(1)
  expect(c!.tailBytes).toBeGreaterThanOrEqual(500)
})

test('chooseTail keeps the prompt when it is within 2x target', () => {
  const ms = [user('aaaa'), asst('bbbb'), user('cccc'), asst('dddd')]
  expect(chooseTail(ms, 4)?.kind).toBe('prompt')
})

test('chooseTail returns the prompt when no later round boundary exists', () => {
  const ms = [user('p0'), asst('a'), user('z'.repeat(1000))]
  expect(chooseTail(ms, 10)).toEqual({ index: 2, kind: 'prompt', tailBytes: 1000 })
})
