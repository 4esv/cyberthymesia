// cyberthymesia core store (SPEC §8): one SQLite file per project holding an
// append-only, hashed log of every chat, shown to the model as a small fixed
// header (pins + the newest items) over full-text search and item zoom, with
// an algedonic pin channel, a Merkle tree over the log and a replayable audit
// log. Built on node:sqlite (DatabaseSync) with zero deps.

import { sessionRoot } from './sessions.ts'
import type { SessionId } from './sessions.ts'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { projectRoot, storePath } from './project.ts'
import { parseClaude, parsePi, claudeCwd, piHeader, listClaude, listPi } from './ingest.ts'
import type { Call } from './ingest.ts'
import {
  leafText, tag, mergeClip, combine, aggText,
} from './leaves.ts'
import type { ItemRow, AggMeta } from './leaves.ts'
import { recentLines, renderBlock } from './view.ts'
import { isDirective, toolKey, pinText, renderPins } from './pins.ts'
import { leafHash, nodeHash, foldRoots, mthReference } from './merkle.ts'
import { CYTH_TOOLS, cythTool } from './leaves.ts'
import { NODE, PAGE, HEADER, bytes, clipMark, oneLine, canonical, sha256hex, span, refOf, parseRef, roots } from './util.ts'
import type { NormItem, Store, ForgetPlan } from './types.ts'
import { FEW, EXTRA, maxEdit, plainWords, nearWords, widenedQuery, orQuery, letterRange } from './fuzzy.ts'

function schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      seq INTEGER PRIMARY KEY,
      harness TEXT NOT NULL,
      session TEXT NOT NULL,
      agent TEXT,
      uuid TEXT NOT NULL,
      kind TEXT NOT NULL,
      ts TEXT NOT NULL,
      text TEXT NOT NULL,
      meta TEXT,
      hash TEXT NOT NULL,
      UNIQUE (harness, session, uuid)
    );
    CREATE INDEX IF NOT EXISTS items_by_time ON items (harness, session, ts);
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(body);
    CREATE TABLE IF NOT EXISTS raw (
      harness TEXT NOT NULL,
      session TEXT NOT NULL,
      uuid TEXT NOT NULL,
      thinking TEXT NOT NULL,
      PRIMARY KEY (harness, session, uuid)
    );
    CREATE TABLE IF NOT EXISTS nodes (
      l INTEGER NOT NULL,
      i INTEGER NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      meta TEXT,
      mh TEXT NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (l, i)
    );
    CREATE TABLE IF NOT EXISTS views (
      harness TEXT NOT NULL,
      session TEXT NOT NULL,
      parts TEXT NOT NULL,
      view_end INTEGER NOT NULL,
      tail_start INTEGER NOT NULL,
      high INTEGER NOT NULL,
      PRIMARY KEY (harness, session)
    );
    CREATE TABLE IF NOT EXISTS views_log (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,
      harness TEXT NOT NULL,
      session TEXT NOT NULL,
      n INTEGER NOT NULL,
      root TEXT NOT NULL,
      view_end INTEGER NOT NULL,
      tail_start INTEGER NOT NULL,
      sha TEXT NOT NULL,
      bytes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pins (
      id INTEGER PRIMARY KEY,
      seq INTEGER NOT NULL,
      reason TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT,
      resolved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS forgotten (
      harness TEXT NOT NULL,
      session TEXT NOT NULL,
      PRIMARY KEY (harness, session)
    );
    CREATE TABLE IF NOT EXISTS cursors (
      file TEXT PRIMARY KEY,
      harness TEXT NOT NULL,
      offset INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calls (
      harness TEXT NOT NULL,
      session TEXT NOT NULL,
      id TEXT NOT NULL,
      agent TEXT,
      name TEXT NOT NULL,
      input TEXT NOT NULL,
      ts TEXT NOT NULL,
      PRIMARY KEY (harness, session, id)
    );
  `)
}

type NodeRow = { l: number; i: number; text: string; source: string; meta: AggMeta | null; mh: string }
type ItemRec = ItemRow

// Parse a column we wrote as JSON; never let malformed data (DB tampering)
// throw from a read path — it falls back to null and surfaces in verify().
function safeParse(s: string | null): any {
  if (s === null) return null
  try { return JSON.parse(s) } catch { return null }
}

export function openStore(cwd: string, opts?: { home?: string; session?: SessionId }): Store {
  // A session stays in the store it first used, wherever its cwd has moved to.
  const root = opts?.session ? sessionRoot(opts.session, cwd, opts.home) : projectRoot(cwd)
  const dbPath = storePath(root, opts?.home)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  schema(db)

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      db.exec('COMMIT')
      return r
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw e
    }
  }

  const countItems = (): number => Number(db.prepare('SELECT COUNT(*) AS c FROM items').get().c)
  const buf = (hex: string): Buffer => Buffer.from(hex, 'hex')

  const itemStmt = db.prepare('SELECT harness, session, agent, uuid, kind, ts, text, meta FROM items WHERE seq = ?')
  const getItem = (seq: number): ItemRec => {
    const r = itemStmt.get(seq)
    if (!r) throw new Error(`item #${seq} does not exist`)
    return {
      seq, harness: r.harness, session: r.session, agent: r.agent, uuid: r.uuid,
      kind: r.kind, ts: r.ts, text: r.text, meta: safeParse(r.meta),
    }
  }

  const nodeStmt = db.prepare('SELECT text, source, meta, mh FROM nodes WHERE l = ? AND i = ?')
  const getNode = (l: number, i: number): NodeRow | null => {
    const r = nodeStmt.get(l, i)
    if (!r) return null
    return { l, i, text: r.text, source: r.source, meta: safeParse(r.meta), mh: r.mh }
  }


  const mthHex = (n: number): string => {
    const hashes: Buffer[] = []
    for (const r of roots(n)) {
      const node = getNode(r.l, r.i)
      hashes.push(buf(node ? node.mh : ''))
    }
    return foldRoots(hashes).toString('hex')
  }

  const leafTag = (seq: number): string | null => {
    const item = getItem(seq)
    if (seq === 0) return tag(item.harness, item.session)
    const prev = getItem(seq - 1)
    return prev.harness === item.harness && prev.session === item.session ? null : tag(item.harness, item.session)
  }

  // The text output shows for node (l,i) (SPEC §2): what a fresh store would
  // build, never a legacy model summary. A leaf is rebuilt from its item. An
  // upper node keeps its stored text unless a model node is at or under it
  // (a clip built over a summarized child quotes the summary); then it is
  // rebuilt from its children the way ingest builds it. Read time only: node
  // hashes cover items, not text, so verify, views_log and roots are unchanged.
  type Shown = { text: string; meta: AggMeta | null }
  type ShowCtx = { memo: Map<string, Shown>; taint: Set<string> | null }
  const showCtx = (): ShowCtx => ({ memo: new Map(), taint: null })
  // Every node that is a model node or has one under it, as "l:i".
  const tainted = (): Set<string> => {
    const t = new Set<string>()
    for (const r of db.prepare("SELECT l, i FROM nodes WHERE source = 'model'").all() as { l: number; i: number }[]) {
      for (let l = Number(r.l), i = Number(r.i); l <= 62; l++, i = Math.floor(i / 2)) {
        const k = `${l}:${i}`
        if (t.has(k)) break
        t.add(k)
      }
    }
    return t
  }
  const shown = (l: number, i: number, ctx: ShowCtx = showCtx()): Shown => {
    if (l === 0) {
      const leaf = leafText(getItem(i), leafTag(i))
      return { text: leaf.text, meta: leaf.meta }
    }
    const k = `${l}:${i}`
    const hit = ctx.memo.get(k)
    if (hit !== undefined) return hit
    if (ctx.taint === null) ctx.taint = tainted()
    const stored = ctx.taint.has(k) ? null : getNode(l, i)
    let r: Shown
    if (stored !== null) {
      r = { text: stored.text, meta: stored.meta }
    } else {
      const a = shown(l - 1, i * 2, ctx)
      const b = shown(l - 1, i * 2 + 1, ctx)
      // As ingest builds it: the det aggregate when both halves are tool-only, else a clip.
      const m = a.meta !== null && b.meta !== null ? combine(a.meta, b.meta) : null
      r = m !== null ? { text: aggText(m), meta: m } : { text: mergeClip(a.text, b.text), meta: null }
    }
    ctx.memo.set(k, r)
    return r
  }

  // Ingest a batch of NormItems. Caller must already hold a transaction.
  const ingestItems = (items: NormItem[], autoPin = true, failPins = true): { added: number; lastSeq: number } => {
    let count = countItems()
    let added = 0
    const exists = db.prepare('SELECT seq FROM items WHERE harness = ? AND session = ? AND uuid = ?')
    const insItem = db.prepare('INSERT INTO items (seq, harness, session, agent, uuid, kind, ts, text, meta, hash) VALUES (?,?,?,?,?,?,?,?,?,?)')
    const insFts = db.prepare('INSERT INTO items_fts (rowid, body) VALUES (?,?)')
    const insRaw = db.prepare('INSERT OR IGNORE INTO raw (harness, session, uuid, thinking) VALUES (?,?,?,?)')
    const insNode = db.prepare('INSERT INTO nodes (l, i, text, source, meta, mh, tries) VALUES (?,?,?,?,?,?,?)')
    const prev = db.prepare('SELECT harness, session FROM items WHERE seq = ?')
    const isForgotten = db.prepare('SELECT 1 FROM forgotten WHERE harness = ? AND session = ?')
    const insPin = db.prepare('INSERT INTO pins (seq, reason, kind, key, resolved) VALUES (?,?,?,?,0)')
    const resolveFail = db.prepare('UPDATE pins SET resolved = 1 WHERE kind = ? AND key = ? AND resolved = 0')

    for (const item of items) {
      if (exists.get(item.harness, item.session, item.uuid)) continue
      if (isForgotten.get(item.harness, item.session)) continue
      const seq = count
      count++
      const tool = item.kind === 'tool' ? (item.tool ?? { name: 'unknown', input: null, output: item.text, isError: false }) : null
      const text = tool !== null ? (tool.output ?? '') : item.text
      const meta = tool !== null ? { name: tool.name, input: tool.input, isError: tool.isError === true } : null
      const agent = item.agent ?? null
      const hash = sha256hex(canonical({ seq, harness: item.harness, session: item.session, agent, uuid: item.uuid, kind: item.kind, ts: item.ts, text, meta }))
      insItem.run(seq, item.harness, item.session, agent, item.uuid, item.kind, item.ts, text, meta === null ? null : JSON.stringify(meta), hash)
      const body = tool !== null ? `${tool.name} ${canonical(tool.input)}\n${text}` : text
      insFts.run(seq, body)
      if (item.thinking) insRaw.run(item.harness, item.session, item.uuid, item.thinking)

      const row: ItemRec = { seq, harness: item.harness, session: item.session, agent, uuid: item.uuid, kind: item.kind, ts: item.ts, text, meta }
      const t = seq === 0 ? tag(item.harness, item.session) : (() => {
        const p = prev.get(seq - 1)
        return p && p.harness === item.harness && p.session === item.session ? null : tag(item.harness, item.session)
      })()
      const leaf = leafText(row, t)
      insNode.run(0, seq, leaf.text, leaf.source, leaf.meta === null ? null : JSON.stringify(leaf.meta), leafHash(buf(hash)).toString('hex'), 0)

      let l = 0
      let i = seq
      while (i % 2 === 1) {
        const pl = l + 1
        const pi = i >> 1
        const a = getNode(pl - 1, pi * 2)!
        const b = getNode(pl - 1, pi * 2 + 1)!
        let nsource: string
        let nmeta: AggMeta | null
        let ntext: string
        if (a.meta !== null && b.meta !== null) {
          nsource = 'det'
          nmeta = combine(a.meta, b.meta)
          ntext = aggText(nmeta)
        } else {
          nsource = 'clip'
          nmeta = null
          ntext = mergeClip(a.text, b.text)
        }
        insNode.run(pl, pi, ntext, nsource, nmeta === null ? null : JSON.stringify(nmeta), nodeHash(buf(a.mh), buf(b.mh)).toString('hex'), 0)
        l = pl
        i = pi
      }

      if (autoPin && isDirective(row, item.oneShot === true)) insPin.run(seq, 'directive', 'directive', null)
      const tk = autoPin ? toolKey(row) : null
      if (tk !== null) {
        // Only a live main-session failure can be unresolved: backfill and subagent
        // transcripts are finished work (SPEC §5).
        if (!tk.ok) { if (failPins && agent === null) insPin.run(seq, 'failure', 'failure', tk.key) }
        else resolveFail.run('failure', tk.key)
      }
      added++
    }
    return { added, lastSeq: count - 1 }
  }

  const lookup = (harness: 'claude' | 'pi', session: string, id: string): Call | undefined => {
    const r = db.prepare('SELECT agent, name, input, ts FROM calls WHERE harness = ? AND session = ? AND id = ?').get(harness, session, id)
    if (!r) return undefined
    return {
      harness, session, id, name: r.name, ts: r.ts,
      input: safeParse(r.input),
      ...(r.agent !== null ? { agent: r.agent } : {}),
    }
  }

  const cursorOffset = (file: string): number => {
    const r = db.prepare('SELECT offset FROM cursors WHERE file = ?').get(file)
    if (!r) return 0
    let size = 0
    try { size = fs.statSync(file).size } catch { return 0 }
    return size < r.offset ? 0 : r.offset
  }
  const setCursor = (file: string, harness: string, offset: number): void => {
    db.prepare('INSERT INTO cursors (file, harness, offset) VALUES (?,?,?) ON CONFLICT(file) DO UPDATE SET harness = excluded.harness, offset = excluded.offset').run(file, harness, offset)
  }
  const upsertCall = (c: Call): void => {
    db.prepare('INSERT INTO calls (harness, session, id, agent, name, input, ts) VALUES (?,?,?,?,?,?,?) ON CONFLICT(harness, session, id) DO UPDATE SET agent = excluded.agent, name = excluded.name, input = excluded.input, ts = excluded.ts')
      .run(c.harness, c.session, c.id, c.agent ?? null, c.name, JSON.stringify(c.input ?? null), c.ts)
  }
  const deleteCall = (c: Call): void => {
    db.prepare('DELETE FROM calls WHERE harness = ? AND session = ? AND id = ?').run(c.harness, c.session, c.id)
  }

  // A session's view is its tailStart (SPEC §3). The views table keeps its
  // old columns so old stores still open: `parts` is written empty and never
  // read, `high` holds the header budget the row was last rendered with.
  const loadView = (h: string, s: string): { tailStart: number } | null => {
    const r = db.prepare('SELECT tail_start FROM views WHERE harness = ? AND session = ?').get(h, s)
    return r ? { tailStart: Number(r.tail_start) } : null
  }
  const persistView = (h: string, s: string, tailStart: number, header: number): void => {
    db.prepare("INSERT INTO views (harness, session, parts, view_end, tail_start, high) VALUES (?,?,'[]',?,?,?) ON CONFLICT(harness, session) DO UPDATE SET parts = '[]', view_end = excluded.view_end, tail_start = excluded.tail_start, high = excluded.high")
      .run(h, s, tailStart, tailStart, header)
  }

  const resolveHeader = (h?: number): number => {
    if (h !== undefined && Number.isFinite(h) && h > 0) return Math.floor(h)
    const env = process.env.CYTH_HEADER
    const n = env === undefined || env === '' ? NaN : Number(env)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : HEADER
  }

  // `#n|` + the leaf line of item n, rebuilt from the item itself so it never
  // changes (a legacy model summary on the node is not used). The tag shows
  // where the session changes, and on the oldest line of the slice.
  // The tag compares with the line above it: the previous item that is shown.
  const ownTool = (seq: number): boolean => {
    const it = getItem(seq)
    return it.kind === 'tool' && it.meta !== null && cythTool(it.meta.name)
  }
  const recentLine = (seq: number, first: boolean): string => {
    const item = getItem(seq)
    let p = seq - 1
    while (!first && p >= 0 && ownTool(p)) p--
    const above = first || p < 0 ? null : getItem(p)
    const same = above !== null && above.harness === item.harness && above.session === item.session
    return `#${seq}|` + leafText(item, same ? null : tag(item.harness, item.session)).text
  }

  const ensureView = (h: string, s: string, header: number): { tailStart: number } => {
    const existing = loadView(h, s)
    if (existing) return existing
    const st = { tailStart: countItems() }
    persistView(h, s, st.tailStart, header)
    return st
  }

  const openPins = (): { pin: { id: number; seq: number; reason: string; kind: string; key: string | null }; text: string }[] => {
    const rows = db.prepare('SELECT id, seq, reason, kind, key FROM pins WHERE resolved = 0 ORDER BY id ASC').all()
    return rows.map((p: any) => ({ pin: { id: p.id, seq: p.seq, reason: p.reason, kind: p.kind, key: p.key }, text: pinText(getItem(p.seq)) }))
  }

  const itemDoc = (item: ItemRec): string => {
    const head = `#${item.seq} ${item.kind} ${item.harness}:${item.session}${item.agent !== null ? ' agent ' + item.agent : ''} ${item.ts}\n`
    if (item.kind === 'tool' && item.meta !== null) {
      const m = item.meta
      return head + `tool ${m.name}${m.isError ? ' (isError)' : ''}\ninput: ${canonical(m.input)}\noutput:\n${item.text}`
    }
    return head + item.text
  }

  // After a compaction, Claude Code writes the kept tail into the transcript again, as new
  // records (new uuids) with the same timestamps and text. A user or assistant item whose
  // session, kind, ts and text equal one already stored, or one earlier in the same chunk,
  // is such a copy: drop it, so the log holds each message once (SPEC §9).
  const dropCompactionCopies = (items: NormItem[]): NormItem[] => {
    const seen = new Set<string>()
    const stored = db.prepare('SELECT 1 FROM items WHERE harness = ? AND session = ? AND ts = ? AND kind = ? AND text = ? LIMIT 1')
    return items.filter((it) => {
      if (it.kind === 'tool') return true
      const k = JSON.stringify([it.session, it.ts, it.kind, it.text])
      if (seen.has(k)) return false
      seen.add(k)
      return stored.get(it.harness, it.session, it.ts, it.kind, it.text) === undefined
    })
  }

  // SQL: the items row is not one of cyth's own tool calls (SPEC §4). Malformed
  // meta (tampering) counts as not ours rather than throwing from json_extract.
  const NOT_OWN = `NOT (items.kind = 'tool' AND coalesce(json_valid(items.meta), 0) AND coalesce(json_extract(items.meta, '$.name'), '') IN (${CYTH_TOOLS.map(() => '?').join(',')}))`

  // The index's words that could be near t, read live from FTS5's own vocab
  // (a temp table: nothing is written to the store, old stores need nothing).
  let vocabStmt: ReturnType<typeof db.prepare> | null = null
  const vocabNear = (t: string): { term: string; doc: number }[] => {
    const d = maxEdit(t)
    if (d === 0) return []
    if (vocabStmt === null) {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.items_vocab USING fts5vocab(main, items_fts, 'row')")
      vocabStmt = db.prepare('SELECT term, doc FROM temp.items_vocab WHERE term >= ? AND term < ?')
    }
    return (vocabStmt.all(...letterRange(t)) as any[]).map((r) => ({ term: String(r.term), doc: Number(r.doc) }))
  }

  const store: Store = {
    root,
    dbPath,

    ingest(items) {
      return tx(() => ingestItems(items))
    },

    syncClaude(file) {
      const off = cursorOffset(file)
      const chunk = parseClaude(file, off, lookup)
      return tx(() => {
        const { added } = ingestItems(dropCompactionCopies(chunk.items))
        for (const r of chunk.raw) db.prepare('INSERT OR IGNORE INTO raw (harness, session, uuid, thinking) VALUES (?,?,?,?)').run(r.harness, r.session, r.uuid, r.thinking)
        for (const c of chunk.open) upsertCall(c)
        for (const c of chunk.closed) deleteCall(c)
        setCursor(file, 'claude', chunk.end)
        return { added }
      })
    },

    syncPi(file, o) {
      const off = cursorOffset(file)
      const chunk = parsePi(file, off, lookup, o?.oneShot === true)
      return tx(() => {
        const { added } = ingestItems(chunk.items)
        for (const r of chunk.raw) db.prepare('INSERT OR IGNORE INTO raw (harness, session, uuid, thinking) VALUES (?,?,?,?)').run(r.harness, r.session, r.uuid, r.thinking)
        for (const c of chunk.open) upsertCall(c)
        for (const c of chunk.closed) deleteCall(c)
        setCursor(file, 'pi', chunk.end)
        return { added }
      })
    },

    backfill(opts) {
      const claudeDir = opts?.claudeDir ?? path.join(os.homedir(), '.claude', 'projects')
      const piDir = opts?.piDir ?? path.join(os.homedir(), '.pi', 'agent', 'sessions')
      const items: NormItem[] = []
      const raw: { harness: 'claude' | 'pi'; session: string; uuid: string; thinking: string }[] = []
      const open: Call[] = []
      const closed: Call[] = []
      const cursors: { file: string; harness: string; offset: number }[] = []
      for (const f of listClaude(claudeDir)) {
        const cwd = claudeCwd(f)
        if (cwd === null || projectRoot(cwd) !== root) continue
        const chunk = parseClaude(f, cursorOffset(f), lookup)
        items.push(...chunk.items)
        raw.push(...chunk.raw)
        open.push(...chunk.open)
        closed.push(...chunk.closed)
        cursors.push({ file: f, harness: 'claude', offset: chunk.end })
      }
      for (const f of listPi(piDir)) {
        const hdr = piHeader(f)
        if (hdr === null || hdr.cwd === '' || projectRoot(hdr.cwd) !== root) continue
        const chunk = parsePi(f, cursorOffset(f), lookup)
        items.push(...chunk.items)
        raw.push(...chunk.raw)
        open.push(...chunk.open)
        closed.push(...chunk.closed)
        cursors.push({ file: f, harness: 'pi', offset: chunk.end })
      }
      items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      return tx(() => {
        const { added } = ingestItems(items, true, false)
        for (const r of raw) db.prepare('INSERT OR IGNORE INTO raw (harness, session, uuid, thinking) VALUES (?,?,?,?)').run(r.harness, r.session, r.uuid, r.thinking)
        for (const c of open) upsertCall(c)
        for (const c of closed) deleteCall(c)
        for (const c of cursors) setCursor(c.file, c.harness, c.offset)
        return { added }
      })
    },

    seqOf(harness, session, uuid) {
      const r = db.prepare('SELECT seq FROM items WHERE harness = ? AND session = ? AND uuid = ?').get(harness, session, uuid)
      return r ? Number(r.seq) : undefined
    },

    view(h, s, opts) {
      const header = resolveHeader(opts?.header)
      let st = loadView(h, s)
      if (!st) {
        const count = countItems()
        const tailStart = Math.max(0, Math.min(opts?.tailStart ?? count, count))
        st = { tailStart }
        persistView(h, s, tailStart, header)
      }
      const pinned = renderPins(openPins())
      const block = renderBlock(pinned.block, recentLines(st.tailStart, header, recentLine, ownTool))
      const viewEnd = st.tailStart
      const rootHex = mthHex(viewEnd)
      const bytess = bytes(block)
      const algedonic = pinned.over > 0
      const sha = sha256hex(block)
      const last = db.prepare('SELECT sha FROM views_log WHERE harness = ? AND session = ? ORDER BY id DESC LIMIT 1').get(h, s)
      if (!last || last.sha !== sha) {
        db.prepare('INSERT INTO views_log (ts, harness, session, n, root, view_end, tail_start, sha, bytes) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(new Date().toISOString(), h, s, viewEnd, rootHex, viewEnd, st.tailStart, sha, bytess)
      }
      return { block, viewEnd, tailStart: st.tailStart, bytes: bytess, root: rootHex, algedonic }
    },

    fold(h, s, tailStart) {
      const header = resolveHeader()
      const st = ensureView(h, s, header)
      const count = countItems()
      st.tailStart = Math.min(Math.max(tailStart, st.tailStart), count)
      persistView(h, s, st.tailStart, header)
    },

    zoom(ref) {
      const r = parseRef(ref)
      const count = countItems()
      if ('l' in r) {
        const [lo, hi] = span(r.l, r.i)
        if (hi >= count) throw new Error(`zoom #${lo}-${hi}: beyond store (${count} items)`)
        const ctx = showCtx()
        const a = shown(r.l - 1, r.i * 2, ctx)
        const b = shown(r.l - 1, r.i * 2 + 1, ctx)
        return `${refOf(r.l - 1, r.i * 2)}|${a.text}\n${refOf(r.l - 1, r.i * 2 + 1)}|${b.text}`
      }
      const n = r.item
      if (n >= count) throw new Error(`zoom #${n}: beyond store (${count} items)`)
      const doc = itemDoc(getItem(n))
      const b = Buffer.from(doc, 'utf8')
      const total = b.length
      if (r.offset > total) throw new Error(`zoom #${n}@${r.offset}: offset beyond ${total} bytes`)
      const rest = b.subarray(r.offset)
      let end = Math.min(rest.length, PAGE)
      while (end > 0 && (rest[end] & 0xc0) === 0x80) end--
      const page = rest.subarray(0, end).toString('utf8')
      const endByte = r.offset + end
      const footer = endByte < total
        ? `\n[#${n} bytes ${r.offset}-${endByte} of ${total}; more: memory_zoom #${n}@${endByte}]`
        : `\n[#${n} bytes ${r.offset}-${endByte} of ${total}; end]`
      return page + footer
    },

    // Search leaves out cyth's own tool calls (an earlier memory_find is not a
    // fact), at query time, so stores ingested before this need no migration.
    search(q, opts) {
      const limit = opts?.limit ?? 20
      const from = opts?.from
      if (from !== undefined && from !== 'user' && from !== 'assistant' && from !== 'tool') {
        throw new Error(`search: from must be user, assistant or tool, got "${String(from)}"`)
      }
      // The kind filter runs in SQL, so it applies before limit.
      const KIND = from === undefined ? '' : ' AND items.kind = ?'
      const kindArgs = from === undefined ? [] : [from]
      const hits: { n: number; leaf: string; snippet: string }[] = []
      let note = ''
      if (opts?.regex) {
        let re: RegExp
        try { re = new RegExp(q, 'i') } catch { return `no hits for ${q}` }
        const rows = db.prepare(`SELECT items_fts.rowid AS rowid, body FROM items_fts JOIN items ON items.seq = items_fts.rowid WHERE ${NOT_OWN}${KIND} ORDER BY items_fts.rowid DESC`).all(...CYTH_TOOLS, ...kindArgs)
        for (const row of rows) {
          if (hits.length >= limit) break
          const m = re.exec(row.body)
          if (!m) continue
          const idx = m.index
          const start = Math.max(0, idx - 60)
          const finish = Math.min(row.body.length, idx + m[0].length + 60)
          hits.push({ n: Number(row.rowid), leaf: shown(0, Number(row.rowid)).text, snippet: clipMark(oneLine(row.body.slice(start, finish)), 120) })
        }
      } else {
        const pick = (query: string) => db.prepare(
          `SELECT items_fts.rowid AS rowid, snippet(items_fts, 0, '', '', ' … ', 24) AS s FROM items_fts JOIN items ON items.seq = items_fts.rowid WHERE items_fts MATCH ? AND ${NOT_OWN}${KIND} ORDER BY bm25(items_fts) LIMIT ?`,
        ).all(query, ...CYTH_TOOLS, ...kindArgs, limit)
        let rows: any[]
        try { rows = pick(q) } catch { rows = pick(q.split(/\s+/).filter((x) => x !== '').map((t) => '"' + t.replace(/"/g, '""') + '"').join(' ')) }
        // Few exact hits: also try near spellings of the words (fuzzy.ts).
        const words = rows.length < Math.min(FEW, limit) ? plainWords(q) : null
        const groups = words === null ? [] : words.map((t) => [t, ...nearWords(vocabNear(t), t)])
        const used = groups.filter((g) => g.length > 1)
        const exactN = rows.length
        if (used.length > 0) {
          const seen = new Set(rows.map((r) => Number(r.rowid)))
          const more = pick(widenedQuery(groups)).filter((r) => !seen.has(Number(r.rowid))).slice(0, Math.min(EXTRA, limit - rows.length))
          if (more.length > 0) {
            rows = [...rows, ...more]
            note = '\n(near spellings also searched: ' + used.map((g) => `${g[0]}: ${g.slice(1).join(' ')}`).join('; ') + ')'
          }
        }
        rows.sort((a, b) => Number(b.rowid) - Number(a.rowid))
        // Still few: add hits that match only some of the words, listed last. Near and
        // loose hits share the EXTRA cap.
        if (groups.length > 0 && rows.length < Math.min(FEW, limit)) {
          const seen = new Set(rows.map((r) => Number(r.rowid)))
          const loose = pick(orQuery(groups)).filter((r) => !seen.has(Number(r.rowid))).slice(0, Math.min(EXTRA - (rows.length - exactN), limit - rows.length))
          if (loose.length > 0) {
            loose.sort((a, b) => Number(b.rowid) - Number(a.rowid))
            rows = [...rows, ...loose]
            note += `\n(fewer exact hits, so the last ${loose.length} match only some words; searched any of: ${[...new Set(groups.flat())].join(', ')})`
          }
        }
        for (const row of rows) {
          hits.push({ n: Number(row.rowid), leaf: shown(0, Number(row.rowid)).text, snippet: clipMark(oneLine(row.s), 120) })
        }
      }
      if (hits.length === 0) return `no hits for ${q}`
      let out = ''
      for (const h of hits) {
        const line = `#${h.n}|${h.leaf}\n  ${h.snippet}`
        if (out !== '' && bytes(out) + bytes(line) > PAGE) break
        out += (out === '' ? '' : '\n') + line
      }
      return out + note
    },

    roots() {
      const rs = roots(countItems())
      const ctx = showCtx()
      return rs.map((r) => refOf(r.l, r.i) + '|' + shown(r.l, r.i, ctx).text).join('\n')
    },

    pin(ref, reason) {
      const r = parseRef(ref)
      if ('l' in r) throw new Error(`pin: ${ref} is a range, expected an item #n`)
      if (r.offset !== 0) throw new Error(`pin: ${ref} has an offset, expected an item #n`)
      if (r.item >= countItems()) throw new Error(`pin: ${ref} beyond store`)
      const res = db.prepare('INSERT INTO pins (seq, reason, kind, key, resolved) VALUES (?,?,?,?,0)').run(r.item, reason, 'manual', null)
      return Number(res.lastInsertRowid)
    },

    unpin(id) {
      const r = db.prepare('SELECT id, resolved FROM pins WHERE id = ?').get(id)
      if (!r || r.resolved !== 0) throw new Error(`unpin: no open pin ${id}`)
      db.prepare('UPDATE pins SET resolved = 1 WHERE id = ?').run(id)
    },

    pins() {
      const rows = db.prepare('SELECT id, seq, reason, kind FROM pins WHERE resolved = 0 ORDER BY id ASC').all()
      if (rows.length === 0) return 'no open pins'
      return rows.map((p: any) => `[${p.id}] #${p.seq} ${p.kind}: ${clipMark(oneLine(p.reason), 200)} | ${pinText(getItem(p.seq))}`).join('\n')
    },

    // Remove one session's items and rebuild the tree over what is left, so
    // the log stays dense, hashed and consistent. `arg` is a session id, an
    // unambiguous session-id prefix, or a leaf tag (c1234 / p1234).
    forgetSession(arg, o) {
      const dryRun = o?.dryRun === true
      const all = db.prepare('SELECT DISTINCT harness, session FROM items').all() as { harness: string; session: string }[]
      const hit = all.filter((r) => r.session === arg || (arg.length >= 4 && r.session.startsWith(arg)) || tag(r.harness as 'claude' | 'pi', r.session) === arg)
      const exact = hit.filter((r) => r.session === arg)
      const sessions = exact.length > 0 ? exact : hit
      if (sessions.length === 0) throw new Error(`no session matches "${arg}"`)
      if (sessions.length > 1) throw new Error(`"${arg}" is ambiguous: ${sessions.map((r) => `${r.harness}:${r.session}`).join(', ')}`)
      const { harness: h, session: s } = sessions[0]
      const seqs = (db.prepare('SELECT seq FROM items WHERE harness = ? AND session = ? ORDER BY seq').all(h, s) as { seq: number }[]).map((r) => Number(r.seq))
      const gone = new Set(seqs)
      const count = (sql: string): number => Number(db.prepare(sql).get(h, s).c)
      const pinIds = (db.prepare('SELECT id, seq FROM pins').all() as { id: number; seq: number }[]).filter((p) => gone.has(Number(p.seq))).map((p) => Number(p.id))
      // Cursor files belong to the session when the session id is in the path (Claude <id>.jsonl, Pi <ts>_<id>.jsonl).
      const cursors = (db.prepare('SELECT file FROM cursors WHERE harness = ?').all(h) as { file: string }[]).map((r) => r.file).filter((f) => f.includes(s))
      const plan: ForgetPlan = {
        dryRun,
        sessions: [{ harness: h, session: s }],
        items: seqs,
        ftsRows: seqs.length,
        rawRows: count('SELECT COUNT(*) AS c FROM raw WHERE harness = ? AND session = ?'),
        callRows: count('SELECT COUNT(*) AS c FROM calls WHERE harness = ? AND session = ?'),
        pins: pinIds,
        views: (db.prepare('SELECT harness, session FROM views WHERE harness = ? AND session = ?').all(h, s) as { harness: string; session: string }[]).map((r) => ({ harness: r.harness, session: r.session })),
        cursors,
        remaining: countItems() - seqs.length,
        resets: 'remaining items are renumbered 0..remaining-1 and the whole tree is rebuilt (legacy model summaries become clips); every other session view and the views_log are cleared (their seqs and roots no longer hold); the session is tombstoned so a later sync cannot re-ingest it',
      }
      if (dryRun) return plan
      tx(() => {
        type Old = { seq: number; harness: string; session: string; agent: string | null; uuid: string; kind: string; ts: string; text: string; meta: string | null }
        const rows = db.prepare('SELECT seq, harness, session, agent, uuid, kind, ts, text, meta FROM items ORDER BY seq').all() as Old[]
        const keep = rows.filter((r) => !gone.has(Number(r.seq)))
        const keyOf = (r: { harness: string; session: string; uuid: string }): string => `${r.harness}\0${r.session}\0${r.uuid}`
        const byKey = new Map<string, number>()
        const oldSeqKey = new Map<number, string>()
        for (const r of keep) oldSeqKey.set(Number(r.seq), keyOf(r))
        const oldPins = db.prepare('SELECT id, seq, reason, kind, key, resolved FROM pins ORDER BY id').all() as { id: number; seq: number; reason: string; kind: string; key: string | null; resolved: number }[]
        const items: NormItem[] = keep.map((r) => {
          const meta = safeParse(r.meta)
          const base = { harness: r.harness as 'claude' | 'pi', session: r.session, ...(r.agent !== null ? { agent: r.agent } : {}), uuid: r.uuid, kind: r.kind as 'user' | 'assistant' | 'tool', ts: r.ts }
          return r.kind === 'tool'
            ? { ...base, text: '', tool: { name: meta?.name ?? 'unknown', input: meta?.input ?? null, output: r.text, isError: meta?.isError === true } }
            : { ...base, text: r.text }
        })
        db.exec('DELETE FROM items; DELETE FROM items_fts; DELETE FROM nodes; DELETE FROM pins; DELETE FROM views; DELETE FROM views_log')
        db.prepare('DELETE FROM raw WHERE harness = ? AND session = ?').run(h, s)
        db.prepare('DELETE FROM calls WHERE harness = ? AND session = ?').run(h, s)
        for (const f of cursors) db.prepare('DELETE FROM cursors WHERE file = ?').run(f)
        db.prepare('INSERT OR IGNORE INTO forgotten (harness, session) VALUES (?,?)').run(h, s)
        ingestItems(items, false)
        for (const r of db.prepare('SELECT seq, harness, session, uuid FROM items').all() as any[]) byKey.set(keyOf(r), Number(r.seq))
        const insPin = db.prepare('INSERT INTO pins (id, seq, reason, kind, key, resolved) VALUES (?,?,?,?,?,?)')
        for (const p of oldPins) {
          const k = oldSeqKey.get(Number(p.seq))
          const ns = k === undefined ? undefined : byKey.get(k)
          if (ns !== undefined) insPin.run(p.id, ns, p.reason, p.kind, p.key, p.resolved)
        }
      })
      return plan
    },

    status() {
      const items = countItems()
      const nodes = Number(db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c)
      const pins = Number(db.prepare('SELECT COUNT(*) AS c FROM pins WHERE resolved = 0').get().c)
      const algedonic = renderPins(openPins()).over > 0
      return { items, nodes, pins, algedonic, root: mthHex(items) }
    },

    verify() {
      const problems: string[] = []
      const rows = db.prepare('SELECT * FROM items ORDER BY seq').all()
      const recomputed: Buffer[] = []
      for (const r of rows) {
        let meta: any = null
        if (r.meta !== null) {
          try { meta = JSON.parse(r.meta) } catch { problems.push(`item #${r.seq}: meta is not valid JSON`); meta = null }
        }
        const h = sha256hex(canonical({ seq: r.seq, harness: r.harness, session: r.session, agent: r.agent ?? null, uuid: r.uuid, kind: r.kind, ts: r.ts, text: r.text, meta }))
        if (h !== r.hash) problems.push(`item #${r.seq}: hash mismatch`)
        recomputed.push(buf(h))
      }
      const ns = db.prepare('SELECT DISTINCT n FROM views_log ORDER BY n').all()
      for (const n of ns) {
        const expected = mthReference(recomputed.slice(0, n.n)).toString('hex')
        for (const log of db.prepare('SELECT root FROM views_log WHERE n = ?').all(n.n)) {
          if (log.root !== expected) problems.push(`views_log n=${n.n}: root ${log.root} != ${expected}`)
        }
      }
      for (const nd of db.prepare('SELECT l, i, text, meta, mh FROM nodes').all()) {
        if (bytes(nd.text) > NODE) problems.push(`node (${nd.l},${nd.i}) text is ${bytes(nd.text)} bytes > ${NODE}`)
        if (nd.text.includes('\n')) problems.push(`node (${nd.l},${nd.i}) contains a newline`)
        if (nd.l === 0) {
          const itemHash = recomputed[nd.i]
          const expected = leafHash(itemHash).toString('hex')
          if (nd.mh !== expected) problems.push(`node (${nd.l},${nd.i}) mh mismatch`)
        } else {
          const a = db.prepare('SELECT mh FROM nodes WHERE l = ? AND i = ?').get(nd.l - 1, nd.i * 2)
          const b = db.prepare('SELECT mh FROM nodes WHERE l = ? AND i = ?').get(nd.l - 1, nd.i * 2 + 1)
          if (!a || !b) { problems.push(`node (${nd.l},${nd.i}) missing children`); continue }
          const expected = nodeHash(buf(a.mh), buf(b.mh)).toString('hex')
          if (nd.mh !== expected) problems.push(`node (${nd.l},${nd.i}) mh mismatch`)
        }
      }
      const count = rows.length
      // A view is its tailStart; `parts` is a legacy column (the old tree view) and is not read.
      for (const v of db.prepare('SELECT harness, session, view_end, tail_start FROM views').all()) {
        if (v.view_end !== v.tail_start) problems.push(`view ${v.harness}/${v.session}: viewEnd ${v.view_end} != tailStart ${v.tail_start}`)
        if (v.tail_start > count) problems.push(`view ${v.harness}/${v.session}: tailStart ${v.tail_start} > count ${count}`)
      }
      return { ok: problems.length === 0, problems }
    },

    close() {
      db.close()
    },
  }

  return store
}

