// Pure tail selection for session.compact (SPEC §3 Fold, §9 claude-code).
// No `$` here: it is unit-tested directly and by the compaction test.
import type { SessionMessage } from 'claude-code'

const encoder = new TextEncoder()

function bytes(s: string): number {
  return encoder.encode(s).length
}

/** Approximate raw bytes a message costs in the tail: its text plus its tool traffic. */
export function messageBytes(m: SessionMessage): number {
  let n = bytes(m.text)
  for (const u of m.toolUses) n += bytes(JSON.stringify(u.input ?? {})) + bytes(u.text ?? '')
  for (const r of m.toolResults ?? []) n += bytes(r.text)
  return n
}

/** A user prompt: a user message with words and no tool results. */
export function isPrompt(m: SessionMessage): boolean {
  return m.role === 'user' && (m.toolResults ?? []).length === 0 && m.text.trim() !== ''
}

/**
 * Cuts where no tool_use and its tool_result fall on different sides: every
 * id used before `i` is answered before `i`, and no result at or after `i`
 * answers a use before `i`. A use with no result anywhere does not block.
 */
export function cleanCuts(messages: readonly SessionMessage[]): boolean[] {
  const resultAt = new Map<string, number>()
  messages.forEach((m, i) => {
    for (const r of m.toolResults ?? []) resultAt.set(r.tool_use_id, i)
  })
  const clean: boolean[] = new Array(messages.length + 1).fill(true)
  messages.forEach((m, i) => {
    for (const u of m.toolUses) {
      const j = resultAt.get(u.tool_use_id)
      // use at i, result at j > i: every cut in (i, j] splits the pair.
      if (j !== undefined) for (let k = i + 1; k <= j; k++) clean[k] = false
    }
  })
  return clean
}

export type Boundary = { index: number; kind: 'prompt' | 'round'; tailBytes: number }

/**
 * The index the raw tail starts at, leaving about `target` bytes: the latest
 * clean prompt boundary whose suffix reaches `target`, else the earliest one.
 * If that still leaves more than 2×target (one prompt followed by a long
 * agentic run), fall back to a clean assistant-round boundary. Never 0 (that
 * folds nothing); undefined when no cut exists.
 */
export function chooseTail(messages: readonly SessionMessage[], target: number): Boundary | undefined {
  const n = messages.length
  if (n < 2) return undefined
  const clean = cleanCuts(messages)
  const suffix: number[] = new Array(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + messageBytes(messages[i]!)

  const pick = (ok: (m: SessionMessage) => boolean): number | undefined => {
    let earliest: number | undefined
    for (let i = n - 1; i >= 1; i--) {
      if (!clean[i] || !ok(messages[i]!)) continue
      if (suffix[i]! >= target) return i
      earliest = i
    }
    return earliest
  }

  const prompt = pick(isPrompt)
  if (prompt !== undefined && suffix[prompt]! <= 2 * target) {
    return { index: prompt, kind: 'prompt', tailBytes: suffix[prompt]! }
  }
  const round = pick(m => m.role === 'assistant')
  if (round !== undefined && (prompt === undefined || round > prompt)) {
    return { index: round, kind: 'round', tailBytes: suffix[round]! }
  }
  if (prompt !== undefined) return { index: prompt, kind: 'prompt', tailBytes: suffix[prompt]! }
  return undefined
}
