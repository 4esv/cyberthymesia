// Focused store tests that pin down individual guards in core/src/index.ts
// (written from the mutation sweep, core/test/mutants.index.json).
// Every store lives in a fresh temp home; never ~/.cyberthymesia.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NormItem, Store } from '../src/types.ts'
import { NODE, PAGE, bytes } from '../src/util.ts'
import { mergeClip, tag } from '../src/leaves.ts'

const { openStore } = await import('../src/index.ts')

let stamp = 0
function mk(): { s: Store; home: string; cwd: string; db: () => DatabaseSync } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cyth-store-')))
  const home = join(base, 'home')
  const cwd = join(base, 'proj')
  mkdirSync(home)
  mkdirSync(cwd)
  const s: Store = openStore(cwd, { home })
  return { s, home, cwd, db: () => new DatabaseSync(s.dbPath) }
}

const ts = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++)).toISOString()
const user = (text: string, session = 'sess1', uuid?: string): NormItem =>
  ({ harness: 'claude', session, uuid: uuid ?? 'u' + stamp + ':0', kind: 'user', ts: ts(), text })
const asst = (text: string, session = 'sess1', uuid?: string): NormItem =>
  ({ harness: 'claude', session, uuid: uuid ?? 'a' + stamp + ':0', kind: 'assistant', ts: ts(), text })
const tool = (name: string, input: unknown, output: string, isError = false, session = 'sess1', uuid?: string): NormItem =>
  ({ harness: 'claude', session, uuid: uuid ?? 't' + stamp, kind: 'tool', ts: ts(), text: '', tool: { name, input, output, isError } })
const long = (c: string, n = 1200): string => (c + ' ').repeat(n / 2)

function nodeRow(db: DatabaseSync, l: number, i: number): any {
  return db.prepare('SELECT * FROM nodes WHERE l = ? AND i = ?').get(l, i)
}

test('ingest: idempotent, lastSeq, added, thinking, tool FTS body, verify green', () => {
  const { s, db } = mk()
  const a = user('hello', 'sess1', 'x:0')
  const b = { ...asst('world', 'sess1', 'y:0'), thinking: 'secret thoughts' }
  const t = tool('Bash', { command: 'ls zzz' }, 'out', false, 'sess1', 'tc1')
  const r = s.ingest([a, b, t])
  assert.deepEqual(r, { added: 3, lastSeq: 2 })
  assert.deepEqual(s.ingest([a, b, t]), { added: 0, lastSeq: 2 })
  assert.equal(s.status().items, 3)
  const raw = db().prepare('SELECT thinking FROM raw').all()
  assert.deepEqual(raw.map((x: any) => x.thinking), ['secret thoughts'])
  assert.match(s.search('Bash'), /^#2\|/)
  assert.match(s.search('zzz'), /^#2\|/)
  assert.deepEqual(s.verify(), { ok: true, problems: [] })
})

test('cascade: det only for tool pairs, clip otherwise, parity, tags on session change', () => {
  const { s, db } = mk()
  s.ingest([
    tool('Bash', { command: 'a' }, 'ok', false, 'abcd1', 'c0'),
    tool('Bash', { command: 'b' }, 'ok', false, 'abcd1', 'c1'),
    tool('Read', { file_path: '/x' }, 'ok', false, 'abcd1', 'c2'),
    user('plain words', 'abcd1', 'u3'),
    user('other session', 'wxyz2', 'u4'),
    user('same other', 'wxyz2', 'u5'),
  ])
  const d = db()
  assert.equal(nodeRow(d, 1, 0).source, 'det')
  assert.equal(nodeRow(d, 1, 1).source, 'clip') // tool + user
  assert.equal(nodeRow(d, 1, 2).source, 'clip')
  assert.equal(nodeRow(d, 2, 0).source, 'clip')
  assert.match(nodeRow(d, 1, 0).text, /^t\* /)
  // tags: first leaf and session changes only
  assert.match(nodeRow(d, 0, 0).text, /^t:@cbcd1 /)
  assert.doesNotMatch(nodeRow(d, 0, 1).text, /@/)
  assert.doesNotMatch(nodeRow(d, 0, 3).text, /@c/)
  assert.match(nodeRow(d, 0, 4).text, /^u:@cxyz2 /)
  assert.doesNotMatch(nodeRow(d, 0, 5).text, /@c/)
  assert.deepEqual(s.verify(), { ok: true, problems: [] })
  // right child of the first merge is leaf 1, not leaf 0 (merge hash covers both)
  assert.notEqual(nodeRow(d, 1, 0).mh, '')
})

test('tag: last 4 alphanumerics distinguish same-day Pi UUIDv7 sessions', () => {
  assert.equal(tag('pi', '01a16918-13cc-7172-8c21-10cf97f11be2'), 'p1be2')
  assert.equal(tag('pi', '01a16918-4394-724a-ba71-31bca5a79773'), 'p9773')
  assert.equal(tag('claude', 'abc/agent-x9f2'), 'cx9f2')
})

test('pins: directive, failure, auto-resolve by key, no false pins', () => {
  const { s } = mk()
  s.ingest([user('please never delete the prod db'), user('just chatting about trees')])
  assert.match(s.pins(), /directive/)
  assert.equal(s.status().pins, 1)
  s.ingest([tool('Bash', { command: 'npm test' }, 'Exit code 1\nboom', true)])
  assert.equal(s.status().pins, 2)
  s.ingest([tool('Read', { file_path: '/x' }, 'fine', false)])
  assert.equal(s.status().pins, 2) // another tool succeeding does not resolve it, and success makes no pin
  s.ingest([tool('Bash', { command: 'make build' }, 'all good', false)])
  assert.equal(s.status().pins, 1) // a later success of the same tool resolves it
  assert.doesNotMatch(s.pins(), /failure/)
})

test('failure pin: a live main-session Bash failure with no later success stays pinned', () => {
  const { s } = mk()
  s.ingest([tool('Bash', { command: 'make' }, 'Exit code 2\nboom', true), tool('Read', { file_path: '/x' }, 'fine', false)])
  assert.equal(s.status().pins, 1)
  assert.match(s.pins(), /failure/)
  // another session's success does not resolve it
  s.ingest([tool('Bash', { command: 'ls' }, 'fine', false, 'other')])
  assert.equal(s.status().pins, 1)
})

test('failure pin: never from a subagent item (handback, Monitor, polling, bash typo)', () => {
  const { s } = mk()
  const sub = (t: NormItem): NormItem => ({ ...t, agent: 'ag1' })
  s.ingest([
    sub(tool('SubagentHandback', { message: '103/103 mutants killed' }, 'Only the auto-mode classifier can allow SubagentHandback', true)),
    sub(tool('Monitor', { query: 'select:Monitor' }, '<tool_use_error>InputValidationError</tool_use_error>', true)),
    sub(tool('Bash', { command: 'sleep 60; ls' }, '<tool_use_error>Blocked: sleep 60</tool_use_error>', true)),
    sub(tool('bash', { command: 'echo' }, '<tool_use_error>Error: No such tool', true)),
    sub(tool('Bash', { command: 'x' }, 'Exit code 1\nboom', false)),
  ])
  assert.equal(s.status().pins, 0)
  assert.equal(s.pins(), 'no open pins')
})

test('tool status: a successful handback/Monitor/ToolSearch and "Exit code 0" are ok, never pinned', () => {
  const { s } = mk()
  s.ingest([
    tool('SubagentHandback', { message: '103/103 mutants killed' }, 'Report delivered to your caller.', false, 'sess1', 'h0'),
    tool('Monitor', { query: 'select:Monitor' }, 'Handback ok', false, 'sess1', 'h1'),
    tool('ToolSearch', { query: 'select:Monitor' }, 'Exit code 0\nfound', false, 'sess1', 'h2'),
  ])
  assert.equal(s.status().pins, 0)
  assert.match(s.view('claude', 'sess1', { tailStart: 1 }).block, /SubagentHandback .*→ ok/)
})

test('failure pin: never during backfill, but backfill success still resolves', () => {
  const { s, cwd, home } = mk()
  const cdir = join(home, 'claude', 'p1')
  mkdirSync(cdir, { recursive: true })
  writeFileSync(join(cdir, 'a.jsonl'),
    cUser('u1', 'cs1', cwd, 'go', '2026-02-01T00:00:00Z') +
    cAsst('a1', 'cs1', cwd, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'false' } }], '2026-02-01T00:00:01Z') +
    cUser('r1', 'cs1', cwd, [{ type: 'tool_result', tool_use_id: 't1', content: 'Exit code 1', is_error: true }], '2026-02-01T00:00:02Z'))
  s.backfill({ claudeDir: join(home, 'claude'), piDir: join(home, 'pi') })
  assert.equal(s.status().items, 2)
  assert.equal(s.status().pins, 0)
  assert.equal(s.pins(), 'no open pins')
})

test('isDirective: only explicit standing-order language in a real human message pins', () => {
  const { s } = mk()
  const directives = [
    "I never want to submit a report I can't repro and submit to the standards I'd want from a report I'd receive.",
    'From now on, use tabs',
    "don't ever push to main",
    'Remember that the vault stays out of git.',
    'Run the tests every time you edit core.',
    'Always rebase.',
  ]
  const notDirectives = [
    "Why don't we make pi name things properly? does pi care?",
    'Should we always rebase?',
    "Use the edit tool on the file ~/x.md: replace its first body sentence with 'TEST EDIT' and do not touch anything else.",
    'go for it on fixing Rc',
    'reply OK',
    'I must stop and think; you should not do this.',
    'He said "never push to main" and left.',
    'Run `git push --always` please.',
    'Print:\n```\nalways\n```',
  ]
  s.ingest(directives.map((text, k) => user(text, 'sess1', 'd' + k)))
  assert.equal(s.status().pins, directives.length)
  s.ingest(notDirectives.map((text, k) => user(text, 'sess1', 'n' + k)))
  assert.equal(s.status().pins, directives.length)
})

test('isDirective: never from a one-shot run or a subagent prompt', () => {
  const { s } = mk()
  const words = 'Always answer in French.'
  s.ingest([{ ...user(words, 'sess1', 'a'), oneShot: true }, { ...user(words, 'sess1', 'b'), agent: 'sub1' }])
  assert.equal(s.status().pins, 0)
  s.ingest([user(words, 'sess1', 'c')])
  assert.equal(s.status().pins, 1)
})

test('failure pin from a successful tool is never created', () => {
  const { s } = mk()
  s.ingest([tool('Bash', { command: 'ls' }, 'fine', false)])
  assert.equal(s.status().pins, 0)
  assert.equal(s.pins(), 'no open pins')
})

test('failure status: only isError or a nonzero exit code marks a tool ERR', () => {
  const { s } = mk()
  // a "failed" in the first output line is not an error on its own
  s.ingest([tool('Bash', { command: 'grep failed' }, 'level=WARN msg="publish attempt failed"\nok', false, 'sess1', 'g0')])
  assert.match(s.view('claude', 'sess1', { tailStart: 1 }).block, /→ ok/)
  assert.equal(s.status().pins, 0)
  assert.equal(s.pins(), 'no open pins')
  // a nonzero exit code is an error even without isError
  s.ingest([tool('Bash', { command: 'x' }, 'Exit code 1\nboom', false, 'sess1', 'g1')])
  assert.match(s.view('claude', 'sess1', { tailStart: 2 }).block, /→ ERR/)
  assert.equal(s.status().pins, 1)
  // isError is an error
  s.ingest([tool('Bash', { command: 'y' }, 'clean output', true, 'sess1', 'g2')])
  assert.equal(s.status().pins, 2)
})

// ---------- fixtures ----------
function claudeLine(o: any): string { return JSON.stringify(o) + '\n' }
function cUser(uuid: string, session: string, cwd: string, content: any, t = ts()) {
  return claudeLine({ type: 'user', uuid, sessionId: session, timestamp: t, cwd, message: { role: 'user', content } })
}
function cAsst(uuid: string, session: string, cwd: string, content: any, t = ts()) {
  return claudeLine({ type: 'assistant', uuid, sessionId: session, timestamp: t, cwd, message: { role: 'assistant', content } })
}

test('syncClaude: cursor advances, shrink resets, calls pair across syncs and are deleted', () => {
  const { s, cwd, home, db } = mk()
  const f = join(home, 'c.jsonl')
  writeFileSync(f, cUser('u1', 'cs1', cwd, 'first message') +
    cAsst('a1', 'cs1', cwd, [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo A' } }]))
  assert.equal(s.syncClaude(f).added, 1)
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM calls').get().c, 1)
  // same id re-announced with different input: upsert refreshes it
  appendFileSync(f, cAsst('a2', 'cs1', cwd, [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo B' } }]))
  assert.equal(s.syncClaude(f).added, 0)
  appendFileSync(f, cUser('u2', 'cs1', cwd, [{ type: 'tool_result', tool_use_id: 'tu1', content: 'B' }]))
  assert.equal(s.syncClaude(f).added, 1) // cursor moved: only the new line
  assert.equal(s.syncClaude(f).added, 0)
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM calls').get().c, 0)
  const z = s.zoom('#1')
  assert.match(z, /tool Bash/)
  assert.match(z, /echo B/)
  assert.doesNotMatch(z, /echo A/)
  // file replaced by a shorter one: cursor resets, new content is read
  writeFileSync(f, cUser('u9', 'cs1', cwd, 'new'))
  assert.equal(s.syncClaude(f).added, 1)
})

test('syncClaude: a compaction re-written tail is not ingested twice; the engine summary is skipped', () => {
  const { s, cwd, home } = mk()
  const f = join(home, 'c.jsonl')
  const t1 = ts(), t2 = ts(), t3 = ts()
  writeFileSync(f, cUser('u1', 'cs1', cwd, 'note: codeword X', t1) + cAsst('a1', 'cs1', cwd, [{ type: 'text', text: 'noted' }], t2))
  assert.equal(s.syncClaude(f).added, 2)
  // compaction: boundary, the engine summary, then the kept tail again under new uuids
  appendFileSync(f, claudeLine({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', sessionId: 'cs1', timestamp: t3 }) +
    claudeLine({ type: 'user', uuid: 'sum1', sessionId: 'cs1', timestamp: t3, cwd, isCompactSummary: true, message: { role: 'user', content: 'This session is being continued. Summary: ...' } }) +
    cUser('u1b', 'cs1', cwd, 'note: codeword X', t1) + cAsst('a1b', 'cs1', cwd, [{ type: 'text', text: 'noted' }], t2) +
    cUser('u2', 'cs1', cwd, 'a new question', ts()))
  assert.equal(s.syncClaude(f).added, 1)
  assert.equal(s.status().items, 3)
  assert.equal(s.search('Summary').startsWith('no hits'), true)
  // the same text at another time, or in another session, is a new message
  appendFileSync(f, cUser('u3', 'cs1', cwd, 'note: codeword X', ts()) + cUser('u4', 'cs2', cwd, 'note: codeword X', t1))
  assert.equal(s.syncClaude(f).added, 2)
})

test('syncClaude: a compacted transcript read in one pass keeps each message once', () => {
  const { s, cwd, home } = mk()
  const f = join(home, 'c.jsonl')
  const t1 = ts(), t2 = ts()
  writeFileSync(f, cUser('u1', 'cs1', cwd, 'note: codeword X', t1) + cAsst('a1', 'cs1', cwd, [{ type: 'text', text: 'noted' }], t2) +
    cUser('u1b', 'cs1', cwd, 'note: codeword X', t1) + cAsst('a1b', 'cs1', cwd, [{ type: 'text', text: 'noted' }], t2))
  assert.equal(s.syncClaude(f).added, 2)
})

function piHead(id: string, cwd: string) { return JSON.stringify({ type: 'session', id, cwd }) + '\n' }
function pMsg(id: string, message: any, t = ts()) { return JSON.stringify({ type: 'message', id, timestamp: t, message }) + '\n' }

test('syncPi: closed call deleted, calls stored when pending', () => {
  const { s, cwd, home, db } = mk()
  const f = join(home, 'p.jsonl')
  writeFileSync(f, piHead('ps1', cwd) + pMsg('m1', { role: 'user', content: 'hi there' }) +
    pMsg('m2', { role: 'assistant', content: [{ type: 'toolCall', id: 'pc1', name: 'bash', arguments: { command: 'pwd' } }] }))
  assert.equal(s.syncPi(f).added, 1)
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM calls').get().c, 1)
  appendFileSync(f, pMsg('m3', { role: 'toolResult', toolCallId: 'pc1', toolName: 'bash', content: 'x', isError: false }))
  assert.equal(s.syncPi(f).added, 1)
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM calls').get().c, 0)
  assert.match(s.zoom('#1'), /tool bash/)
  assert.match(s.zoom('#1'), /pwd/)
})

test('backfill: only this project, ts order, open calls stored', () => {
  const { s, cwd, home, db } = mk()
  const other = join(home, 'elsewhere')
  mkdirSync(other)
  const cdir = join(home, 'claude', 'p1')
  const pdir = join(home, 'pi', 'p1')
  mkdirSync(cdir, { recursive: true })
  mkdirSync(pdir, { recursive: true })
  writeFileSync(join(cdir, 'a.jsonl'),
    cUser('u1', 'cs1', cwd, 'claude late', '2026-02-01T00:00:03Z') +
    cAsst('a1', 'cs1', cwd, [{ type: 'tool_use', id: 'open1', name: 'Bash', input: {} }], '2026-02-01T00:00:04Z'))
  writeFileSync(join(cdir, 'b.jsonl'), cUser('u2', 'cs2', other, 'foreign claude', '2026-02-01T00:00:01Z'))
  writeFileSync(join(pdir, 'c.jsonl'), piHead('ps1', cwd) + pMsg('m1', { role: 'user', content: 'pi early' }, '2026-02-01T00:00:00Z'))
  writeFileSync(join(pdir, 'd.jsonl'), piHead('ps2', other) + pMsg('m1', { role: 'user', content: 'foreign pi' }, '2026-02-01T00:00:02Z'))
  const r = s.backfill({ claudeDir: join(home, 'claude'), piDir: join(home, 'pi') })
  assert.equal(r.added, 2)
  assert.equal(s.seqOf('pi', 'ps1', 'm1:0'), 0)
  assert.equal(s.seqOf('claude', 'cs1', 'u1:0'), 1)
  assert.equal(s.seqOf('claude', 'cs2', 'u2:0'), undefined)
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM calls').get().c, 1)
})

test('view: tailStart clamps, default, high, bytes, root, views_log dedupe, algedonic', () => {
  const { s, db } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < 6; k++) items.push(user('item ' + k + ' é😀', 'sess1', 'v' + k))
  s.ingest(items)
  assert.equal(s.view('c', 'a').viewEnd, 6) // default tail = count
  assert.equal(s.view('c', 'b', { tailStart: 2 }).viewEnd, 2)
  assert.equal(s.view('c', 'hi', { tailStart: 99 }).viewEnd, 6)
  assert.equal(s.view('c', 'neg', { tailStart: -5 }).tailStart, 0)
  const v = s.view('c', 'b', { tailStart: 2 })
  assert.equal(v.bytes, Buffer.byteLength(v.block, 'utf8'))
  assert.ok(v.bytes !== v.block.length)
  assert.equal(v.algedonic, false)
  assert.deepEqual(s.verify(), { ok: true, problems: [] }) // root at viewEnd 2 (not count 6)
  const n0 = db().prepare("SELECT COUNT(*) AS c FROM views_log WHERE session = 'b'").get().c
  assert.equal(n0, 1) // viewed twice, identical block, logged once
  s.fold('c', 'b', 4)
  s.view('c', 'b')
  s.view('c', 'b')
  assert.equal(db().prepare("SELECT COUNT(*) AS c FROM views_log WHERE session = 'b'").get().c, 2)
})

const recentOf = (block: string): string[] => {
  const a = block.indexOf('<recent>\n')
  const b = block.indexOf('</recent>\n')
  assert.ok(a >= 0 && b > a, 'block has a <recent> section')
  return block.slice(a + 9, b).split('\n').filter((l) => l !== '')
}

test('view: explicit header budget, whole lines, newest last, nothing at or after tailStart', () => {
  const { s } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < 40; k++) items.push(user('message number ' + k + ' with a few more words to fill', 'sess1', 'h' + k))
  s.ingest(items)
  const small = recentOf(s.view('c', 'created', { header: 300, tailStart: 30 }).block)
  assert.ok(small.length > 0 && small.length < 30)
  assert.ok(small.reduce((n, l) => n + bytes(l) + 1, 0) <= 300)
  assert.equal(small.at(-1)!.split('|')[0], '#29') // newest last, the item just before tailStart
  assert.match(small[0], /^#\d+\|u:@c/) // the oldest line names its session
  const big = recentOf(s.view('c', 'late', { tailStart: 20 }).block) // default 8 KB: all 20 fit
  assert.deepEqual(big.map((l) => l.split('|')[0]), Array.from({ length: 20 }, (_, k) => '#' + k))
  assert.doesNotMatch(s.view('c', 'late').block, /<memory>/)
})

test('resolveHeader: zero and bad values fall back; CYTH_HEADER honoured', () => {
  const { s } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < 20; k++) items.push(user('message number ' + k + ' with filler words here', 'sess1', 'r' + k))
  s.ingest(items)
  const lines = (b: string) => recentOf(b).length
  assert.equal(lines(s.view('c', 'z', { header: 0 }).block), 20) // 0 -> default (8 KB)
  assert.equal(lines(s.view('c', 'n', { header: -4 }).block), 20)
  const saved = process.env.CYTH_HEADER
  try {
    process.env.CYTH_HEADER = '0'
    assert.equal(lines(s.view('c', 'e0').block), 20)
    process.env.CYTH_HEADER = 'junk'
    assert.equal(lines(s.view('c', 'e2').block), 20)
    process.env.CYTH_HEADER = '200'
    const few = lines(s.view('c', 'e1').block)
    assert.ok(few > 0 && few < 20, String(few))
  } finally {
    if (saved === undefined) delete process.env.CYTH_HEADER
    else process.env.CYTH_HEADER = saved
  }
})

test('fold: forward only, clamped to count, reuses existing view', () => {
  const { s } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < 8; k++) items.push(user('f' + k, 'sess1', 'f' + k))
  s.ingest(items)
  s.view('c', 's', { tailStart: 3 })
  s.fold('c', 's', 1) // backward: ignored
  assert.equal(s.view('c', 's').tailStart, 3)
  s.fold('c', 's', 5)
  assert.equal(s.view('c', 's').viewEnd, 5)
  s.fold('c', 's', 999) // beyond count: clamped
  assert.equal(s.view('c', 's').viewEnd, 8)
  s.fold('c', 'fresh', 2) // no view yet: created at count, fold can't go back
  assert.equal(s.view('c', 'fresh').viewEnd, 8)
})

test('zoom: range and item bounds, offset end, paging, utf8, footer', () => {
  const { s } = mk()
  s.ingest([user('a', 'sess1', 'z0'), user('b', 'sess1', 'z1'), user('c', 'sess1', 'z2')])
  assert.match(s.zoom('#0-1'), /^#0\|/)
  assert.throws(() => s.zoom('#2-3'), /beyond store/) // hi == count
  assert.throws(() => s.zoom('#3'), /beyond store/) // n == count
  const doc = s.zoom('#0')
  const total = Number(/of (\d+); end\]$/.exec(doc)![1])
  assert.match(s.zoom(`#0@${total}`), /bytes \d+-\d+ of \d+; end\]$/) // offset == total is legal
  assert.throws(() => s.zoom(`#0@${total + 1}`), /offset beyond/)
  // paging over multibyte text at every alignment
  for (const pad of ['', 'a', 'aa']) {
    const { s: t } = mk()
    const body = pad + '€'.repeat(20000)
    t.ingest([user(body, 'sess1', 'big')])
    let off = 0
    let got = ''
    for (let guard = 0; guard < 10; guard++) {
      const page = t.zoom(`#0@${off}`)
      const m = /\n\[#0 bytes (\d+)-(\d+) of (\d+); (more: memory_zoom #0@(\d+)|end)\]$/.exec(page)!
      const text = page.slice(0, m.index)
      assert.ok(bytes(text) <= PAGE)
      assert.ok(!text.includes('�'))
      got += text
      if (m[4] === 'end') break
      assert.equal(Number(m[5]), Number(m[2]))
      off = Number(m[2])
    }
    assert.ok(got.endsWith('€'.repeat(20000)))
    assert.ok(got.length > 20000)
  }
  // an exact-fit final page says end, not more
  const { s: e } = mk()
  e.ingest([user('x', 'sess1', 'e0')])
  assert.match(e.zoom('#0'), /; end\]$/)
})

test('search: FTS fallback, quote escaping, limit, regex, PAGE cap, empty', () => {
  const { s } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < 30; k++) items.push(user('needle common ' + k, 'sess1', 's' + k))
  items.push(user('say "hi there friend', 'sess1', 'q1'))
  items.push(user('the Mixed CaseWord appears', 'sess1', 'm1'))
  items.push(user('quoted he llo phrase', 'sess1', 'm2'))
  s.ingest(items)
  assert.equal(s.search('needle').split('\n').filter((l) => l.startsWith('#')).length, 20) // default limit
  assert.equal(s.search('needle', { limit: 3 }).split('\n').filter((l) => l.startsWith('#')).length, 3)
  assert.match(s.search('say "hi'), /#30\|/) // unbalanced quote -> fallback finds it
  assert.match(s.search('he"llo'), /#32\|/) // bare quote is an FTS syntax error; fallback must escape it
  assert.equal(s.search('zzzzqqq'), 'no hits for zzzzqqq')
  // regex
  assert.equal(s.search('needle common 1', { regex: true, limit: 1 }).split('\n').filter((l) => l.startsWith('#')).length, 1)
  assert.match(s.search('needle common 1', { regex: true, limit: 1 }), /^#19\|/) // newest first
  assert.match(s.search('MIXED casEword', { regex: true }), /#31\|/) // case-insensitive
  assert.equal(s.search('(unclosed', { regex: true }), 'no hits for (unclosed')
  assert.equal(s.search('nomatchatall', { regex: true }), 'no hits for nomatchatall')
  const lim = s.search('needle', { regex: true, limit: 2 })
  assert.equal(lim.split('\n').filter((l) => l.startsWith('#')).length, 2) // exactly limit
})

test('search: regex snippet window clamps at 0; output capped at PAGE', () => {
  const { s } = mk()
  s.ingest([user('FINDME ' + 'x'.repeat(400), 'sess1', 'w0')])
  const out = s.search('FINDME', { regex: true })
  assert.match(out, /\n  FINDME/)
  const { s: p } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < 80; k++) items.push(user('bulkword ' + 'filler text '.repeat(60) + k, 'sess1', 'b' + k))
  p.ingest(items)
  const res = p.search('bulkword', { limit: 80 })
  assert.ok(bytes(res) <= PAGE)
  assert.ok(res.split('\n').filter((l) => l.startsWith('#')).length < 80)
  const rx = p.search('bulkword', { regex: true, limit: 80 })
  assert.ok(bytes(rx) <= PAGE)
})

test('search: FTS output is newest first even when bm25 favours an old item', () => {
  const { s } = mk()
  const items: NormItem[] = []
  items.push(user('fox '.repeat(30), 'sess1', 'o0'))
  for (let k = 1; k < 6; k++) items.push(user('a single fox mention ' + k, 'sess1', 'o' + k))
  s.ingest(items)
  const refs = s.search('fox').split('\n').filter((l) => l.startsWith('#')).map((l) => Number(/^#(\d+)\|/.exec(l)![1]))
  assert.equal(refs.length, 6)
  assert.equal(refs[0], 5, 'newest item first')
  for (let k = 1; k < refs.length; k++) assert.ok(refs[k - 1] > refs[k], `refs strictly descending: ${refs.join(',')}`)
})

test('pin / unpin validation and listings', () => {
  const { s } = mk()
  s.ingest([user('one', 'sess1', 'p0'), user('two', 'sess1', 'p1')])
  assert.throws(() => s.pin('#0-1', 'r'), /range/)
  assert.throws(() => s.pin('#0@5', 'r'), /offset/)
  assert.throws(() => s.pin('#2', 'r'), /beyond store/)
  const id = s.pin('#1', 'keep this')
  assert.match(s.pins(), /keep this/)
  assert.match(s.view('c', 'x').block, /keep this/)
  assert.throws(() => s.unpin(9999), /no open pin/)
  s.unpin(id)
  assert.throws(() => s.unpin(id), /no open pin/)
  assert.equal(s.pins(), 'no open pins')
  assert.doesNotMatch(s.view('c', 'x').block, /keep this/)
  const a = s.pin('#0', 'first')
  const b = s.pin('#1', 'second')
  assert.ok(a < b)
  assert.ok(s.pins().indexOf('first') < s.pins().indexOf('second'))
})

test('pending: filter, order, prompts; status.pending; put/forget', () => {
  const { s, db } = mk()
  s.ingest([user(long('alpha'), 'sess1', 'n0'), user(long('beta'), 'sess1', 'n1'), tool('Bash', { command: 'x' }, 'ok', false, 'sess1', 'n2')])
  const p = s.pending(10)
  assert.deepEqual(p.map((x) => x.ref), ['#1', '#0', '#0-1'])
  assert.match(p[0].prompt, /beta/)
  assert.match(p[2].prompt, /alpha/)
  assert.match(p[2].prompt, /beta/)
  assert.ok(p[2].prompt.indexOf('alpha') < p[2].prompt.indexOf('beta'))
  assert.equal(s.pending(1).length, 1)
  assert.equal(s.status().pending, 3)
  // two rejected puts exhaust a node's tries
  assert.equal(s.put('#1', '   '), false)
  assert.equal(s.put('#1', 'x'.repeat(2000)), false)
  assert.equal(nodeRow(db(), 0, 1).tries, 2)
  assert.deepEqual(s.pending(10).map((x) => x.ref), ['#0', '#0-1'])
  assert.equal(s.status().pending, 2)
})

test('put: rejects det/verbatim/empty/oversize/missing/malformed, accepts boundary, prefixes, forget reverts', () => {
  const { s, db } = mk()
  s.ingest([
    user(long('alpha'), 'abcd9', 'k0'),
    user(long('beta'), 'abcd9', 'k1'),
    tool('Bash', { command: 'x' }, 'ok', false, 'abcd9', 'k2'),
    user('short verbatim', 'abcd9', 'k3'),
    user(long('gamma'), 'wxyz8', 'k4'), // session change (same harness) at seq 4
    user(long('delta'), 'wxyz8', 'k5'),
  ])
  assert.equal(s.put('#2', 'nope'), false) // det leaf
  assert.equal(s.put('#3', 'nope'), false) // verbatim leaf
  assert.equal(s.put('#999', 'x'), false) // missing node
  assert.equal(s.put('not a ref', 'x'), false) // malformed
  assert.equal(s.put('#0@5', 'x'), false) // offset
  // leaf: keeps tag/prefix
  assert.equal(s.put('#0', 'summary zero'), true)
  assert.match(nodeRow(db(), 0, 0).text, /^u:@cbcd9 summary zero$/)
  assert.equal(nodeRow(db(), 0, 0).source, 'model')
  assert.equal(s.put('#1', 'summary one'), true)
  assert.equal(nodeRow(db(), 0, 1).text, 'u:summary one')
  assert.equal(s.put('#4', 'summary four'), true)
  assert.match(nodeRow(db(), 0, 4).text, /^u:@cxyz8 summary four$/) // tag on session change
  assert.equal(s.put('#5', 'summary five'), true)
  assert.equal(nodeRow(db(), 0, 5).text, 'u:summary five')
  // merge node: whole text, no prefix
  assert.equal(s.put('#0-1', 'merged zero one'), true)
  assert.equal(nodeRow(db(), 1, 0).text, 'merged zero one')
  // boundary: exactly NODE bytes accepted on a merge node, NODE+1 rejected and counted
  assert.equal(s.put('#4-5', 'y'.repeat(NODE)), true)
  assert.equal(bytes(nodeRow(db(), 1, 2).text), NODE)
  assert.deepEqual(s.verify(), { ok: true, problems: [] }) // 512-byte node is legal
  s.forget('#4-5')
  const before = nodeRow(db(), 1, 2).tries
  assert.equal(s.put('#4-5', 'y'.repeat(NODE + 1)), false)
  assert.equal(nodeRow(db(), 1, 2).tries, before + 1)
  // forget: leaf back to clip, text restored, tries reset
  assert.equal(s.put('#0', ''), false) // tries -> 1 (model node: allowed to retry)
  assert.equal(nodeRow(db(), 0, 0).tries, 1)
  assert.equal(s.put('#0', 'again'), true)
  s.forget('#0')
  assert.equal(nodeRow(db(), 0, 0).source, 'clip')
  assert.equal(nodeRow(db(), 0, 0).tries, 0)
  assert.match(nodeRow(db(), 0, 0).text, /^u:@cbcd9 alpha/)
  s.forget('#3') // verbatim: untouched
  assert.equal(nodeRow(db(), 0, 3).source, 'verbatim')
  s.forget('#2') // det: untouched
  assert.equal(nodeRow(db(), 0, 2).source, 'det')
  s.forget('#1') // revert a model leaf mid-stream: no tag
  assert.equal(nodeRow(db(), 0, 1).source, 'clip')
  assert.match(nodeRow(db(), 0, 1).text, /^u:beta/)
  // merge node forget recomputes from current children
  assert.equal(s.put('#0-1', 'merged again'), true)
  s.forget('#0-1')
  const d = db()
  assert.equal(nodeRow(d, 1, 0).source, 'clip')
  assert.equal(nodeRow(d, 1, 0).text, mergeClip(nodeRow(d, 0, 0).text, nodeRow(d, 0, 1).text))
  // forget on a clip node with tries>0 does nothing at all
  assert.equal(s.put('#0', ''), false)
  assert.equal(s.put('#0', ''), false)
  const t0 = nodeRow(db(), 0, 0).tries
  s.forget('#0')
  assert.equal(nodeRow(db(), 0, 0).tries, t0)
  s.forget('#9999') // missing: no throw
  s.forget('bogus')
})

test('forget: model merge node whose children are clip with tries keeps tries on non-model', () => {
  const { s, db } = mk()
  s.ingest([user(long('a'), 'sess1', 'g0'), user(long('b'), 'sess1', 'g1')])
  s.put('#0-1', '')
  assert.equal(nodeRow(db(), 1, 0).tries, 1)
  s.forget('#0-1')
  assert.equal(nodeRow(db(), 1, 0).tries, 1)
})

test('verify: detects tampering of every kind', () => {
  const mkTampered = (fn: (d: DatabaseSync, count: number) => void): string[] => {
    const { s, db } = mk()
    s.ingest([
      user('one', 'sess1', 'x0'),
      tool('Bash', { command: 'ls' }, 'ok', false, 'sess1', 'x1'),
      user('three', 'sess1', 'x2'),
      user('four', 'sess1', 'x3'),
    ])
    s.view('c', 'v', { tailStart: 3 })
    assert.deepEqual(s.verify(), { ok: true, problems: [] })
    const d = db()
    fn(d, 4)
    return s.verify().problems
  }
  const has = (ps: string[], re: RegExp) => assert.ok(ps.some((p) => re.test(p)), JSON.stringify(ps))
  has(mkTampered((d) => d.exec("UPDATE items SET text = 'changed' WHERE seq = 0")), /item #0: hash mismatch/)
  has(mkTampered((d) => d.exec("UPDATE views_log SET root = 'ab'")), /views_log n=3: root/)
  has(mkTampered((d) => d.exec("UPDATE nodes SET text = '" + 'q'.repeat(600) + "' WHERE l = 0 AND i = 0")), /> 512/)
  has(mkTampered((d) => d.exec("UPDATE nodes SET text = 'a\nb' WHERE l = 0 AND i = 0")), /contains a newline/)
  has(mkTampered((d) => d.exec("UPDATE nodes SET mh = '" + '00'.repeat(32) + "' WHERE l = 0 AND i = 0")), /node \(0,0\) mh mismatch/)
  has(mkTampered((d) => d.exec("UPDATE nodes SET mh = '" + '00'.repeat(32) + "' WHERE l = 1 AND i = 0")), /node \(1,0\) mh mismatch/)
  has(mkTampered((d) => d.exec('DELETE FROM nodes WHERE l = 0 AND i = 1')), /missing children/)
  has(mkTampered((d) => d.exec('UPDATE views SET view_end = 2')), /viewEnd 2 != tailStart 3/)
  has(mkTampered((d) => d.exec('UPDATE views SET view_end = 5, tail_start = 5')), /tailStart 5 > count 4/)
  assert.deepEqual(mkTampered((d) => d.exec("UPDATE views SET parts = 'garbage'")), []) // legacy column, not read
  has(mkTampered((d) => d.exec("UPDATE items SET meta = '{bad' WHERE seq = 1")), /meta is not valid JSON/)
  // ok flag with exactly one problem
  const { s, db } = mk()
  s.ingest([user('one', 'sess1', 'o0')])
  db().exec("UPDATE nodes SET text = 'a\nb' WHERE l = 0 AND i = 0")
  const v = s.verify()
  assert.equal(v.problems.length, 1)
  assert.equal(v.ok, false)
})

test('safeParse: malformed stored meta never throws on read paths', () => {
  const { s, db } = mk()
  s.ingest([tool('Bash', { command: 'ls' }, 'ok', false, 'sess1', 'sp0')])
  db().exec("UPDATE items SET meta = '{bad' WHERE seq = 0")
  assert.doesNotThrow(() => s.zoom('#0'))
})

test('transactions: failed batch rolls back and the store stays usable', () => {
  const { s } = mk()
  s.ingest([user('keep', 'sess1', 'tx0')])
  const bad = { ...user('doomed', 'sess1', 'tx1'), ts: undefined as any }
  assert.throws(() => s.ingest([user('half', 'sess1', 'tx2'), bad]))
  assert.equal(s.status().items, 1)
  assert.deepEqual(s.ingest([user('after', 'sess1', 'tx3')]), { added: 1, lastSeq: 1 })
  assert.deepEqual(s.verify(), { ok: true, problems: [] })
})

test('commit is durable across a reopened store', () => {
  const { s, home, cwd } = mk()
  s.ingest([user('persist', 'sess1', 'cm0')])
  const t = openStore(cwd, { home })
  assert.equal(t.status().items, 1)
  t.close()
})

test('put: meta-commentary is rejected, counts as a try, and the node keeps its clip', () => {
  const { s, db } = mk()
  s.ingest([user(long('alpha'), 'sess1', 'm0'), user(long('beta'), 'sess1', 'm1')])
  const metas = [
    'Nothing in these two lines has lasting effect, so the merged line is empty.',
    'The merged line: nothing of lasting value.',
    'This summary covers the earlier discussion.',
    'There is nothing worth keeping here.',
    'No lasting effect.',
  ]
  for (const m of metas) assert.equal(s.put('#0-1', m), false, m)
  assert.equal(nodeRow(db(), 1, 0).source, 'clip')
  assert.ok(nodeRow(db(), 1, 0).tries >= 2) // pending() stops offering it, so the clip stays
  assert.deepEqual(s.pending(10).map((x) => x.ref), ['#1', '#0'])
  assert.equal(s.put('#0-1', 'Axel chose tabs over spaces for core/src.'), true)
  assert.equal(nodeRow(db(), 1, 0).source, 'model')
})

test('summary prompts ask for content and forbid talking about summarizing', () => {
  const { s } = mk()
  s.ingest([user(long('alpha'), 'sess1', 'q0'), user(long('beta'), 'sess1', 'q1')])
  for (const p of s.pending(10)) {
    assert.match(p.prompt, /Never mention/)
    assert.doesNotMatch(p.prompt, /lasting effect/)
  }
})

test('default header budget is 8192 bytes of <recent> lines; no tree lines', async () => {
  const { HEADER } = await import('../src/util.ts')
  assert.equal(HEADER, 8192)
  const { s } = mk()
  const saved = process.env.CYTH_HEADER
  delete process.env.CYTH_HEADER
  try {
    s.ingest(Array.from({ length: 400 }, (_, k) => user(long('w' + k, 480), 'sess1', 'h' + k)))
    const v = s.view('claude', 'other')
    const rec = recentOf(v.block)
    const n = rec.reduce((t, l) => t + bytes(l) + 1, 0)
    assert.ok(n <= 8192, `recent ${n}`)
    assert.ok(n > 8192 - 600, 'fills the budget up to one line short')
    assert.ok(v.bytes < 8192 + 3000, `block ${v.bytes} stays small`)
    assert.doesNotMatch(v.block, /<memory>|#\d+-\d+\|/)
  } finally {
    if (saved !== undefined) process.env.CYTH_HEADER = saved
  }
})

test('forgetSession: dry run lists exactly what goes and changes nothing; real run is consistent', () => {
  const { s, db } = mk()
  s.ingest([
    user('keep one', 'keep1', 'a0'),
    user('Always answer in French.', 'gone9xyz', 'g0'),
    tool('Bash', { command: 'echo gone' }, 'gone out', false, 'gone9xyz', 'g1'),
    asst('keep two', 'keep1', 'a1'),
    user('keep three never push', 'keep1', 'a2'),
    tool('Bash', { command: 'false' }, 'Exit code 1\nboom', true, 'keep1', 'a3'),
  ])
  const pk = s.pin('#2', 'mine')
  s.pin('#3', 'kept')
  db().prepare('INSERT INTO cursors (file, harness, offset) VALUES (?,?,?)').run('/x/gone9xyz.jsonl', 'claude', 99)
  db().prepare('INSERT INTO cursors (file, harness, offset) VALUES (?,?,?)').run('/x/keep1.jsonl', 'claude', 5)
  s.view('claude', 'keep1')
  const before = JSON.stringify(db().prepare('SELECT * FROM items ORDER BY seq').all())
  const dry = s.forgetSession('gone9xyz', { dryRun: true })
  assert.equal(dry.dryRun, true)
  assert.deepEqual(dry.items, [1, 2])
  assert.deepEqual(dry.cursors, ['/x/gone9xyz.jsonl'])
  assert.equal(dry.remaining, 4)
  assert.equal(dry.pins.includes(pk), true)
  assert.equal(JSON.stringify(db().prepare('SELECT * FROM items ORDER BY seq').all()), before)
  assert.equal(s.status().items, 6)

  const real = s.forgetSession(tag('claude', 'gone9xyz'))
  assert.deepEqual(real.items, dry.items)
  assert.equal(s.status().items, 4)
  assert.deepEqual(s.verify(), { ok: true, problems: [] })
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM items_fts').get().c, 4)
  assert.equal(db().prepare("SELECT COUNT(*) AS c FROM items WHERE session = 'gone9xyz'").get().c, 0)
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM views').get().c, 0)
  assert.deepEqual(db().prepare('SELECT file FROM cursors').all().map((r: any) => r.file), ['/x/keep1.jsonl'])
  assert.doesNotMatch(s.search('French'), /#\d/)
  // pins: the pin on a removed item is gone, the pin on a kept item follows its item to seq 1
  assert.match(s.pins(), /\[\d+\] #1 manual: kept \| keep two/)
  assert.doesNotMatch(s.pins(), /mine/)
  // a later sync of the forgotten session adds nothing
  assert.equal(s.ingest([user('Always answer in French.', 'gone9xyz', 'g0'), user('late', 'gone9xyz', 'g9')]).added, 0)
  assert.equal(s.status().items, 4)
  assert.throws(() => s.forgetSession('nope'), /no session/)
})

test('claude parser: entrypoint sdk-cli (claude -p) is one-shot, cli is not', () => {
  const { s, cwd } = mk()
  const rec = (n: string, entrypoint: string, text: string) => JSON.stringify({ type: 'user', uuid: n, sessionId: n, timestamp: '2026-01-01T00:00:00Z', cwd, entrypoint, message: { role: 'user', content: text } })
  const f = join(cwd, 'c.jsonl')
  writeFileSync(f, rec('print1', 'sdk-cli', 'Never touch the prod db.') + '\n' + rec('human1', 'cli', 'Never touch the prod db.') + '\n')
  assert.equal(s.syncClaude(f).added, 2)
  assert.match(s.pins(), /^\[1\] #1 directive/)
  assert.equal(s.status().pins, 1)
})

test('put: each meta-commentary pattern rejects on its own', () => {
  const { s } = mk()
  const metas = [
    'These two lines describe the port change.', // "these two lines"
    'Merged line: the build passed.', // "merged line"
    'No lasting changes were made.', // "no lasting"
    'Nothing of lasting interest happened.', // "nothing of … lasting"
    'This summary covers the port change.', // "this summary"
  ]
  for (const [k, m] of metas.entries()) {
    s.ingest([user(long('a' + k), 'sess1', 'p' + k + 'a'), user(long('b' + k), 'sess1', 'p' + k + 'b')])
    assert.equal(s.put(`#${k * 2}-${k * 2 + 1}`, m), false, m)
    assert.equal(s.put(`#${k * 2}-${k * 2 + 1}`, 'The port moved to 8443.'), true)
  }
})

test('forgetSession: ambiguous prefix refuses; the session raw rows go', () => {
  const { s, db } = mk()
  s.ingest([
    { ...user('hello', 'abcd-1', 'x0'), thinking: 'private' },
    user('hi', 'abcd-2', 'x1'),
    user('stay', 'zzzz', 'x2'),
  ])
  assert.throws(() => s.forgetSession('abcd'), /ambiguous/)
  assert.equal(s.status().items, 3)
  s.forgetSession('abcd-1')
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM raw').get().c, 0)
  assert.equal(s.status().items, 2)
})
