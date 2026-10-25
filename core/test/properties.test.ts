// Property tests for the cyberthymesia core (SPEC §10). Seeded PRNG, random item
// streams, every store in a fresh temp home. A failure message starts with the
// seed that reproduces it. Run: node --test core/test/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NormItem, Store } from '../src/types.ts'
import { NODE, PAGE, PIN_BYTES, bytes, canonical, refOf, sha256hex } from '../src/util.ts'
import { roots as rootsOf } from '../src/util.ts'
import { recentBytes, recentLines } from '../src/view.ts'
import { mthReference } from '../src/merkle.ts'
import { aggText, combine, leafText, mergeClip, tag, toolDigest } from '../src/leaves.ts'
import type { AggMeta, ItemRow } from '../src/leaves.ts'

// index.ts may not exist yet: store tests then fail loudly, pure parts still run.
const mod: any = await import('../src/index.ts').catch((e: Error) => ({
  openStore: () => {
    throw new Error('core/src/index.ts unavailable: ' + e.message)
  },
}))

// ---------- seeded randomness and streams ----------

type Rng = { next(): number; int(a: number, b: number): number; pick<T>(xs: T[]): T; chance(p: number): boolean }

function rngOf(seed: number): Rng {
  let a = seed >>> 0 // mulberry32
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (x, y) => x + Math.floor(next() * (y - x + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
  }
}

const seeds = (n: number): number[] => Array.from({ length: n }, (_, k) => k + 1)

function each(list: number[], body: (seed: number, r: Rng) => void): void {
  for (const seed of list) {
    try {
      body(seed, rngOf(seed))
    } catch (e: any) {
      throw new Error(`[seed ${seed}] ${e?.stack ?? e}`)
    }
  }
}

// Words avoid every directive keyword and every error keyword.
const WORDS = ['alpha', 'build', 'cache', 'delta', 'engine', 'file', 'graph', 'hash', 'index', 'json', 'kernel', 'lambda', 'merge', 'node', 'output', 'parse', 'query', 'route', 'schema', 'tree', 'union', 'value', 'widget', 'yield']
const ODD = ['😀', '🚀', '日本語', '中文字符', 'é', 'ñ', '—', '𝒳']

function words(r: Rng, target: number, ascii = false): string {
  let s = ''
  while (bytes(s) < target) {
    const w = !ascii && r.chance(0.12) ? r.pick(ODD) : r.pick(WORDS)
    s += (s === '' ? '' : ascii || !r.chance(0.08) ? ' ' : '\n') + w
  }
  return s
}

function size(r: Rng): number {
  const t = r.next()
  return t < 0.3 ? r.int(1, 40) : t < 0.6 ? r.int(40, 300) : t < 0.8 ? r.int(300, 900) : t < 0.97 ? r.int(2000, 5000) : r.int(5000, 9000)
}

const CMDS = ['npm test', 'make build', 'git status', 'node app.js']
const FILES = ['/src/a.ts', '/src/b.ts', '/lib/c.py', '/README.md']
// The last two are cyth's own tools (both spellings): logged, never shown in <recent>.
const TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebFetch', 'Agent', 'Custom', 'memory_find', 'mcp__cyberthymesia__memory_zoom']

function toolInput(r: Rng, name: string): unknown {
  switch (name) {
    case 'Bash': return { command: r.pick(CMDS) }
    case 'Read': return { file_path: r.pick(FILES), offset: r.int(1, 90) }
    case 'Edit': return { file_path: r.pick(FILES), old_string: 'a\nb', new_string: 'c' }
    case 'Write': return { file_path: r.pick(FILES), content: 'x\ny\nz' }
    case 'Grep': case 'Glob': return { pattern: r.pick(WORDS) + '*' }
    case 'WebFetch': return { url: 'https://example.com/' + r.pick(WORDS) }
    case 'Agent': return { description: words(r, 20, true) }
    default: return { x: r.int(0, 9), y: [1, 'é'] }
  }
}

type Pair = { harness: 'claude' | 'pi'; session: string }

function genStream(seed: number, n: number): NormItem[] {
  const r = rngOf(seed * 7919)
  const sessions: Pair[] = Array.from({ length: r.int(2, 4) }, (_, k) => ({
    harness: k % 2 === 0 ? 'claude' : 'pi',
    session: `s${k}${r.int(1000, 9999).toString(16)}`,
  }))
  const out: NormItem[] = []
  let cur = sessions[0]
  for (let k = 0; k < n; k++) {
    if (r.chance(0.2)) cur = r.pick(sessions)
    const base = { harness: cur.harness, session: cur.session, uuid: `${cur.session}-${k}`, ts: new Date(Date.UTC(2026, 0, 1) + k * 1000).toISOString() }
    const t = r.next()
    if (t < 0.3) {
      const dir = r.chance(0.12)
      const text = dir ? r.pick(['never ', 'Always ', 'from now on ', 'Do not ever ', 'remember that ']) + words(r, r.int(10, 300)) : words(r, size(r))
      out.push({ ...base, kind: 'user', text })
    } else if (t < 0.6) {
      out.push({ ...base, kind: 'assistant', text: words(r, size(r)) })
    } else {
      const name = r.pick(TOOLS)
      const isError = r.chance(0.15)
      let output = words(r, size(r))
      if (isError || r.chance(0.1)) output = 'error: ' + output
      out.push({ ...base, kind: 'tool', text: output, tool: { name, input: toolInput(r, name), output, isError } })
    }
  }
  return out
}

const pairsOf = (items: NormItem[]): Pair[] => {
  const m = new Map<string, Pair>()
  for (const it of items) m.set(it.harness + '/' + it.session, { harness: it.harness, session: it.session })
  return [...m.values()]
}

function chunked<T>(r: Rng, xs: T[], max = 40): T[][] {
  const out: T[][] = []
  for (let k = 0; k < xs.length; ) {
    const c = r.int(1, max)
    out.push(xs.slice(k, k + c))
    k += c
  }
  return out
}

// Item hash exactly as DESIGN.md says, computed from the stream (seq = index).
function itemHashes(items: NormItem[]): Buffer[] {
  return items.map((it, seq) =>
    Buffer.from(
      sha256hex(canonical({ seq, harness: it.harness, session: it.session, agent: it.agent ?? null, uuid: it.uuid, kind: it.kind, ts: it.ts, text: it.tool ? it.tool.output : it.text, meta: it.tool ? { name: it.tool.name, input: it.tool.input, isError: it.tool.isError } : null })),
      'hex',
    ),
  )
}
const mthHex = (items: NormItem[], n: number): string => mthReference(itemHashes(items).slice(0, n)).toString('hex')

function withStore<T>(fn: (s: Store) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'cyth-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'cyth-cwd-'))
  let s: Store | undefined
  try {
    s = mod.openStore(cwd, { home }) as Store
    return fn(s)
  } finally {
    try { s?.close() } catch { /* best-effort close during teardown */ }
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
}

// ---------- block parsing ----------

type Recent = { seq: number; line: string }

function recentOf(block: string): Recent[] {
  const a = block.indexOf('<recent>\n')
  const b = block.indexOf('</recent>\n')
  assert.ok(a >= 0 && b > a, 'block has a <recent> section')
  assert.ok(!block.includes('<memory>'), 'no <memory> tree in the block')
  const body = block.slice(a + 9, b)
  return body.split('\n').filter((l) => l !== '').map((line) => {
    const m = /^#(\d+)\|/.exec(line)
    assert.ok(m, 'recent line parses: ' + line.slice(0, 60))
    return { seq: Number(m[1]), line }
  })
}

const rowOf = (it: NormItem, seq: number): ItemRow => ({ seq, harness: it.harness, session: it.session, agent: it.agent ?? null, uuid: it.uuid, kind: it.kind, ts: it.ts, text: it.tool ? it.tool.output : it.text, meta: it.tool ? { name: it.tool.name, input: it.tool.input, isError: it.tool.isError } : null })

// The exact line SPEC §3 asks for item `seq` of the stream: `#n|` + its leaf
// line, tagged where the session changes, and always on the oldest line.
const own = (it: NormItem): boolean => it.kind === 'tool' && /^(mcp__cyberthymesia__)?memory_(find|zoom|pin|unpin|pins)$/.test(it.tool?.name ?? '')

// The shown items before `end` (cyth's own tool calls are not shown), oldest first.
const shownBefore = (items: NormItem[], end: number): number[] => items.slice(0, end).flatMap((it, k) => (own(it) ? [] : [k]))

function expectedLine(items: NormItem[], seq: number, first: boolean): string {
  const it = items[seq]
  let p = seq - 1
  while (p >= 0 && own(items[p])) p--
  const prev = p >= 0 ? items[p] : undefined
  const changes = !prev || prev.harness !== it.harness || prev.session !== it.session
  return `#${seq}|` + leafText(rowOf(it, seq), first || changes ? tag(it.harness, it.session) : null).text
}

const recentB = (rs: Recent[]): number => rs.reduce((n, x) => n + bytes(x.line) + 1, 0)

// Checks one rendered block against the stream: whole expected lines, newest
// last and contiguous up to tailStart - 1, within the header budget, and as
// many lines as fit (the next older one would not).
function assertRecent(items: NormItem[], v: { block: string; tailStart: number; viewEnd: number }, header: number): void {
  assert.equal(v.viewEnd, v.tailStart, 'viewEnd is tailStart')
  const rs = recentOf(v.block)
  assert.ok(recentB(rs) <= header, `<recent> ${recentB(rs)} > HEADER ${header}`)
  const shown = shownBefore(items, v.tailStart)
  rs.forEach((x, k) => {
    assert.ok(x.seq < v.tailStart, `#${x.seq} is at or after tailStart ${v.tailStart}`)
    assert.equal(x.seq, shown[shown.length - rs.length + k], 'newest last, contiguous over shown items, ending at the last before tailStart')
    assert.equal(x.line, expectedLine(items, x.seq, k === 0), `#${x.seq} is its whole leaf line`)
  })
  if (rs.length < shown.length) {
    const next = shown[shown.length - rs.length - 1]
    const grown = rs.length === 0 ? 0 : recentB(rs) - bytes(rs[0].line) + bytes(expectedLine(items, rs[0].seq, false))
    assert.ok(grown + bytes(expectedLine(items, next, true)) + 1 > header, `#${next} would have fit`)
  }
}

// ---------- driver for P1/P2: random ingest / view / fold sequences ----------

function drive(seed: number, r: Rng, header: number, check: (items: NormItem[], v: ReturnType<Store['view']>) => void): void {
  const items = genStream(seed, 320)
  const pairs = pairsOf(items)
  withStore((s) => {
    let at = 0
    let count = 0
    const look = (p: Pair): void => check(items, s.view(p.harness, p.session, { header, tailStart: r.int(0, count) }))
    for (const p of pairs) look(p)
    while (at < items.length) {
      const op = r.next()
      if (op < 0.45) {
        const c = items.slice(at, at + r.int(1, 60))
        at += c.length
        s.ingest(c)
        count = at
      } else if (op < 0.7) {
        look(r.pick(pairs))
      } else {
        const p = r.pick(pairs)
        s.fold(p.harness, p.session, r.int(0, count + 3))
        look(p)
      }
    }
    for (const p of pairs) {
      s.fold(p.harness, p.session, count)
      look(p)
    }
    const v = s.verify()
    assert.deepEqual(v.problems, [])
    assert.equal(v.ok, true)
  })
}

// ---------- the properties ----------

test('P1 <recent> is whole leaf lines, newest last, never at or after tailStart (pure and store)', () => {
  each(seeds(40), (_seed, r) => {
    const len = new Map<number, number>()
    const lineOf = (seq: number, first: boolean): string => {
      if (!len.has(seq)) len.set(seq, r.int(5, 520))
      return `#${seq}|` + (first ? '@t ' : '') + 'x'.repeat(len.get(seq)!)
    }
    const end = r.int(0, 300)
    const budget = r.int(1, 20000)
    const skipped = new Set(Array.from({ length: end }, (_, k) => k).filter(() => r.chance(0.2)))
    const kept = Array.from({ length: end }, (_, k) => k).filter((k) => !skipped.has(k))
    const out = recentLines(end, budget, lineOf, (seq) => skipped.has(seq))
    out.forEach((l, k) => {
      const seq = kept[kept.length - out.length + k]
      assert.equal(l, lineOf(seq, k === 0), `line ${k} is #${seq} whole`)
    })
  })
  each(seeds(20), (seed, r) => drive(seed, r, r.pick([1024, 4096, 8192]), (items, v) => {
    const rs = recentOf(v.block)
    const shown = shownBefore(items, v.tailStart)
    rs.forEach((x, k) => {
      assert.ok(x.seq < v.tailStart)
      assert.ok(!own(items[x.seq]), `#${x.seq} is cyth's own tool call`)
      assert.equal(x.seq, shown[shown.length - rs.length + k])
      assert.equal(x.line, expectedLine(items, x.seq, k === 0))
    })
  }))
})

test('P2 <recent> is at most HEADER bytes and holds every line that fits (pure and store)', () => {
  each(seeds(40), (_seed, r) => {
    const lineOf = (seq: number, first: boolean): string => `#${seq}|` + (first ? '@t ' : '') + 'y'.repeat((seq * 37) % 500 + 3)
    const end = r.int(0, 300)
    const budget = r.int(1, 20000)
    const out = recentLines(end, budget, lineOf)
    assert.ok(recentBytes(out) <= budget, `${recentBytes(out)} > ${budget}`)
    if (out.length < end) {
      const next = end - out.length - 1
      const grown = out.length === 0 ? 0 : recentBytes(out) - bytes(out[0]) + bytes(lineOf(next + 1, false))
      assert.ok(grown + bytes(lineOf(next, true)) + 1 > budget, 'the next older line would not fit')
    }
  })
  // Boundary: each line's '\n' counts. Ten 9-byte lines cost 10 bytes each.
  const nine = (seq: number): string => `#${seq}|` + 'z'.repeat(6)
  assert.equal(recentLines(10, 30, nine).length, 3)
  assert.equal(recentLines(10, 29, nine).length, 2, 'a 29-byte budget holds two 10-byte lines, not three')
  let full = 0
  each(seeds(20), (seed, r) => {
    const header = r.pick([1024, 4096, 8192])
    drive(seed, r, header, (items, v) => {
      assertRecent(items, v, header)
      if (recentOf(v.block).length < v.tailStart) full++
    })
  })
  assert.ok(full > 0, 'store runs reached sizes where the budget binds')
})

test('P2b the block is unchanged between folds while only the tail grows', () => {
  each(seeds(20), (seed, r) => {
    const items = genStream(seed, 200)
    withStore((s) => {
      const header = r.pick([1024, 8192])
      const first = r.int(1, 150)
      s.ingest(items.slice(0, first))
      const p = { harness: items[0].harness, session: items[0].session }
      const v0 = s.view(p.harness, p.session, { header, tailStart: r.int(0, first) })
      // The tail grows with plain replies: no directive and no tool, so no pin changes.
      const tail: NormItem[] = Array.from({ length: r.int(1, 80) }, (_, k) => ({ ...items[first], uuid: `tail-${seed}-${k}`, kind: 'assistant', tool: undefined, text: 'reply ' + k }))
      for (const c of chunked(r, tail, 10)) {
        s.ingest(c)
        const v = s.view(p.harness, p.session, { header })
        assert.ok(v.block === v0.block, 'block changed while only the tail grew')
        assert.equal(v.tailStart, v0.tailStart)
      }
      const before = s.view(p.harness, p.session, { header })
      s.fold(p.harness, p.session, before.tailStart + 1)
      const after = s.view(p.harness, p.session, { header })
      // Folding over one of cyth's own tool calls shows nothing new; over any other item it does.
      const crossed = [...items.slice(0, first), ...tail][before.tailStart]
      if (own(crossed)) assert.ok(after.block === before.block, 'folding over an own tool call leaves <recent> as it was')
      else assert.ok(after.block !== before.block, 'a fold that moves tailStart changes <recent>')
    })
  })
})

test('P3 every node text is <= 512 bytes and one line', () => {
  each(seeds(40), (seed, r) => {
    const items = genStream(seed, 40)
    const rows: ItemRow[] = items.map((it, seq) => ({ seq, harness: it.harness, session: it.session, agent: null, uuid: it.uuid, kind: it.kind, ts: it.ts, text: it.text, meta: it.tool ? { name: it.tool.name, input: it.tool.input, isError: it.tool.isError } : null }))
    const ok = (t: string): void => {
      assert.ok(bytes(t) <= NODE, `${bytes(t)} bytes: ${t.slice(0, 40)}`)
      assert.ok(!/[\n\r]/.test(t), 'one line')
      assert.ok(!t.includes('�'), 'valid UTF-8')
    }
    for (const row of rows) {
      ok(leafText(row, null).text)
      ok(leafText(row, tag(row.harness, row.session)).text)
      if (row.meta) ok(toolDigest(row.meta, row.text, 't:@' + tag(row.harness, row.session) + ' '))
    }
    for (let k = 0; k < 20; k++) ok(mergeClip(words(r, r.int(0, 1500)), words(r, r.int(0, 1500))))
    let agg: AggMeta = { tools: {}, files: [], fails: 0, oks: 0 }
    for (let k = 0; k < 12; k++) {
      const files: [string, number][] = Array.from({ length: r.int(0, 4) }, () => ['/very/long/' + words(r, r.int(5, 120)).replace(/ /g, '/'), r.int(1, 4)])
      const m: AggMeta = { tools: { [words(r, r.int(3, 60))]: r.int(1, 5), Bash: 1 }, files, fails: r.int(0, 9), oks: r.int(0, 9) }
      agg = combine(agg, m)
      ok(aggText(m))
      ok(aggText(agg))
    }
  })
  each(seeds(20), (seed, r) => {
    const items = genStream(seed, 150)
    withStore((s) => {
      s.ingest(items)
      const n = items.length
      for (let l = 1; 2 ** l <= n; l++) {
        for (let i = 0; (i + 1) * 2 ** l <= n; i++) {
          const lines = s.zoom(refOf(l, i)).split('\n')
          assert.equal(lines.length, 2, `${refOf(l, i)} zooms to exactly two single-line children`)
          for (const ln of lines) {
            const t = ln.slice(ln.indexOf('|') + 1)
            assert.ok(bytes(t) <= NODE, `${ln.slice(0, 30)}: ${bytes(t)} bytes`)
          }
        }
      }
      const rl = s.roots().split('\n')
      assert.equal(rl.length, rootsOf(n).length)
      for (const ln of rl) assert.ok(bytes(ln.slice(ln.indexOf('|') + 1)) <= NODE)
      assert.deepEqual(s.verify().problems, [])
    })
  })
})

test('P4 re-ingest is a no-op', () => {
  each(seeds(25), (seed, r) => {
    const items = genStream(seed, 150)
    withStore((s) => {
      for (const c of chunked(r, items)) s.ingest(c)
      const before = { st: s.status(), seq: items.map((it) => s.seqOf(it.harness, it.session, it.uuid)) }
      assert.equal(before.st.items, items.length)
      before.seq.forEach((q, k) => assert.equal(q, k))
      const again = s.ingest(items)
      assert.equal(again.added, 0)
      for (const c of chunked(r, [...items].reverse(), 17)) assert.equal(s.ingest(c).added, 0)
      for (const c of chunked(r, items, 5)) assert.equal(s.ingest(c).added, 0)
      assert.deepEqual(s.status(), before.st)
      assert.equal(s.verify().ok, true)
    })
  })
})

test('P5 Merkle root matches the reference; prefixes are stable; verify catches tampering', () => {
  each(seeds(25), (seed, r) => {
    const items = genStream(seed, 150)
    withStore((s) => {
      const probes: { n: number; root: string; sess: string }[] = []
      let at = 0
      for (const c of chunked(r, items, 30)) {
        s.ingest(c)
        at += c.length
        const sess = 'probe' + at
        const v = s.view('pi', sess, { tailStart: at })
        probes.push({ n: v.viewEnd, root: v.root, sess })
        assert.equal(s.status().root, mthHex(items, at), `status root at n=${at}`)
      }
      for (const p of probes) assert.equal(p.root, mthHex(items, p.n), `earlier prefix n=${p.n} unchanged after appends`)
      assert.equal(s.status().root, mthHex(items, items.length))
      assert.deepEqual(s.verify().problems, [])
      const k = r.int(0, items.length - 1)
      const db = new DatabaseSync(s.dbPath)
      try {
        const orig = (db.prepare('SELECT text FROM items WHERE seq = ?').get(k) as any).text as string
        db.prepare('UPDATE items SET text = ? WHERE seq = ?').run(orig + 'x', k)
        const bad = s.verify()
        assert.equal(bad.ok, false, `tampered item ${k} must fail verify`)
        assert.ok(bad.problems.length > 0)
        db.prepare('UPDATE items SET text = ? WHERE seq = ?').run(orig, k)
        assert.equal(s.verify().ok, true, 'restoring the item makes verify pass again')
      } finally {
        db.close()
      }
    })
  })
})

function document(it: NormItem, seq: number): string {
  const head = `#${seq} ${it.kind} ${it.harness}:${it.session}${it.agent ? ' agent ' + it.agent : ''} ${it.ts}\n`
  if (it.kind !== 'tool') return head + it.text
  const t = it.tool!
  return head + `tool ${t.name}${t.isError ? ' (isError)' : ''}\ninput: ${canonical(t.input)}\noutput:\n${t.output}`
}

test('P6 zoom of a range is its two children; paged zoom of an item reassembles it', () => {
  each(seeds(20), (seed, r) => {
    const items = genStream(seed, 50)
    // a 50 KB multi-byte item, plus emoji text whose page cut would fall inside a code point
    const cjk = words(r, 1, true) + '日本語中文字符'.repeat(2400)
    items[r.int(0, 49)] = { ...items[0], uuid: 'big-cjk', kind: 'assistant', text: cjk, tool: undefined }
    const out = '🚀' + 'a'.repeat(r.int(0, 3)) + '😀日é'.repeat(5200)
    items[r.int(0, 49)] = { ...items[1], uuid: 'big-tool', kind: 'tool', text: out, tool: { name: 'Bash', input: { command: 'cat big' }, output: out, isError: r.chance(0.5) } }
    const uniq = new Set(items.map((i) => i.harness + i.session + i.uuid))
    assert.equal(uniq.size, items.length)
    withStore((s) => {
      s.ingest(items)
      const n = items.length
      for (let q = 0; q < 40; q++) {
        const l = r.int(1, Math.floor(Math.log2(n)))
        const i = r.int(0, Math.floor(n / 2 ** l) - 1)
        const lines = s.zoom(refOf(l, i)).split('\n')
        assert.equal(lines.length, 2)
        assert.ok(lines[0].startsWith(refOf(l - 1, 2 * i) + '|'), `${refOf(l, i)} left child: ${lines[0].slice(0, 20)}`)
        assert.ok(lines[1].startsWith(refOf(l - 1, 2 * i + 1) + '|'), `${refOf(l, i)} right child: ${lines[1].slice(0, 20)}`)
      }
      assert.throws(() => s.zoom(`#0-${2 ** Math.ceil(Math.log2(n + 1)) - 1}`), 'range past the end throws')
      assert.throws(() => s.zoom('#' + n), 'unknown item throws')
      for (let k = 0; k < n; k++) {
        const doc = Buffer.from(document(items[k], k), 'utf8')
        let off = 0
        const got: Buffer[] = []
        for (let pages = 0; ; pages++) {
          assert.ok(pages < 20, 'paging terminates')
          const raw = s.zoom(off === 0 && pages === 0 && r.chance(0.5) ? `#${k}` : `#${k}@${off}`)
          const m = /\n\[#(\d+) bytes (\d+)-(\d+) of (\d+); (?:more: memory_zoom #\d+@(\d+)|end)\]$/.exec(raw)
          assert.ok(m, `item ${k} footer: ${raw.slice(-80)}`)
          const page = Buffer.from(raw.slice(0, m.index), 'utf8')
          assert.equal(Number(m[1]), k)
          assert.equal(Number(m[2]), off)
          assert.equal(Number(m[4]), doc.length)
          assert.equal(Number(m[3]), off + page.length)
          assert.ok(page.length <= PAGE && !page.toString('utf8').includes('�'), 'page within PAGE, no split code point')
          got.push(page)
          off += page.length
          if (m[5] === undefined) {
            assert.equal(off, doc.length, 'end footer only at the end')
            break
          }
          assert.equal(Number(m[5]), off, 'more: points at the next offset')
        }
        assert.ok(Buffer.concat(got).equals(doc), `item ${k} reassembles exactly`)
        if (doc.length > PAGE) assert.ok(got.length >= 2)
      }
      assert.throws(() => s.zoom(`#0@${bytes(document(items[0], 0)) + 1}`), 'offset past the end throws')
    })
  })
})

function pinLines(s: Store): { id: number; seq: number; kind: string }[] {
  const t = s.pins()
  if (t === 'no open pins') return []
  return t.split('\n').map((l) => {
    const m = /^\[(\d+)\] #(\d+) (directive|failure|manual): /.exec(l)
    assert.ok(m, 'pin line parses: ' + l.slice(0, 60))
    return { id: Number(m[1]), seq: Number(m[2]), kind: m[3] }
  })
}

const isDir = (it: NormItem): boolean => it.kind === 'user' && [...it.text].length <= 1000 && /\b(never|always|don't ever|do not ever|remember that|every time|from now on)\b/i.test(it.text)

test('P7 pins: quota respected, failures auto-resolve, heuristics never remove a pin', () => {
  let over = 0
  let under = 0
  // quota
  each(seeds(24), (seed, r) => {
    const count = 3 + ((seed * 5) % 28)
    const items: NormItem[] = Array.from({ length: count }, (_, k) => ({ harness: 'pi', session: 'p7aa', uuid: 'd' + k, kind: 'user', ts: new Date(Date.UTC(2026, 0, 1) + k * 1000).toISOString(), text: 'Never ' + words(r, r.int(300, 940), true) }))
    withStore((s) => {
      s.ingest(items)
      const v = s.view('pi', 'p7aa', { tailStart: count })
      const st = s.status()
      assert.equal(st.pins, count)
      const pinned = v.block.slice(v.block.indexOf('<pinned>'))
      const ls = pinned.split('\n').filter((l) => l.startsWith('['))
      assert.equal(ls.length, count)
      const refOnly = ls.map((l) => l.includes('(over quota: memory_zoom #'))
      const full = ls.filter((_, k) => !refOnly[k]).reduce((sum, l) => sum + bytes(l.slice(l.indexOf(' | ') + 3)), 0)
      assert.ok(full <= PIN_BYTES, `full-text pins ${full} > ${PIN_BYTES}`)
      const n = refOnly.filter(Boolean).length
      assert.equal(refOnly.join(), [...Array(n).fill(true), ...Array(count - n).fill(false)].join(), 'ref-only pins are the oldest ones')
      assert.equal(v.block.includes(`ALGEDONIC: ${n} pins over quota; review with memory_pins`), n > 0)
      assert.equal(st.algedonic, n > 0)
      assert.equal(v.algedonic, n > 0)
      if (n > 0) over++
      else under++
    })
  })
  assert.ok(over > 0 && under > 0, `both over-quota (${over}) and under-quota (${under}) cases ran`)

  // failure auto-resolve against a model of open failures per tool
  each(seeds(25), (seed, r) => {
    const open = new Map<string, number>()
    const items: NormItem[] = Array.from({ length: 40 }, (_, k) => {
      const command = r.pick(CMDS)
      const fail = r.chance(0.5)
      const output = fail ? (r.chance(0.5) ? 'error: boom ' + k : 'boom') : 'all good ' + k
      const isError = fail
      open.set('Bash', fail ? (open.get('Bash') ?? 0) + 1 : 0)
      return { harness: 'claude', session: 'p7bb', uuid: 'b' + k, kind: 'tool', ts: new Date(Date.UTC(2026, 0, 1) + k * 1000).toISOString(), text: output, tool: { name: 'Bash', input: { command }, output, isError } }
    })
    withStore((s) => {
      const model = new Map<string, number>()
      let at = 0
      for (const c of chunked(r, items, 8)) {
        s.ingest(c)
        for (const it of c) {
          const cmd = 'Bash'
          const failed = it.tool!.isError
          model.set(cmd, failed ? (model.get(cmd) ?? 0) + 1 : 0)
        }
        at += c.length
        const want = [...model.values()].reduce((a, b) => a + b, 0)
        assert.equal(s.status().pins, want, `open failure pins after ${at} items`)
        assert.equal(pinLines(s).length, want)
      }
      assert.equal(s.status().pins, [...open.values()].reduce((a, b) => a + b, 0))
    })
  })

  // heuristics never remove directive or manual pins
  each(seeds(20), (seed, r) => {
    const items = genStream(seed, 200)
    withStore((s) => {
      let prev = new Set<number>()
      let at = 0
      let manual: number | undefined
      for (const c of chunked(r, items, 25)) {
        s.ingest(c)
        at += c.length
        if (manual === undefined) {
          const k = r.int(0, at - 1)
          manual = s.pin('#' + k, 'keep me')
        }
        const now = pinLines(s)
        const keep = new Set(now.filter((p) => p.kind !== 'failure').map((p) => p.id))
        for (const id of prev) assert.ok(keep.has(id), `pin ${id} survived ingest up to ${at}`)
        assert.equal(now.filter((p) => p.kind === 'directive').length, items.slice(0, at).filter(isDir).length, 'one directive pin per directive item')
        assert.ok(keep.has(manual), 'manual pin open')
        prev = keep
      }
      assert.throws(() => s.pin('#0-1', 'range'), 'only items can be pinned')
      s.unpin(manual!)
      assert.ok(!pinLines(s).some((p) => p.id === manual))
      assert.throws(() => s.unpin(manual!), 'unpin of a resolved pin throws')
    })
  })
})

test('P8 determinism: the same input gives byte-identical view blocks', () => {
  each(seeds(20), (seed, r) => {
    const items = genStream(seed, 250)
    const pairs = pairsOf(items)
    type Op = { t: 'ingest'; c: NormItem[] } | { t: 'view'; p: Pair; tail: number; header: number } | { t: 'fold'; p: Pair; at: number }
    const ops: Op[] = []
    let n = 0
    for (const c of chunked(r, items, 50)) {
      ops.push({ t: 'ingest', c })
      n += c.length
      ops.push({ t: 'view', p: r.pick(pairs), tail: r.int(0, n), header: r.pick([512, 2048, 8192]) })
      ops.push({ t: 'fold', p: r.pick(pairs), at: r.int(0, n) })
      ops.push({ t: 'view', p: r.pick(pairs), tail: r.int(0, n), header: r.pick([512, 2048, 8192]) })
    }
    const run = (): string[] =>
      withStore((s) => {
        const log: string[] = []
        for (const op of ops) {
          if (op.t === 'ingest') log.push(JSON.stringify(s.ingest(op.c)))
          else if (op.t === 'fold') s.fold(op.p.harness, op.p.session, op.at)
          else {
            const v = s.view(op.p.harness, op.p.session, { header: op.header, tailStart: op.tail })
            log.push(v.block, JSON.stringify([v.viewEnd, v.tailStart, v.bytes, v.root, v.algedonic]))
          }
        }
        log.push(JSON.stringify(s.status()), s.roots())
        return log
      })
    const a = run()
    const b = run()
    assert.equal(a.length, b.length)
    a.forEach((x, k) => assert.ok(x === b[k], `output ${k} differs between runs`))
  })
})
