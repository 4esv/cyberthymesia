// A session stays in the store chosen at its first contact, whatever its cwd does later.
// Every path here uses a scratch --home; the real ~/.cyberthymesia is never touched.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/index.ts'

const CLI = new URL('../bin/cyth.ts', import.meta.url).pathname

function line(type: 'user' | 'assistant', uuid: string, sid: string, n: number, cwd: string): string {
  const ts = `2026-01-01T00:00:0${n}.000Z`
  const message = type === 'user' ? { role: 'user', content: `prompt ${uuid}` } : { role: 'assistant', content: [{ type: 'text', text: `answer ${uuid}` }] }
  return JSON.stringify({ type, uuid, sessionId: sid, timestamp: ts, cwd, message }) + '\n'
}

function stores(home: string): string[] {
  return readdirSync(home).filter((d) => d !== 'sessions.tsv').sort()
}

test('CLI: a Claude session whose cwd moves mid-session stays in its first store', () => {
  const home = mkdtempSync(join(tmpdir(), 'cyth-sticky-home-'))
  const a = mkdtempSync(join(tmpdir(), 'cyth-sticky-a-'))
  const b = mkdtempSync(join(tmpdir(), 'cyth-sticky-b-'))
  try {
    const file = join(a, 'sess-1.jsonl')
    const cli = (cwd: string, ...args: string[]) => {
      const r = spawnSync(process.execPath, [CLI, '--home', home, '--cwd', cwd, '--json', ...args], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      return JSON.parse(r.stdout)
    }
    writeFileSync(file, line('user', 'u1', 'sess-1', 1, a) + line('assistant', 'a1', 'sess-1', 2, a))
    assert.equal(cli(a, 'sync-claude', file).added, 2)
    // The agent cd's: later events carry the new cwd.
    appendFileSync(file, line('user', 'u2', 'sess-1', 3, b) + line('assistant', 'a2', 'sess-1', 4, b))
    assert.equal(cli(b, 'sync-claude', file).added, 2)
    cli(b, 'view', 'claude', 'sess-1')
    cli(b, 'view', 'claude', 'sess-1/agent-x') // a subagent key follows its parent session
    assert.equal(stores(home).length, 1, `one store expected, got ${stores(home).join(', ')}`)
    assert.equal(cli(a, 'status').items, 4)
    assert.equal(cli(b, '--session', 'claude:sess-1', 'status').items, 4)
  } finally {
    for (const d of [home, a, b]) rmSync(d, { recursive: true, force: true })
  }
})

test('openStore: the session option pins the store; without it the cwd decides', () => {
  const home = mkdtempSync(join(tmpdir(), 'cyth-sticky-home2-'))
  const a = mkdtempSync(join(tmpdir(), 'cyth-sticky-a2-'))
  const b = mkdtempSync(join(tmpdir(), 'cyth-sticky-b2-'))
  mkdirSync(a, { recursive: true })
  try {
    const first = openStore(a, { home, session: { harness: 'pi', session: 'p1' } })
    first.close()
    const later = openStore(b, { home, session: { harness: 'pi', session: 'p1' } })
    later.close()
    assert.equal(stores(home).length, 1)
    // another session in b is free to go to b
    openStore(b, { home, session: { harness: 'pi', session: 'p2' } }).close()
    assert.equal(stores(home).length, 2)
  } finally {
    for (const d of [home, a, b]) rmSync(d, { recursive: true, force: true })
  }
})
