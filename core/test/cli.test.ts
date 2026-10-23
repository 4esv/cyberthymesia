// CLI tests (SPEC §8, §10): every run spawns core/bin/cyth.ts with a temp
// --home and --cwd, so ~/.cyberthymesia is never touched.
// Run: node --test core/test/*.test.ts

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cyth.ts')
const home = mkdtempSync(join(tmpdir(), 'cyth-cli-home-'))
const cwd = mkdtempSync(join(tmpdir(), 'cyth-cli-cwd-'))
const session = join(cwd, 'pi-s1.jsonl')

// A small Pi session: a directive, one assistant turn with a tool call, and
// the tool's result. Three items: user, assistant text, tool.
const lines = [
  { type: 'session', id: 's1', cwd },
  { type: 'message', id: 'e1', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'never use sudo' } },
  {
    type: 'message',
    id: 'e2',
    timestamp: '2026-01-01T00:00:01Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'c1', name: 'Bash', arguments: { command: 'ls' } },
        { type: 'text', text: 'listing the directory' },
      ],
    },
  },
  {
    type: 'message',
    id: 'e3',
    timestamp: '2026-01-01T00:00:02Z',
    message: {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'Bash',
      content: [{ type: 'text', text: 'a\nb' }],
      isError: false,
    },
  },
]
writeFileSync(session, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

function run(...args: string[]) {
  return spawnSync(process.execPath, [CLI, '--home', home, '--cwd', cwd, ...args], { encoding: 'utf8' })
}

function json(...args: string[]): any {
  const r = run('--json', ...args)
  assert.equal(r.status, 0, `cyth ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

function dbFile(): string {
  const dirs = readdirSync(home)
  assert.equal(dirs.length, 1, `expected one store dir in ${home}, got ${dirs.join(', ')}`)
  return join(home, dirs[0], 'store.db')
}

after(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

test('sync-pi ingests once and is idempotent', () => {
  assert.deepEqual(json('sync-pi', session), { added: 3 })
  const again = run('--json', 'sync-pi', session)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(JSON.parse(again.stdout).added, 0)
})

test('status counts the items and the directive pin', () => {
  const st = json('status')
  assert.equal(st.items, 3)
  assert.equal(st.pins, 1)
  assert.equal(typeof st.nodes, 'number')
  assert.equal(typeof st.root, 'string')
})

test('view renders the memory block', () => {
  const v = json('view', 'pi', 's1')
  assert.equal(typeof v.block, 'string')
  assert.ok(v.block.includes('<memory>'), v.block.slice(0, 200))
  assert.equal(v.viewEnd, 3)
})

test('zoom and search reach the user item', () => {
  assert.ok(json('zoom', '#0').text.includes('never use sudo'))
  const hits = json('search', 'sudo').text
  assert.ok(hits.includes('#0'), hits)
})

test('pin, pins, unpin round trip', () => {
  const { id } = json('pin', '#1', 'keep this')
  assert.ok(Number.isInteger(id) && id > 0)
  assert.ok(json('pins').text.includes('keep this'))
  assert.deepEqual(json('unpin', String(id)), { ok: true })
  assert.ok(!json('pins').text.includes('keep this'))
})

test('pending is a JSON array', () => {
  assert.ok(Array.isArray(json('pending', '--limit', '5')))
})

test('put on an unknown ref is not an error', () => {
  const r = run('--json', 'put', '#99', 'x')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).ok, false)
})

test('verify is clean before tampering', () => {
  const r = run('verify')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(run('--json', 'verify').stdout).ok, true)
})

test('usage errors exit 2 with stderr and no stdout', () => {
  const unknown = run('bogus')
  assert.equal(unknown.status, 2)
  assert.ok(unknown.stderr.length > 0)
  assert.equal(unknown.stdout, '')

  const fold = run('fold', 'pi', 's1', 'not-an-integer')
  assert.equal(fold.status, 2)
  assert.ok(fold.stderr.length > 0)
  assert.equal(fold.stdout, '')

  const limit = run('search', 'sudo', '--limit', 'many')
  assert.equal(limit.status, 2)
  assert.equal(limit.stdout, '')
})

test('arity, harness, unknown flag and valueless flag are usage errors', () => {
  for (const args of [
    ['status', 'extra'],
    ['view', 'x', 's1'],
    ['fold', 'x', 's1', '2'],
    ['--bogus', 'status'],
    ['search', 'sudo', '--limit'],
  ]) {
    const r = run(...args)
    assert.equal(r.status, 2, `cyth ${args.join(' ')} exited ${r.status}`)
    assert.ok(r.stderr.length > 0)
    assert.equal(r.stdout, '')
  }
})

test('--regex and --limit reach search', () => {
  assert.ok(json('search', 'su+do', '--regex').text.includes('#0'))
  assert.ok(!json('search', 'su+do').text.includes('#0'))
})

test('--cwd selects the project regardless of the process cwd', () => {
  const other = mkdtempSync(join(tmpdir(), 'cyth-cli-other-'))
  try {
    const r = spawnSync(process.execPath, [CLI, '--home', home, '--cwd', cwd, '--json', 'status'], { encoding: 'utf8', cwd: other })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).items, 3)
  } finally {
    rmSync(other, { recursive: true, force: true })
  }
})

test('pending --limit, sync-claude and fold seq on a fresh store', () => {
  const h = mkdtempSync(join(tmpdir(), 'cyth-cli-home2-'))
  const c = mkdtempSync(join(tmpdir(), 'cyth-cli-cwd2-'))
  const r2 = (...a: string[]) => {
    const r = spawnSync(process.execPath, [CLI, '--home', h, '--cwd', c, '--json', ...a], { encoding: 'utf8' })
    assert.equal(r.status, 0, `cyth ${a.join(' ')}: ${r.stderr}`)
    return JSON.parse(r.stdout)
  }
  try {
    // fold: the session is created at tailStart 0 on an empty store.
    assert.equal(r2('view', 'claude', 'c1').tailStart, 0)

    const ts = '2026-01-01T00:00:00Z'
    const f = join(c, 'claude-c1.jsonl')
    writeFileSync(
      f,
      [
        { type: 'user', uuid: 'u1', sessionId: 'c1', timestamp: ts, cwd: c, message: { role: 'user', content: 'hello claude' } },
        { type: 'assistant', uuid: 'a1', sessionId: 'c1', timestamp: ts, cwd: c, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
      ].map((l) => JSON.stringify(l)).join('\n') + '\n',
    )
    assert.deepEqual(r2('sync-claude', f), { added: 2 })

    r2('fold', 'claude', 'c1', '2')
    const v = r2('view', 'claude', 'c1')
    assert.equal(v.tailStart, 2)
    assert.equal(v.viewEnd, 2)

    // pending: long items leave clip leaves pending.
    const long = join(c, 'pi-long.jsonl')
    const big = (n: number) => 'word '.repeat(300) + n
    writeFileSync(
      long,
      [{ type: 'session', id: 'L', cwd: c }]
        .concat([1, 2, 3, 4].map((n) => ({ type: 'message', id: `m${n}`, timestamp: ts, message: { role: 'user', content: big(n) } }) as any))
        .map((l) => JSON.stringify(l)).join('\n') + '\n',
    )
    r2('sync-pi', long)
    const count = (t: string) => (t.match(/^#\d+/gm) ?? []).length
    assert.ok(count(r2('search', 'word').text) >= 2)
    assert.equal(count(r2('search', 'word', '--limit', '1').text), 1)
    const all = r2('pending')
    assert.ok(all.length >= 2, `need >=2 pending, got ${all.length}`)
    assert.equal(r2('pending', '--limit', '1').length, 1)
  } finally {
    rmSync(h, { recursive: true, force: true })
    rmSync(c, { recursive: true, force: true })
  }
})

test('tampering with the db makes verify exit 1', () => {
  const db = new DatabaseSync(dbFile())
  try {
    db.exec("UPDATE items SET text = 'x' WHERE seq = 0")
  } finally {
    db.close()
  }
  const r = run('--json', 'verify')
  assert.equal(r.status, 1)
  assert.equal(JSON.parse(r.stdout).ok, false)
  assert.ok(r.stderr === '', r.stderr)
})
