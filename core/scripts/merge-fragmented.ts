// Repair stores split by a mid-session cwd change: re-sync each fragmented session's
// transcript into the store of its first cwd (cursor continues, dedupe by uuid), then
// forget the session in every other store and remove a stray store left empty.
// Usage: node core/scripts/merge-fragmented.ts [--home DIR] [--apply]   (dry run by default)

import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openStore } from '../src/index.ts'
import { sessionRoot } from '../src/sessions.ts'
import { claudeCwd, piHeader, listClaude, listPi } from '../src/ingest.ts'
import { cythHome, projectRoot, slugOf } from '../src/project.ts'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const hi = argv.indexOf('--home')
const home = cythHome(hi >= 0 ? argv[hi + 1] : undefined)

type Frag = { harness: 'claude' | 'pi'; session: string; slug: string; items: number; min: string; max: string }
const frags = new Map<string, Frag[]>()
for (const slug of fs.readdirSync(home)) {
  const db = path.join(home, slug, 'store.db')
  if (!fs.existsSync(db)) continue
  const d = new DatabaseSync(db, { readOnly: true })
  for (const r of d.prepare('SELECT harness, session, COUNT(*) c, MIN(ts) a, MAX(ts) b FROM items GROUP BY harness, session').all() as any[]) {
    const k = `${r.harness}:${r.session}`
    if (!frags.has(k)) frags.set(k, [])
    frags.get(k)!.push({ harness: r.harness, session: r.session, slug, items: r.c, min: r.a, max: r.b })
  }
  d.close()
}

// slug -> directory, by walking the filesystem (the slug is lossy: '/' and '-' both read '-').
function dirOfSlug(rem: string, at = '/'): string | undefined {
  let names: string[]
  try { names = fs.readdirSync(at) } catch { return undefined }
  for (const n of names) {
    if (rem === n) return path.join(at, n)
    if (rem.startsWith(n + '-')) {
      const hit = dirOfSlug(rem.slice(n.length + 1), path.join(at, n))
      if (hit) return hit
    }
  }
  return undefined
}

const claudeFiles = listClaude(path.join(os.homedir(), '.claude/projects'))
const piFiles = listPi(path.join(os.homedir(), '.pi/agent/sessions'))

for (const [k, fr] of frags) {
  if (fr.length < 2) continue
  const { harness, session } = fr[0]
  const files = harness === 'claude'
    ? claudeFiles.filter((f) => path.basename(f) === `${session}.jsonl` || f.includes(`/${session}/subagents/`))
    : piFiles.filter((f) => f.includes(`_${session}.jsonl`))
  files.sort((x, y) => Number(path.basename(y) === `${session}.jsonl`) - Number(path.basename(x) === `${session}.jsonl`)) // main transcript first
  const cwd = files.length ? (harness === 'claude' ? claudeCwd(files[0]) : piHeader(files[0])?.cwd) : null
  if (!cwd) { console.log(`${k}: no transcript or cwd, skipped`); continue }
  const homeSlug = slugOf(projectRoot(cwd))
  console.log(`\n${k}: first cwd ${cwd} -> store ${homeSlug}; ${files.length} transcript file(s)`)
  for (const f of fr) console.log(`  ${f.slug === homeSlug ? 'HOME ' : 'stray'} ${f.slug}: ${f.items} items ${f.min} .. ${f.max}`)
  if (!fr.some((f) => f.slug === homeSlug)) { console.log('  home store has none of it yet; will be created by sync'); }
  if (apply) sessionRoot({ harness, session }, cwd, home) // pin the session to its first store before anything else
  const target = openStore(cwd, { home })
  const before = target.status().items
  try {
    for (const f of files) {
      // dry run: report only what a sync would add by counting uuids not yet present is not cheap; apply to see
      if (apply) { const r = harness === 'claude' ? target.syncClaude(f) : target.syncPi(f); console.log(`  sync ${path.basename(f)}: added ${r.added}`) }
      else if (f === files[0]) console.log(`  would sync ${files.length} transcript file(s) into ${homeSlug} (main: ${path.basename(f)}; cursors continue, duplicates skipped by uuid)`)
    }
    if (apply) console.log(`  home store items ${before} -> ${target.status().items}`)
  } finally { target.close() }
  for (const f of fr.filter((x) => x.slug !== homeSlug)) {
    console.log(`  ${apply ? 'forget' : 'would forget'} ${k} in stray ${f.slug} (${f.items} items, renumbers that store)`)
    if (!apply) continue
    const dir = dirOfSlug(f.slug)
    if (!dir) { console.log('    cannot resolve the stray store to a directory; left alone'); continue }
    const stray = openStore(dir, { home })
    try {
      stray.forgetSession(session)
      const left = stray.status().items
      console.log(`    stray now has ${left} items`)
      if (left === 0) {
        stray.close()
        fs.rmSync(path.join(home, f.slug), { recursive: true })
        console.log('    stray store was empty: removed')
      }
    } finally { try { stray.close() } catch { /* closed */ } }
  }
}
