// Mutation sweep (SPEC §10): break each guard, run the tests, expect red, restore.
// Usage: node core/scripts/mutate.ts <mutants.json> [--test "<cmd>"] [--md <out.md>]
// mutants.json: [{ "id": "M1", "file": "core/src/index.ts", "find": "<exact text, unique>",
//                  "replace": "<broken text>", "guard": "<what the guard protects>" }]
// Exit 1 if any mutant survives or cannot be applied. The file is always restored.

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'

type Mutant = { id: string; file: string; find: string; replace: string; guard: string }

const args = process.argv.slice(2)
const list = args[0]
if (!list) {
  console.error('usage: node core/scripts/mutate.ts <mutants.json> [--test "<cmd>"] [--md <out.md>]')
  process.exit(2)
}
const opt = (k: string): string | undefined => {
  const at = args.indexOf(k)
  return at >= 0 ? args[at + 1] : undefined
}
const cmd = opt('--test') ?? 'node --test core/test/*.test.ts'
const md = opt('--md')
const mutants: Mutant[] = JSON.parse(fs.readFileSync(list, 'utf8'))

function green(): boolean {
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 600_000 })
    return true
  } catch {
    return false
  }
}

if (!green()) {
  console.error('baseline is red: fix the tests before mutating')
  process.exit(2)
}

const rows: string[] = []
let bad = 0
for (const m of mutants) {
  const orig = fs.readFileSync(m.file, 'utf8')
  const hits = orig.split(m.find).length - 1
  let verdict: string
  if (hits !== 1) {
    verdict = `NOT APPLIED (${hits} matches)`
    bad++
  } else {
    fs.writeFileSync(m.file, orig.replace(m.find, () => m.replace))
    try {
      verdict = green() ? 'SURVIVED' : 'killed'
    } finally {
      fs.writeFileSync(m.file, orig)
    }
    if (verdict !== 'killed') bad++
  }
  const row = `| ${m.id} | ${m.file} | ${m.guard.replace(/\|/g, '\\|')} | ${verdict} |`
  rows.push(row)
  console.log(row)
}

if (!green()) {
  console.error('tests red after restore: a file was not restored cleanly')
  process.exit(2)
}

const table = ['| id | file | guard | result |', '|---|---|---|---|', ...rows].join('\n')
if (md) fs.writeFileSync(md, table + '\n')
console.log(`\n${mutants.length - bad}/${mutants.length} killed`)
process.exit(bad === 0 ? 0 : 1)
