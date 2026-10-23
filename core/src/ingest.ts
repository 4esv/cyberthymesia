// Transcript parsers: Claude Code and Pi JSONL into NormItems (SPEC §1).
// A tool item is made when its result arrives; calls still waiting are
// returned as `open` so the store can pair them on a later sync.

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { NormItem } from './types.ts'
import { normTs } from './util.ts'

export type Harness = 'claude' | 'pi'
export type Call = { harness: Harness; session: string; agent?: string; id: string; name: string; input: unknown; ts: string }
export type Raw = { harness: Harness; session: string; uuid: string; thinking: string }
export type Lookup = (harness: Harness, session: string, id: string) => Call | undefined
export type Chunk = { items: NormItem[]; raw: Raw[]; open: Call[]; closed: Call[]; end: number; bad: number }

// Bytes [start, last newline] of a file: complete lines only, so a partial
// trailing line is never consumed.
export function readLines(file: string, start: number): { lines: string[]; end: number } {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    if (size <= start) return { lines: [], end: Math.min(start, size) }
    const buf = Buffer.alloc(size - start)
    let got = 0
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, start + got)
      if (n === 0) break
      got += n
    }
    const data = buf.subarray(0, got)
    const nl = data.lastIndexOf(10)
    if (nl < 0) return { lines: [], end: start }
    const text = data.subarray(0, nl).toString('utf8')
    return { lines: text.split('\n'), end: start + nl + 1 }
  } finally {
    fs.closeSync(fd)
  }
}

export function firstLine(file: string, max = 1 << 20): string | null {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size))
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const nl = buf.subarray(0, n).indexOf(10)
    return nl < 0 ? null : buf.subarray(0, nl).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function parse(line: string): any {
  if (line.trim() === '') return undefined
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content === undefined || content === null ? '' : JSON.stringify(content)
  const out: string[] = []
  for (const b of content) {
    if (b && typeof b === 'object') {
      if (b.type === 'text' && typeof b.text === 'string') out.push(b.text)
      else if (b.type === 'image') out.push('[image]')
      else if (typeof b.text === 'string') out.push(b.text)
    } else if (typeof b === 'string') out.push(b)
  }
  return out.join('\n')
}

function injected(text: string): boolean {
  return text.trimStart().startsWith('<')
}

class Pairing {
  local = new Map<string, Call>()
  closed: Call[] = []
  lookup: Lookup
  constructor(lookup: Lookup) {
    this.lookup = lookup
  }
  open(c: Call): void {
    this.local.set(c.session + '\0' + c.id, c)
  }
  take(harness: Harness, session: string, id: string): Call | undefined {
    const k = session + '\0' + id
    const c = this.local.get(k)
    if (c) {
      this.local.delete(k)
      return c
    }
    const far = this.lookup(harness, session, id)
    if (far) this.closed.push(far)
    return far
  }
}

function agentOfFile(file: string): string | undefined {
  const base = path.basename(file, '.jsonl')
  return path.basename(path.dirname(file)) === 'subagents' && base.startsWith('agent-') ? base.slice(6) : undefined
}

export function parseClaude(file: string, start: number, lookup: Lookup): Chunk {
  const { lines, end } = readLines(file, start)
  const items: NormItem[] = []
  const raw: Raw[] = []
  const pair = new Pairing(lookup)
  const fileAgent = agentOfFile(file)
  let bad = 0
  for (const line of lines) {
    const d = parse(line)
    if (d === undefined) continue
    if (d === null) {
      bad++
      continue
    }
    // isCompactSummary: the engine's own compaction summary, not anyone's words.
    if ((d.type !== 'user' && d.type !== 'assistant') || d.isMeta === true || d.isCompactSummary === true) continue
    const msg = d.message
    if (!msg || typeof d.uuid !== 'string' || typeof d.sessionId !== 'string') continue
    const session: string = d.sessionId
    const agent: string | undefined = typeof d.agentId === 'string' ? d.agentId : fileAgent ?? (d.isSidechain === true ? 'sidechain' : undefined)
    const ts = normTs(d.timestamp)
    // entrypoint sdk-cli = claude -p: a one-shot run, never a standing order.
    const base = { harness: 'claude' as const, session, ...(agent !== undefined ? { agent } : {}), ...(d.entrypoint === 'sdk-cli' ? { oneShot: true } : {}) }
    const content = msg.content
    if (d.type === 'user') {
      if (typeof content === 'string') {
        if (!injected(content) && content.trim() !== '') items.push({ ...base, uuid: d.uuid + ':0', kind: 'user', ts, text: content })
        continue
      }
      if (!Array.isArray(content)) continue
      const parts: string[] = []
      let first = -1
      content.forEach((b: any, k: number) => {
        if (!b || typeof b !== 'object') return
        if (b.type === 'tool_result') {
          const id = String(b.tool_use_id ?? '')
          const call = pair.take('claude', session, id)
          items.push({
            ...base,
            ...(call?.agent !== undefined ? { agent: call.agent } : {}),
            uuid: id,
            kind: 'tool',
            ts,
            text: '',
            tool: { name: call?.name ?? 'unknown', input: call?.input ?? null, output: blockText(b.content), isError: b.is_error === true },
          })
        } else if (b.type === 'text' && typeof b.text === 'string') {
          if (injected(b.text) || b.text.trim() === '') return
          if (first < 0) first = k
          parts.push(b.text)
        } else if (b.type === 'image') {
          if (first < 0) first = k
          parts.push('[image]')
        }
      })
      if (parts.length > 0) items.push({ ...base, uuid: d.uuid + ':' + first, kind: 'user', ts, text: parts.join('\n') })
      continue
    }
    // assistant
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    blocks.forEach((b: any, k: number) => {
      if (!b || typeof b !== 'object') return
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') {
        items.push({ ...base, uuid: d.uuid + ':' + k, kind: 'assistant', ts, text: b.text })
      } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking !== '') {
        raw.push({ harness: 'claude', session, uuid: d.uuid + ':' + k, thinking: b.thinking })
      } else if (b.type === 'tool_use' && typeof b.id === 'string') {
        pair.open({ ...base, id: b.id, name: String(b.name ?? 'unknown'), input: b.input ?? null, ts })
      }
    })
  }
  return { items, raw, open: [...pair.local.values()], closed: pair.closed, end, bad }
}

export function piHeader(file: string): { id: string; cwd: string } | null {
  const l = firstLine(file)
  const d = l === null ? null : parse(l)
  return d && d.type === 'session' && typeof d.id === 'string' ? { id: d.id, cwd: String(d.cwd ?? '') } : null
}

export function parsePi(file: string, start: number, lookup: Lookup, oneShot = false): Chunk {
  const head = piHeader(file)
  const { lines, end } = readLines(file, start)
  const items: NormItem[] = []
  const raw: Raw[] = []
  const pair = new Pairing(lookup)
  let bad = 0
  if (head === null) return { items, raw, open: [], closed: [], end: start, bad: 0 }
  const session = head.id
  const base = { harness: 'pi' as const, session, ...(oneShot ? { oneShot: true } : {}) }
  for (const line of lines) {
    const d = parse(line)
    if (d === undefined) continue
    if (d === null) {
      bad++
      continue
    }
    if (d.type !== 'message' || !d.message || typeof d.id !== 'string') continue
    const m = d.message
    const ts = normTs(d.timestamp ?? m.timestamp)
    if (m.role === 'user') {
      const content = m.content
      const text = typeof content === 'string' ? content : blockText(content)
      if (text.trim() !== '') items.push({ ...base, uuid: d.id + ':0', kind: 'user', ts, text })
    } else if (m.role === 'assistant') {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : []
      blocks.forEach((b: any, k: number) => {
        if (!b || typeof b !== 'object') return
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') {
          items.push({ ...base, uuid: d.id + ':' + k, kind: 'assistant', ts, text: b.text })
        } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking !== '') {
          raw.push({ harness: 'pi', session, uuid: d.id + ':' + k, thinking: b.thinking })
        } else if (b.type === 'toolCall' && typeof b.id === 'string') {
          pair.open({ ...base, id: b.id, name: String(b.name ?? 'unknown'), input: b.arguments ?? null, ts })
        }
      })
    } else if (m.role === 'toolResult') {
      const id = String(m.toolCallId ?? '')
      const call = pair.take('pi', session, id)
      items.push({
        ...base,
        uuid: id,
        kind: 'tool',
        ts,
        text: '',
        tool: {
          name: call?.name ?? String(m.toolName ?? 'unknown'),
          input: call?.input ?? null,
          output: blockText(m.content),
          isError: m.isError === true,
        },
      })
    }
  }
  return { items, raw, open: [...pair.local.values()], closed: pair.closed, end, bad }
}

// The cwd a Claude transcript was recorded in: the first record carrying one.
export function claudeCwd(file: string): string | null {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const step = 1 << 16
    let carry = ''
    for (let at = 0; at < size && at < 1 << 22; at += step) {
      const buf = Buffer.alloc(Math.min(step, size - at))
      fs.readSync(fd, buf, 0, buf.length, at)
      const text = carry + buf.toString('utf8')
      const parts = text.split('\n')
      carry = parts.pop() ?? ''
      for (const l of parts) {
        if (!l.includes('"cwd"')) continue
        const d = parse(l)
        if (d && typeof d.cwd === 'string' && d.cwd !== '') return d.cwd
      }
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

export function listClaude(dir: string): string[] {
  const out: string[] = []
  let projects: string[] = []
  try {
    projects = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const p of projects.sort()) {
    const pd = path.join(dir, p)
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(pd, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(pd, e.name))
      else if (e.isDirectory()) {
        const sub = path.join(pd, e.name, 'subagents')
        try {
          for (const f of fs.readdirSync(sub).sort()) if (f.endsWith('.jsonl')) out.push(path.join(sub, f))
        } catch {
          // no subagents
        }
      }
    }
  }
  return out
}

export function listPi(dir: string): string[] {
  const out: string[] = []
  let projects: string[] = []
  try {
    projects = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const p of projects.sort()) {
    const pd = path.join(dir, p)
    try {
      for (const f of fs.readdirSync(pd).sort()) if (f.endsWith('.jsonl')) out.push(path.join(pd, f))
    } catch {
      // not a dir
    }
  }
  return out
}
