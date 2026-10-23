// The view (SPEC §3): an ordered list of parts covering [0, viewEnd), each a
// tree node with a text snapshot. reach() appends leaves; fit() merges the
// most due sibling pairs down to half once the memory lines pass `high`.
// Pure: node texts come from a lookup.

import { bytes, refOf, span } from './util.ts'

export type Part = { l: number; i: number; text: string }
export type ViewState = { parts: Part[]; viewEnd: number; tailStart: number }
export type TextOf = (l: number, i: number) => string

export const CONTRACT = `## Memory: cyberthymesia
This conversation never ends; nothing is ever lost. <memory> lists the project's
whole history as a binary tree of one-line summaries, oldest first: \`#a-b|...\`
covers items a..b, \`#n|...\` is one item. Detail fades with age. The raw messages
after it are the recent present, verbatim.
- The latest word on a thing is the truth. Before you act, guess or ask about
  anything past, find it in <memory> and zoom until you have it whole.
- memory_zoom(ref): open #a-b into its halves; #n gives the item whole (paged).
- memory_find(query): full-text search over every item, verbatim.
- memory_pin(ref, reason) / memory_unpin(id): keep something at full resolution.
- <pinned> items are alarms and standing orders: obey them until resolved.
- Summaries keep little of tool output: say in your reply what you learned that matters later.`

export function partLine(p: Part): string {
  return refOf(p.l, p.i) + '|' + p.text
}

export function partBytes(p: Part): number {
  return bytes(partLine(p)) + 1
}

export function memBytes(parts: Part[]): number {
  let n = 0
  for (const p of parts) n += partBytes(p)
  return n
}

export function reach(state: ViewState, end: number, textOf: TextOf): void {
  for (let i = state.viewEnd; i < end; i++) state.parts.push({ l: 0, i, text: textOf(0, i) })
  if (end > state.viewEnd) state.viewEnd = end
}

type Cand = { d: number; k: number; l: number; i: number }

function before(x: Cand, y: Cand): boolean {
  return x.d > y.d || (x.d === y.d && x.k < y.k)
}

class Heap {
  a: Cand[] = []
  push(c: Cand): void {
    const a = this.a
    a.push(c)
    let x = a.length - 1
    while (x > 0) {
      const p = (x - 1) >> 1
      if (!before(a[x], a[p])) break
      ;[a[x], a[p]] = [a[p], a[x]]
      x = p
    }
  }
  pop(): Cand | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let x = 0
      for (;;) {
        const l = 2 * x + 1
        const r = l + 1
        let m = x
        if (l < a.length && before(a[l], a[m])) m = l
        if (r < a.length && before(a[r], a[m])) m = r
        if (m === x) break
        ;[a[x], a[m]] = [a[m], a[x]]
        x = m
      }
    }
    return top
  }
}

// One batch: if the memory lines exceed `high`, refresh every snapshot, then
// merge the most due adjacent sibling pairs, d = (viewEnd+1)/2^l − i, ties to
// the older, until ≤ high/2 or nothing merges. Returns whether it batched.
export function fit(state: ViewState, high: number, textOf: TextOf): boolean {
  if (memBytes(state.parts) <= high) return false
  const view: (Part | null)[] = state.parts.map((p) => ({ l: p.l, i: p.i, text: textOf(p.l, p.i) }))
  const n = view.length
  const next = Array.from({ length: n }, (_, k) => k + 1)
  const prev = Array.from({ length: n }, (_, k) => k - 1)
  let size = 0
  for (const p of view) size += partBytes(p!)
  const T = state.viewEnd
  const heap = new Heap()
  const offer = (k: number): void => {
    if (k < 0 || k >= n) return
    const a = view[k]
    const j = next[k]
    const b = j < n ? view[j] : null
    if (!a || !b || a.l !== b.l || a.i % 2 !== 0 || b.i !== a.i + 1) return
    heap.push({ d: (T + 1) / 2 ** a.l - a.i, k, l: a.l, i: a.i })
  }
  for (let k = 0; k < n; k++) offer(k)
  const low = high / 2
  while (size > low) {
    const c = heap.pop()
    if (c === undefined) break
    const a = view[c.k]
    const j = next[c.k]
    const b = j < n ? view[j] : null
    if (!a || !b || a.l !== c.l || a.i !== c.i || b.l !== c.l || b.i !== c.i + 1) continue
    const up: Part = { l: a.l + 1, i: a.i / 2, text: textOf(a.l + 1, a.i / 2) }
    size += partBytes(up) - partBytes(a) - partBytes(b)
    view[c.k] = up
    view[j] = null
    next[c.k] = next[j]
    if (next[j] < n) prev[next[j]] = c.k
    offer(prev[c.k])
    offer(c.k)
  }
  state.parts = view.filter((p): p is Part => p !== null)
  return true
}

// Problems with a view's coverage of [0, viewEnd): gaps, overlaps, order,
// misalignment. Empty when it covers exactly.
export function coverage(parts: { l: number; i: number }[], viewEnd: number): string[] {
  const out: string[] = []
  let at = 0
  for (const p of parts) {
    if (!Number.isInteger(p.l) || !Number.isInteger(p.i) || p.l < 0 || p.i < 0) {
      out.push(`bad part (${p.l},${p.i})`)
      return out
    }
    const [lo, hi] = span(p.l, p.i)
    if (lo !== at) {
      out.push(`part ${refOf(p.l, p.i)} starts at ${lo}, expected ${at}`)
      return out
    }
    at = hi + 1
  }
  if (at !== viewEnd) out.push(`parts end at ${at}, viewEnd is ${viewEnd}`)
  return out
}

export function renderMemory(parts: Part[]): string {
  let s = '<memory>\n'
  for (const p of parts) s += partLine(p) + '\n'
  return s + '</memory>\n'
}

export function renderBlock(parts: Part[], pinned: string): string {
  return CONTRACT + '\n\n' + renderMemory(parts) + pinned
}
