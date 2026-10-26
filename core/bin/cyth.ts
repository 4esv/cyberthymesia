#!/usr/bin/env node
// cyberthymesia CLI (SPEC §8): a thin, dependency-free wrapper over core/src/index.ts.
// One switch over the command; every store is closed on the way out.

import { openStore } from '../src/index.ts'
import type { Store } from '../src/types.ts'

const USAGE = `usage: cyth [--cwd DIR] [--home DIR] [--json] <command> ...
  status | sync-claude <file> | sync-pi <file> [--one-shot] | backfill [--claude DIR] [--pi DIR]
  | view <harness> <session> | fold <harness> <session> <seq> | zoom <ref>
  | search <q> [--regex] [--limit N] [--from user|assistant|tool] | roots | pin <ref> <reason> | unpin <id>
  | pins | forget-session <id|tag> [--dry-run] | verify`

class Usage extends Error {}

type Out = { json: unknown; human: string; code?: number }

const VALUE_FLAGS = new Set(['--cwd', '--home', '--limit', '--from', '--claude', '--pi', '--session'])
const BOOL_FLAGS = new Set(['--json', '--regex', '--dry-run', '--one-shot'])
const flags = new Map<string, string | true>()
const pos: string[] = []
let store: Store | undefined

function arity(n: number, form: string): void {
  if (pos.length !== n + 1) throw new Usage(`usage: cyth ${form}\n${USAGE}`)
}
function str(name: string): string | undefined {
  const v = flags.get(name)
  if (v === undefined) return undefined
  if (v === true) throw new Usage(`${name} needs a value`)
  return v
}
function num(s: string, what: string): number {
  if (!/^-?\d+$/.test(s)) throw new Usage(`${what} must be an integer, got "${s}"`)
  return Number(s)
}
function int(name: string): number | undefined {
  const v = str(name)
  return v === undefined ? undefined : num(v, name)
}
function harness(s: string): 'claude' | 'pi' {
  if (s !== 'claude' && s !== 'pi') throw new Usage(`harness must be claude or pi, got "${s}"`)
  return s
}
const text = (s: string): Out => ({ json: { text: s }, human: s })
const done = (): Out => ({ json: { ok: true }, human: 'ok' })

// The session a command belongs to, so it opens that session's first store:
// --session harness:id, else the session view/fold/sync name themselves.
function sessionOpt(rest: string[]): { session?: { harness: 'claude' | 'pi'; session: string } } {
  const flag = str('--session')
  const cmd = pos[0]
  if (flag !== undefined) {
    const k = flag.indexOf(':')
    return { session: { harness: harness(flag.slice(0, k < 0 ? 0 : k)), session: flag.slice(k + 1) } }
  }
  if ((cmd === 'view' || cmd === 'fold') && rest.length >= 2 && (rest[0] === 'claude' || rest[0] === 'pi')) {
    return { session: { harness: rest[0], session: rest[1] } }
  }
  if (cmd === 'sync-claude' && rest[0]) {
    const parts = rest[0].split('/')
    const base = parts[parts.length - 1].replace(/\.jsonl$/, '')
    const sub = parts.length >= 3 && parts[parts.length - 2] === 'subagents' ? parts[parts.length - 3] : base
    return { session: { harness: 'claude', session: sub } }
  }
  if (cmd === 'sync-pi' && rest[0]) {
    const m = /_([0-9a-f-]{20,})\.jsonl$/.exec(rest[0])
    if (m) return { session: { harness: 'pi', session: m[1] } }
  }
  return {}
}

function run(): Out {
  const [cmd, ...rest] = pos
  const open = (): Store => {
    if (store === undefined) {
      const home = str('--home')
      store = openStore(str('--cwd') ?? process.cwd(), { ...(home === undefined ? {} : { home }), ...sessionOpt(rest) })
    }
    return store
  }
  switch (cmd) {
    case 'status': {
      arity(0, 'status')
      const st = open().status()
      return { json: st, human: Object.entries(st).map(([k, v]) => `${k}: ${v}`).join('\n') }
    }
    case 'sync-claude':
    case 'sync-pi': {
      arity(1, `${cmd} <file>`)
      const r = cmd === 'sync-claude' ? open().syncClaude(rest[0]) : open().syncPi(rest[0], { oneShot: flags.get('--one-shot') === true })
      return { json: { added: r.added }, human: `added: ${r.added}` }
    }
    case 'backfill': {
      arity(0, 'backfill [--claude DIR] [--pi DIR]')
      const claudeDir = str('--claude')
      const piDir = str('--pi')
      const r = open().backfill({
        ...(claudeDir === undefined ? {} : { claudeDir }),
        ...(piDir === undefined ? {} : { piDir }),
      })
      return { json: { added: r.added }, human: `added: ${r.added}` }
    }
    case 'view': {
      arity(2, 'view <harness> <session>')
      const v = open().view(harness(rest[0]), rest[1])
      return { json: v, human: v.block }
    }
    case 'fold': {
      arity(3, 'fold <harness> <session> <seq>')
      const h = harness(rest[0])
      const seq = num(rest[2], 'seq')
      open().fold(h, rest[1], seq)
      return done()
    }
    case 'zoom': {
      arity(1, 'zoom <ref>')
      return text(open().zoom(rest[0]))
    }
    case 'search': {
      arity(1, 'search <q> [--regex] [--limit N] [--from user|assistant|tool]')
      const limit = int('--limit')
      const from = str('--from')
      const q = rest[0]
      return text(open().search(q, { ...(flags.get('--regex') === true ? { regex: true } : {}), ...(limit === undefined ? {} : { limit }), ...(from === undefined ? {} : { from: from as 'user' }) }))
    }
    case 'roots': {
      arity(0, 'roots')
      return text(open().roots())
    }
    case 'pin': {
      arity(2, 'pin <ref> <reason>')
      const id = open().pin(rest[0], rest[1])
      return { json: { id }, human: `pin ${id}` }
    }
    case 'unpin': {
      arity(1, 'unpin <id>')
      const id = num(rest[0], 'id')
      open().unpin(id)
      return done()
    }
    case 'pins': {
      arity(0, 'pins')
      return text(open().pins())
    }
    case 'forget-session': {
      arity(1, 'forget-session <id|tag> [--dry-run]')
      const p = open().forgetSession(rest[0], { dryRun: flags.get('--dry-run') === true })
      const lines = [
        `${p.dryRun ? 'would remove' : 'removed'} session ${p.sessions.map((x) => `${x.harness}:${x.session}`).join(', ')}`,
        `items (${p.items.length}): ${p.items.join(' ')}`,
        `fts rows: ${p.ftsRows}; raw rows: ${p.rawRows}; pending-call rows: ${p.callRows}`,
        `pins (${p.pins.length}): ${p.pins.join(' ')}`,
        `session views: ${p.views.map((v) => `${v.harness}:${v.session}`).join(' ') || 'none'}`,
        `cursors: ${p.cursors.join(' ') || 'none'}`,
        `items remaining: ${p.remaining}`,
        `also: ${p.resets}`,
      ]
      return { json: p, human: lines.join('\n') }
    }
    case 'verify': {
      arity(0, 'verify')
      const v = open().verify()
      return { json: v, human: v.ok ? 'ok' : v.problems.join('\n'), code: v.ok ? 0 : 1 }
    }
    default:
      throw new Usage(`unknown command "${cmd ?? ''}"\n${USAGE}`)
  }
}

try {
  const argv = process.argv.slice(2)
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]
    if (a === '--') {
      pos.push(...argv.slice(k + 1))
      break
    }
    if (!a.startsWith('--')) {
      pos.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = eq < 0 ? a : a.slice(0, eq)
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new Usage(`${name} takes no value`)
      flags.set(name, true)
    } else if (VALUE_FLAGS.has(name)) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++k]
      if (v === undefined) throw new Usage(`${name} needs a value`)
      flags.set(name, v)
    } else {
      throw new Usage(`unknown flag "${name}"\n${USAGE}`)
    }
  }
  const out = run()
  const line = flags.get('--json') === true ? JSON.stringify(out.json) : out.human
  process.stdout.write(line.endsWith('\n') ? line : line + '\n')
  process.exitCode = out.code ?? 0
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = e instanceof Usage ? 2 : 1
} finally {
  store?.close()
}
