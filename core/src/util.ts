// Small pure helpers: UTF-8 byte sizes and clipping, one-line text,
// canonical JSON, hashing. Everything here is deterministic.

import { createHash } from 'node:crypto'

export const NODE = 512
export const PAGE = 20000
export const PIN_BYTES = 8192
export const PIN_CLIP = 1024
export const HEADER = 8192 // bytes of <recent> lines (SPEC §3)
export const TAIL = 160 * 1024

export function bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

// The longest prefix of `s` that is at most `n` bytes, never splitting a
// code point.
export function clipBytes(s: string, n: number): string {
  if (n <= 0) return ''
  if (bytes(s) <= n) return s
  const buf = Buffer.from(s, 'utf8')
  let end = n
  // back off continuation bytes (10xxxxxx) so we cut on a boundary
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}

// Clip with a trailing ellipsis when something was cut; result ≤ n bytes.
export function clipMark(s: string, n: number): string {
  if (bytes(s) <= n) return s
  return clipBytes(s, n - 3) + '…'
}

// One line: every run of whitespace containing a line break becomes a
// single space; other control characters become spaces.
export function oneLine(s: string): string {
  let t = s
  if (/[\r\n]/.test(t)) t = t.replace(/\s*[\r\n]+\s*/g, ' ')
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(t)) t = t.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ')
  if (t.includes('\t')) t = t.replace(/\t/g, ' ')
  return t.trim()
}

export function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return '[' + v.map((x) => canonical(x === undefined ? null : x)).join(',') + ']'
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return 'null'
  return JSON.stringify(v)
}

export function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

export function sha256hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function lineCount(s: string): number {
  if (s === '') return 0
  let n = 1
  for (let k = s.indexOf('\n'); k >= 0; k = s.indexOf('\n', k + 1)) n++
  if (s.endsWith('\n')) n--
  return n
}

export function normTs(ts: unknown): string {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString()
  if (typeof ts === 'string' && ts !== '') {
    const d = Date.parse(ts)
    if (Number.isFinite(d)) return new Date(d).toISOString()
    return ts
  }
  return ''
}

// Node (l,i) span [lo, hi] inclusive.
export function span(l: number, i: number): [number, number] {
  const lo = i * 2 ** l
  return [lo, lo + 2 ** l - 1]
}

export function refOf(l: number, i: number): string {
  if (l === 0) return '#' + i
  const [lo, hi] = span(l, i)
  return '#' + lo + '-' + hi
}

export type Ref = { l: number; i: number } | { item: number; offset: number }

// Parse '#lo-hi', '#n', '#n@offset' (leading '#' optional). Throws on
// anything malformed; range checks are the caller's (it knows the count).
export function parseRef(ref: string): Ref {
  const s = String(ref).trim().replace(/^#/, '')
  let m = /^(\d+)-(\d+)$/.exec(s)
  if (m) {
    const lo = Number(m[1])
    const hi = Number(m[2])
    const n = hi - lo + 1
    if (!(n >= 1) || (n & (n - 1)) !== 0 || lo % n !== 0) {
      throw new Error(`bad ref #${s}: a range #lo-hi must be aligned, hi-lo+1 a power of two and lo a multiple of it`)
    }
    if (n === 1) return { l: 0, i: lo }
    return { l: Math.log2(n), i: lo / n }
  }
  m = /^(\d+)(?:@(\d+))?$/.exec(s)
  if (m) return { item: Number(m[1]), offset: m[2] === undefined ? 0 : Number(m[2]) }
  throw new Error(`bad ref "${ref}": expected #n, #n@offset or #lo-hi`)
}

// Roots of the aligned tree over [0, n): one node per set bit, largest first.
export function roots(n: number): { l: number; i: number }[] {
  const out: { l: number; i: number }[] = []
  let at = 0
  for (let l = 52; l >= 0; l--) {
    const size = 2 ** l
    if (at + size <= n) {
      out.push({ l, i: at / size })
      at += size
    }
  }
  return out
}
