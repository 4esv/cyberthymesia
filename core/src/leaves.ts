// Node texts (SPEC §2): leaves, deterministic tool digests, merge texts,
// det aggregates and the model summary prompts. Pure functions.

import { NODE, bytes, clipBytes, clipMark, lineCount, oneLine } from './util.ts'

export type Harness = 'claude' | 'pi'
export type Kind = 'user' | 'assistant' | 'tool'
export type Source = 'verbatim' | 'det' | 'model' | 'clip'

// What a tool item keeps in `meta` (its output is the item's `text`).
export type ToolMeta = { name: string; input: unknown; isError: boolean }

// A det node's meta: what the tool items under it did.
export type AggMeta = { tools: Record<string, number>; files: [string, number][]; fails: number; oks: number }

export type ItemRow = {
  seq: number
  harness: Harness
  session: string
  agent: string | null
  uuid: string
  kind: Kind
  ts: string
  text: string
  meta: ToolMeta | null
}

const ERRLINE = /error|fail|exception|traceback/i
const MERGE_HALF = Math.floor((NODE - 5) / 2) // 253
const SEP = ' … ' // 5 bytes

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function lines(s: unknown): number {
  return typeof s === 'string' ? lineCount(s) : 0
}

function nonEmptyLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter((x) => x !== '')
}

export type Key = { display: string; norm: string; file?: string }

// The key argument of a tool call (SPEC §2), its normalized form for
// failure auto-resolve (§5), and the file it touches, if any.
export function keyArg(name: string, input: unknown, output: string, ok: boolean): Key {
  const lower = name.toLowerCase()
  const a = obj(input)
  const file = str(a.file_path) ?? str(a.path) ?? str(a.notebook_path)
  switch (lower) {
    case 'bash': {
      const cmd = str(a.command) ?? ''
      const flat = oneLine(cmd).replace(/\s+/g, ' ')
      return { display: flat, norm: 'bash:' + flat }
    }
    case 'read': {
      const off = num(a.offset)
      const lim = num(a.limit)
      const range = off !== undefined || lim !== undefined ? ` [${off ?? 1}${lim !== undefined ? '+' + lim : ''}]` : ''
      return { display: (file ?? '?') + range, norm: 'read:' + (file ?? ''), file }
    }
    case 'edit':
    case 'multiedit': {
      let add = 0
      let rem = 0
      const edits = Array.isArray(a.edits) ? a.edits : [a]
      for (const e of edits) {
        const o = obj(e)
        add += lines(o.new_string ?? o.newText)
        rem += lines(o.old_string ?? o.oldText)
      }
      return { display: `${file ?? '?'} +${add} -${rem}`, norm: 'file:' + (file ?? ''), file }
    }
    case 'write':
      return { display: `${file ?? '?'} +${lines(a.content)}`, norm: 'file:' + (file ?? ''), file }
    case 'notebookedit':
      return { display: `${file ?? '?'} +${lines(a.new_source)}`, norm: 'file:' + (file ?? ''), file }
    case 'grep':
    case 'glob': {
      const pat = oneLine(str(a.pattern) ?? '')
      const count = ok ? ` (${nonEmptyLines(output).length} matches)` : ''
      return { display: pat + count, norm: lower + ':' + pat }
    }
    case 'agent':
    case 'task': {
      const d = oneLine(str(a.description) ?? '')
      return { display: d, norm: lower + ':' + d }
    }
    case 'webfetch': {
      const u = str(a.url) ?? ''
      return { display: u, norm: 'webfetch:' + u }
    }
    case 'websearch': {
      const q = oneLine(str(a.query) ?? '')
      return { display: q, norm: 'websearch:' + q }
    }
    default: {
      let j = ''
      try {
        j = input === undefined ? '' : JSON.stringify(input) ?? ''
      } catch {
        j = String(input)
      }
      const flat = oneLine(j)
      return { display: clipMark(flat, 160), norm: lower + ':' + flat, file }
    }
  }
}

function exitCode(output: string): number | undefined {
  const first = /^\s*Exit code (-?\d+)/.exec(output)
  if (first) return Number(first[1])
  const ls = nonEmptyLines(output)
  const last = ls.length > 0 ? /^Command exited with code (-?\d+)$/.exec(ls[ls.length - 1]) : null
  return last ? Number(last[1]) : undefined
}

export function toolOk(output: string, isError: boolean): boolean {
  if (isError) return false
  const code = exitCode(output)
  if (code !== undefined && code !== 0) return false
  return true
}

function tailLine(output: string, ok: boolean): string {
  const ls = nonEmptyLines(output)
  if (ls.length === 0) return ''
  if (!ok) {
    const hit = ls.find((x) => ERRLINE.test(x) && !/^Traceback \(most recent call last\)/.test(x))
    return hit ?? ls[0]
  }
  return ls[ls.length - 1]
}

// cyberthymesia's own memory tools, in both harness spellings (Pi `memory_find`,
// Claude Code `mcp__cyberthymesia__memory_find`). Their calls stay in the log,
// but search and <recent> leave them out: an earlier query is not a fact (SPEC §4).
export const CYTH_TOOLS: readonly string[] = ['memory_find', 'memory_zoom', 'memory_pin', 'memory_unpin', 'memory_pins']
  .flatMap((n) => [n, 'mcp__cyberthymesia__' + n])

export function cythTool(name: string): boolean {
  return CYTH_TOOLS.includes(name)
}

export function tag(harness: Harness, session: string): string {
  const alnum = session.match(/[a-zA-Z0-9]/g) ?? []
  return (harness === 'claude' ? 'c' : 'p') + alnum.slice(-4).join('')
}

export function prefix(kind: Kind, t: string | null): string {
  const k = kind === 'user' ? 'u:' : kind === 'assistant' ? 'a:' : 't:'
  return t === null ? k : k + '@' + t + ' '
}

export function toolDigest(meta: ToolMeta, output: string, pre: string): string {
  const ok = toolOk(output, meta.isError)
  const key = keyArg(meta.name, meta.input, output, ok)
  const head = pre + oneLine(meta.name) + (key.display !== '' ? ' ' + clipMark(oneLine(key.display), 200) : '')
  const mid = ` → ${ok ? 'ok' : 'ERR'}; ${lineCount(output)} lines; `
  const room = NODE - bytes(head) - bytes(mid)
  return clipMark(head + mid + clipMark(oneLine(tailLine(output, ok)), Math.max(0, room)), NODE)
}

export function leafMeta(meta: ToolMeta, output: string): AggMeta {
  const ok = toolOk(output, meta.isError)
  const key = keyArg(meta.name, meta.input, output, ok)
  return {
    tools: { [meta.name]: 1 },
    files: key.file !== undefined ? [[key.file, 1]] : [],
    fails: ok ? 0 : 1,
    oks: ok ? 1 : 0,
  }
}

// A leaf's text and source. `t` is the session tag when the session differs
// from the previous leaf's, else null.
export function leafText(item: ItemRow, t: string | null): { text: string; source: Source; meta: AggMeta | null } {
  const pre = prefix(item.kind, t)
  if (item.kind === 'tool') {
    const meta = item.meta ?? { name: '?', input: null, isError: false }
    return { text: toolDigest(meta, item.text, pre), source: 'det', meta: leafMeta(meta, item.text) }
  }
  const body = oneLine(item.text)
  if (bytes(pre) + bytes(body) <= NODE) return { text: pre + body, source: 'verbatim', meta: null }
  return { text: pre + clipMark(body, NODE - bytes(pre)), source: 'clip', meta: null }
}

export function mergeClip(a: string, b: string): string {
  return clipBytes(oneLine(a), MERGE_HALF) + SEP + clipBytes(oneLine(b), MERGE_HALF)
}

export function combine(a: AggMeta, b: AggMeta): AggMeta {
  const tools: Record<string, number> = {}
  for (const m of [a, b]) for (const [k, v] of Object.entries(m.tools)) tools[k] = (tools[k] ?? 0) + v
  const counts = new Map<string, number>()
  for (const m of [a, b]) for (const [f, n] of m.files) counts.set(f, (counts.get(f) ?? 0) + n)
  const order = [...counts.keys()]
  const files = [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || order.indexOf(x[0]) - order.indexOf(y[0]))
    .slice(0, 5)
  return { tools, files, fails: a.fails + b.fails, oks: a.oks + b.oks }
}

export function aggText(m: AggMeta): string {
  const tools = Object.entries(m.tools)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, v]) => `${oneLine(k)}×${v}`)
    .join(' ')
  const files = m.files.length > 0 ? '; files ' + m.files.map(([f]) => oneLine(f)).join(' ') : ''
  return clipMark(`t* ${tools}; ${m.oks} ok ${m.fails} ERR${files}`, NODE)
}
