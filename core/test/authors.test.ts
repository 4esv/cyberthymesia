// from "user" means what the user typed (SPEC §4 search): not a subagent's
// prompt, a one-shot run (claude -p, pi -p), a plugin's injected turn or the
// engine's compaction summary. Old stores learn the authors once from their
// Claude transcripts. Every store lives in a fresh temp home.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Store } from '../src/types.ts'

const { openStore } = await import('../src/index.ts')

let stamp = 0
const ts = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++)).toISOString()

function mk(): { s: Store; home: string; cwd: string; base: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cyth-authors-')))
  const home = join(base, 'home')
  const cwd = join(base, 'proj')
  mkdirSync(home)
  mkdirSync(cwd)
  return { s: openStore(cwd, { home }), home, cwd, base }
}

// A Claude user record; extra carries origin, entrypoint, isCompactSummary, agentId.
const cUser = (uuid: string, session: string, cwd: string, text: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'user', uuid, sessionId: session, cwd, timestamp: ts(), message: { role: 'user', content: text }, ...extra }) + '\n'
const refs = (out: string): number[] => out.split('\n').filter((l) => l.startsWith('#')).map((l) => Number(/^#(\d+)\|/.exec(l)![1]))

test('from user: only what the user typed; subagent, one-shot, plugin and pi -p turns stay out, but stay searchable', () => {
  const { s, cwd, home } = mk()
  const f = join(home, 'main.jsonl')
  writeFileSync(f,
    cUser('h1', 'cs1', cwd, 'walrus typed by the user', { origin: { kind: 'human' }, entrypoint: 'cli' }) +
    cUser('h2', 'cs1', cwd, 'walrus from an old engine with no origin') +
    cUser('p1', 'cs1', cwd, 'walrus read the handoff note', { origin: { kind: 'plugin', name: 'x' } }) +
    cUser('o1', 'cs2', cwd, 'walrus brief for a headless run', { entrypoint: 'sdk-cli' }) +
    cUser('g1', 'cs1', cwd, 'walrus brief for a subagent', { isSidechain: true, agentId: 'abc123' }))
  assert.equal(s.syncClaude(f).added, 5)
  const pf = join(home, 'pi.jsonl')
  writeFileSync(pf, JSON.stringify({ type: 'session', id: 'ps1', cwd }) + '\n' +
    JSON.stringify({ type: 'message', id: 'm1', timestamp: ts(), message: { role: 'user', content: 'walrus from pi -p' } }) + '\n')
  assert.equal(s.syncPi(pf, { oneShot: true }).added, 1)
  const pf2 = join(home, 'pi2.jsonl')
  writeFileSync(pf2, JSON.stringify({ type: 'session', id: 'ps2', cwd }) + '\n' +
    JSON.stringify({ type: 'message', id: 'm1', timestamp: ts(), message: { role: 'user', content: 'walrus typed in pi' } }) + '\n')
  assert.equal(s.syncPi(pf2).added, 1)
  for (const regex of [false, true]) {
    assert.deepEqual(refs(s.search('walrus', { from: 'user', regex })), [6, 1, 0], `typed only (regex=${regex})`)
    assert.equal(refs(s.search('walrus', { regex })).length, 7, 'no from: all of them')
  }
  // limit counts typed hits only
  const two = refs(s.search('walrus', { from: 'user', limit: 2 }))
  assert.equal(two.length, 2)
  assert.ok(two.every((n) => [6, 1, 0].includes(n)), `typed only under a limit: ${two}`)
})

test('from user: compaction summaries and one-shot items are told apart through ingest() too', () => {
  const { s } = mk()
  s.ingest([
    { harness: 'claude', session: 's', uuid: 'a:0', kind: 'user', ts: ts(), text: 'otter typed' },
    { harness: 'claude', session: 's', uuid: 'b:0', kind: 'user', ts: ts(), text: 'otter oneshot', oneShot: true },
    { harness: 'claude', session: 's', uuid: 'c:0', kind: 'user', ts: ts(), text: 'otter plugin', by: 'plugin' },
  ])
  assert.deepEqual(refs(s.search('otter', { from: 'user' })), [0])
})

test('relabel: a store from before the authors table learns them once from its Claude transcripts', () => {
  const { s, cwd, home, base } = mk()
  const dir = join(base, 'fakehome', '.claude', 'projects', 'p')
  mkdirSync(dir, { recursive: true })
  const f = join(dir, 'old1.jsonl')
  writeFileSync(f,
    cUser('h1', 'old1', cwd, 'heron typed', { origin: { kind: 'human' } }) +
    cUser('c1', 'old1', cwd, 'heron summary', {}) +
    cUser('o1', 'old1', cwd, 'heron headless', { entrypoint: 'sdk-cli' }) +
    cUser('p1', 'old1', cwd, 'heron plugin', { origin: { kind: 'plugin' } }))
  // An old store: the items went in without authors, and the table did not exist.
  s.ingest([
    { harness: 'claude', session: 'old1', uuid: 'h1:0', kind: 'user', ts: ts(), text: 'heron typed' },
    { harness: 'claude', session: 'old1', uuid: 'c1:0', kind: 'user', ts: ts(), text: 'heron summary' },
    { harness: 'claude', session: 'old1', uuid: 'o1:0', kind: 'user', ts: ts(), text: 'heron headless' },
    { harness: 'claude', session: 'old1', uuid: 'p1:0', kind: 'user', ts: ts(), text: 'heron plugin' },
    { harness: 'claude', session: 'gone', uuid: 'g1:0', kind: 'user', ts: ts(), text: 'heron no transcript' },
  ])
  s.close()
  // the compaction summary is flagged only in the transcript the relabel reads
  writeFileSync(f,
    cUser('h1', 'old1', cwd, 'heron typed', { origin: { kind: 'human' } }) +
    cUser('c1', 'old1', cwd, 'heron summary', { isCompactSummary: true }) +
    cUser('o1', 'old1', cwd, 'heron headless', { entrypoint: 'sdk-cli' }) +
    cUser('p1', 'old1', cwd, 'heron plugin', { origin: { kind: 'plugin' } }))
  const raw = new DatabaseSync(s.dbPath)
  raw.exec('DROP TABLE authors')
  raw.close()
  const before = process.env.HOME
  process.env.HOME = join(base, 'fakehome')
  try {
    const s2 = openStore(cwd, { home })
    assert.deepEqual(refs(s2.search('heron', { from: 'user' })), [4, 0])
    const by = new DatabaseSync(s2.dbPath).prepare('SELECT seq, by FROM authors ORDER BY seq').all().map((r: any) => `${r.seq}:${r.by}`)
    assert.deepEqual(by, ['1:compact', '2:oneshot', '3:plugin'])
    s2.close()
    // once: a table that exists is never rebuilt (a later relabel would find these again)
    const raw2 = new DatabaseSync(s2.dbPath)
    raw2.exec('DELETE FROM authors')
    raw2.close()
    const s3 = openStore(cwd, { home })
    assert.equal(refs(s3.search('heron', { from: 'user' })).length, 5)
    assert.equal(s3.verify().ok, true)
  } finally {
    process.env.HOME = before
  }
})

test('forgetSession: the authors of the remaining items follow their new seqs', () => {
  const { s } = mk()
  s.ingest([
    { harness: 'claude', session: 'gone1', uuid: 'x:0', kind: 'user', ts: ts(), text: 'ibis gone' },
    { harness: 'claude', session: 'keep1', uuid: 'b:0', kind: 'user', ts: ts(), text: 'ibis plugin', by: 'plugin' },
    { harness: 'claude', session: 'keep1', uuid: 'a:0', kind: 'user', ts: ts(), text: 'ibis typed' },
  ])
  assert.deepEqual(refs(s.search('ibis', { from: 'user' })), [2, 0])
  s.forgetSession('gone1')
  // the plugin turn moved to #0 and the typed one to #1, where a stale author row would hide it
  assert.deepEqual(refs(s.search('ibis', { from: 'user' })), [1])
  assert.equal(refs(s.search('ibis')).length, 2)
})
