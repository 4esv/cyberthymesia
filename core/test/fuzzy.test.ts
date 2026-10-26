// Near-spelling fallback for search (core/src/fuzzy.ts and its use in
// search). Every store lives in a fresh temp home; never ~/.cyberthymesia.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NormItem, Store } from '../src/types.ts'
import { editDistance, maxEdit, plainWords, nearWords, widenedQuery, letterRange, FEW, NEAR, EXTRA } from '../src/fuzzy.ts'

const { openStore } = await import('../src/index.ts')

function mk(): { s: Store; db: () => DatabaseSync } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cyth-fuzzy-')))
  mkdirSync(join(base, 'home'))
  mkdirSync(join(base, 'proj'))
  const s = openStore(join(base, 'proj'), { home: join(base, 'home') })
  return { s, db: () => new DatabaseSync(s.dbPath) }
}
let stamp = 0
const ts = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++)).toISOString()
const item = (kind: 'user' | 'assistant', text: string): NormItem =>
  ({ harness: 'claude', session: 's1', uuid: kind[0] + stamp, kind, ts: ts(), text })
const tool = (name: string, input: unknown, output: string): NormItem =>
  ({ harness: 'claude', session: 's1', uuid: 't' + stamp, kind: 'tool', ts: ts(), text: '', tool: { name, input, output, isError: false } })
const hitSeqs = (out: string): number[] => out.split('\n').filter((l) => /^#\d+\|/.test(l)).map((l) => Number(l.slice(1, l.indexOf('|'))))
const v = (...xs: [string, number][]) => xs.map(([term, doc]) => ({ term, doc }))

test('editDistance: insert, delete, substitute and an adjacent swap each cost 1; capped at max + 1', () => {
  assert.equal(editDistance('balnce', 'balance', 1), 1)
  assert.equal(editDistance('licence', 'license', 1), 1)
  assert.equal(editDistance('recieve', 'receive', 1), 1) // swap
  assert.equal(editDistance('balance', 'balance', 2), 0)
  assert.equal(editDistance('abcdef', 'abcxyz', 1), 2) // early exit at max + 1
  assert.equal(editDistance('ab', 'abcdef', 2), 3) // length gap alone
  assert.equal(editDistance('multiplayr', 'multiplayer', 2), 1)
  assert.equal(editDistance('pixleta', 'pixelta', 1), 1)
})

test('maxEdit: no widening under 4 letters, 1 edit to 7, 2 from 8', () => {
  assert.deepEqual(['git', 'lazy', 'licence', 'balances', 'multiplayr'].map(maxEdit), [0, 1, 1, 2, 2])
})

test('plainWords: lowercased index words; null on any FTS syntax', () => {
  assert.deepEqual(plainWords('Pixelta Licence, SUBSTRATE.md'), ['pixelta', 'licence', 'substrate', 'md'])
  for (const q of ['"exact phrase"', 'pref*', 'body:x', '^start', '(a b)', 'a OR b', 'a AND b', 'NOT a', 'a NEAR b']) assert.equal(plainWords(q), null, q)
  assert.deepEqual(plainWords('or and not'), ['or', 'and', 'not']) // lowercase words are plain
})

test('nearWords: same first letter, within maxEdit, not itself, most documents first, at most NEAR', () => {
  const voc = v(['balance', 5], ['balances', 9], ['valance', 50], ['balnce', 1], ['baance', 2], ['bxlance', 2], ['bulance', 2], ['b4lance', 7])
  // balnce (6 letters, 1 edit): balance, baance, bxlance? no (2 edits), valance (other letter), b4lance (2 edits)
  assert.deepEqual(nearWords(voc, 'balnce'), ['balance', 'baance'])
  // five neighbours within 1 edit of "lazi": the 3 with most documents
  assert.deepEqual(nearWords(v(['lazy', 3], ['laze', 4], ['lazio', 9], ['lazis', 1], ['lami', 8], ['lady', 99]), 'lazi'), ['lazio', 'lami', 'laze'])
  assert.equal(NEAR, 3)
  assert.deepEqual(nearWords(v(['dog', 9]), 'dig'), []) // 3 letters: never widened
  assert.deepEqual(nearWords(v(['sha256', 9], ['sha255', 9]), 'sha256'), []) // only letter words
  assert.deepEqual(nearWords(v(['abcdefgh', 1]), 'abcd'), []) // length gap beyond maxEdit
  assert.deepEqual(nearWords(v(['beta', 2], ['alfa', 2], ['zeta', 2]), 'aeta'), [])
  assert.deepEqual(nearWords(v(['beta', 2], ['bets', 2], ['betz', 2]), 'betq'), ['beta', 'bets', 'betz']) // doc tie: by term
})

test('widenedQuery and letterRange: quoted OR groups joined by AND; one letter range', () => {
  assert.equal(widenedQuery([['a"b', 'c'], ['d']]), '("a""b" OR "c") AND ("d")')
  assert.deepEqual(letterRange('balnce'), ['b', 'c'])
  assert.deepEqual(letterRange('été'), ['é', 'ê'])
})

test('search: a typo finds the item, exact hits stay, the note names the spellings', () => {
  const { s } = mk()
  s.ingest([
    item('user', 'checked the deepseek balance today'), // #0
    item('assistant', 'the balance is fine'), // #1
    item('user', 'deepseek balnce typo in my own words'), // #2
  ])
  const out = s.search('deepseek balnce')
  assert.deepEqual(hitSeqs(out).sort(), [0, 2])
  assert.match(out, /\n\(near spellings also searched: balnce: balance\)$/)
  // from applies to near hits too
  assert.deepEqual(hitSeqs(s.search('balnce', { from: 'assistant' })), [1])
  // no neighbour: unchanged
  assert.equal(s.search('zzzzqqq'), 'no hits for zzzzqqq')
  // regex is not widened
  assert.equal(s.search('balnxe', { regex: true }), 'no hits for balnxe')
})

test('search: no widening once exact hits reach FEW; at most EXTRA near hits; limit holds', () => {
  const { s } = mk()
  const items: NormItem[] = []
  for (let k = 0; k < FEW; k++) items.push(item('user', 'licence number ' + k)) // #0..4
  for (let k = 0; k < 10; k++) items.push(item('user', 'license number ' + k)) // #5..14
  s.ingest(items)
  const exact = s.search('licence')
  assert.deepEqual(hitSeqs(exact).sort((a, b) => a - b), [0, 1, 2, 3, 4])
  assert.doesNotMatch(exact, /near spellings/)
  const { s: t } = mk()
  t.ingest([item('user', 'licence one'), ...Array.from({ length: 10 }, (_, k) => item('user', 'license other ' + k))])
  const few = t.search('licence')
  assert.equal(hitSeqs(few).length, 1 + EXTRA)
  assert.ok(hitSeqs(few).includes(0)) // the exact hit is never displaced
  assert.equal(EXTRA, 3)
  assert.equal(hitSeqs(t.search('licence', { limit: 2 })).length, 2)
  assert.equal(hitSeqs(t.search('licnce', { limit: 1 })).length, 1)
  // the exact hit ranks low in the widened query, so near hits alone fill limit
  const { s: w } = mk()
  w.ingest([
    item('user', 'licence zeta ' + 'filler words '.repeat(80)), // #0, the one exact hit
    ...Array.from({ length: 10 }, (_, k) => item('user', 'licence alone ' + k)),
    ...Array.from({ length: 6 }, (_, k) => item('user', 'license zeta ' + k)),
  ])
  const two = w.search('licence zeta', { limit: 2 })
  assert.deepEqual(hitSeqs(two).length, 2)
  assert.ok(hitSeqs(two).includes(0))
})

test('search: FTS syntax is never rewritten; own memory calls stay out of near hits', () => {
  const { s } = mk()
  s.ingest([
    item('user', 'license granted'), // #0
    tool('mcp__cyberthymesia__memory_find', { query: 'licence' }, 'licence hits'), // #1
  ])
  assert.equal(s.search('"licence"'), 'no hits for "licence"')
  assert.equal(s.search('licence*'), 'no hits for licence*')
  assert.deepEqual(hitSeqs(s.search('licence')), [0])
})

test('search: the vocab lives in temp, so the store file gains no table', () => {
  const { s, db } = mk()
  s.ingest([item('user', 'license granted')])
  assert.deepEqual(hitSeqs(s.search('licnse')), [0])
  const names = db().prepare("SELECT name FROM sqlite_master WHERE name LIKE '%vocab%'").all()
  assert.deepEqual(names, [])
})
