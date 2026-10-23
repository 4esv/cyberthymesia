// Guard: no test may create anything under the real home. This runs every other test
// file in a child whose HOME is an empty scratch dir with CYTH_HOME unset, so a test
// that forgets its own home falls back to <scratch>/.cyberthymesia, and fails here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname

test('the suite never writes to the default cyberthymesia home', { skip: process.env.CYTH_GUARD_CHILD === '1', timeout: 300_000 }, () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'cyth-guard-home-'))
  try {
    const files = [
      ...readdirSync(join(ROOT, 'core/test')).filter((f) => f.endsWith('.test.ts') && f !== 'home-guard.test.ts').map((f) => `core/test/${f}`),
      ...readdirSync(join(ROOT, 'pi/test')).filter((f) => f.endsWith('.test.ts')).map((f) => `pi/test/${f}`),
    ]
    const env = { ...process.env, HOME: fakeHome, CYTH_GUARD_CHILD: '1' }
    delete env.CYTH_HOME
    delete env.NODE_TEST_CONTEXT // else the nested runner runs nothing and exits 0
    const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, env, encoding: 'utf8' })
    assert.equal(r.status, 0, `child suite failed:\n${r.stdout.slice(-2000)}`)
    const leaked = existsSync(join(fakeHome, '.cyberthymesia')) ? readdirSync(join(fakeHome, '.cyberthymesia')) : []
    assert.deepEqual(leaked, [], `tests leaked stores into the default home: ${leaked.join(', ')}`)
  } finally {
    rmSync(fakeHome, { recursive: true, force: true })
  }
})
