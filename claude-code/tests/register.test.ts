import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const BIN = `${REPO}/core/bin/cyth.ts`
const CWD = '/w'
const SID = 'S1'

type Run = { argv: readonly string[]; init?: unknown }
type Cli = (argv: readonly string[]) => { exitCode: number; stdout?: string; stderr?: string } | 'throw'

/** Stands for the engine beneath the plugin: env, session, fs and process.run. */
function world(on: On, opts: { env?: Record<string, string>; cli?: Cli } = {}) {
  const runs: Run[] = []
  const statuses: (string | undefined)[] = []
  const env = { CLAUDE_CONFIG_DIR: '/cfg', ...(opts.env ?? {}) }
  on('env.get', (_, e) => ({ value: (env as Record<string, string>)[e.name] }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: SID }))
  on('fs.exists', () => ({ value: true }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, init: e.init })
    const r = (opts.cli ?? (() => ({ exitCode: 0, stdout: '{}' })))(e.argv)
    if (r === 'throw') return { deny: 'spawn failed' } as never
    return { value: { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } as never }
  })
  return { runs, statuses }
}

const sub = (argv: readonly string[]) => argv[0] === 'node' && argv[1] === '--input-type=module' ? 'seq' : (argv[argv.indexOf('--json') + 1] ?? '')

const u = (text: string, handle: string) => ({ role: 'user' as const, text, toolUses: [], handle })
const a = (text: string, handle: string) => ({ role: 'assistant' as const, text, toolUses: [], handle })
const MESSAGES = [u('first prompt', 'h0'), a('first answer', 'h1'), u('second prompt', 'h2'), a('second answer', 'h3')]

/** The CLI as core would answer a successful compaction. */
const goodCli: Cli = argv => {
  const s = sub(argv)
  if (s === 'seq') return { exitCode: 0, stdout: '7' }
  if (s === 'view') return { exitCode: 0, stdout: JSON.stringify({ block: '<memory>VIEWBLOCK</memory>' }) }
  if (s === 'status') return { exitCode: 0, stdout: JSON.stringify({ items: 3, pending: 1, pins: 2 }) }
  if (s === 'pending') return { exitCode: 0, stdout: '[]' }
  return { exitCode: 0, stdout: '{}' }
}

const compactInput = { trigger: 'manual' as const, messages: MESSAGES }

test('turn.complete syncs the transcript through the CLI', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { cli: goodCli, env: { CLAUDE_CONFIG_DIR: '/cfg' } })
  on('session.usage', () => ({ value: { context: { tokens: 10 } } as never }))
  on('turn.complete', () => ({ text: 'done' }))
  const r = await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  expect(r).toEqual({ text: 'done' })
  await clock.advance(1000)
  const sync = w.runs.find(x => x.argv.includes('sync-claude'))
  expect(sync?.argv).toEqual(['node', BIN, '--cwd', CWD, '--session', `claude:${SID}`, '--json', 'sync-claude', `/cfg/projects/-w/${SID}.jsonl`])
  // status line shown after ingest
  expect(w.statuses).toContain('cyth 3 items · 1 pending · 2 pins')
})

test('turn.complete uses the transcript path a Stop event carried', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { cli: goodCli })
  on('session.usage', () => ({ value: { context: { tokens: 10 } } as never }))
  on('turn.complete', () => ({ text: 'done' }))
  on('classic.Stop', () => ({}))
  await $.classic.Stop({ stop_hook_active: false, session_id: SID, transcript_path: '/elsewhere/t.jsonl' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(1000)
  const sync = w.runs.find(x => x.argv.includes('sync-claude'))
  expect(sync?.argv.at(-1)).toBe('/elsewhere/t.jsonl')
})

test('turn.complete never raises a compaction itself (its own hook would be skipped)', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { cli: goodCli, env: { CYTH_COMPACT_AT: '50' } })
  let compacts = 0
  on('session.usage', () => ({ value: { context: { tokens: 9_999_999 } } as never }))
  on('session.compact', () => {
    compacts++
    return { skip: 'engine native' }
  })
  on('turn.complete', () => ({ text: 'done' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(1000)
  expect(compacts).toBe(0)
})

test('turn.complete: an ingest failure fails open with a status line', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { cli: argv => (argv.includes('sync-claude') ? { exitCode: 1, stderr: 'boom' } : goodCli(argv)) })
  on('turn.complete', () => ({ text: 'done' }))
  const r = await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  expect(r).toEqual({ text: 'done' })
  await clock.advance(1000)
  expect(w.statuses.some(s => s?.startsWith('cyth: ingest failed, native behaviour'))).toBe(true)
})

test('session.compact folds, answers the kept tail and re-asks prompt.context for the view', async ($, on) => {
  const w = world(on, { cli: goodCli, env: { CYTH_TAIL: '40' } })
  const invalidated: string[] = []
  on('ui.invalidate', (_, e) => {
    invalidated.push((e as { event: string }).event)
    return { value: undefined }
  })
  on('session.compact', () => ({ skip: 'engine native' }))
  const r = await $.session.compact(compactInput as never)
  expect(r).toEqual({ messages: [MESSAGES[2], MESSAGES[3]] })
  expect(invalidated).toEqual(['prompt.context'])
  const subs = w.runs.map(x => sub(x.argv))
  expect(subs).toEqual(['sync-claude', 'seq', 'fold', 'view', 'status'])
  const argvOf = (s: string) => w.runs.find(x => sub(x.argv) === s)!.argv
  expect(argvOf('sync-claude')).toEqual(['node', BIN, '--cwd', CWD, '--session', `claude:${SID}`, '--json', 'sync-claude', `/cfg/projects/-w/${SID}.jsonl`])
  // fold at the seq the tail starts on
  expect(argvOf('fold')).toEqual(['node', BIN, '--cwd', CWD, '--session', `claude:${SID}`, '--json', 'fold', 'claude', SID, '7'])
  expect(argvOf('view')).toEqual(['node', BIN, '--cwd', CWD, '--session', `claude:${SID}`, '--json', 'view', 'claude', SID])
  // the seq lookup is given the tail's first message handles, not earlier ones
  const raw = argvOf('seq').at(-1)!
  const cands = JSON.parse(raw) as string[]
  expect(cands).toContain('h2')
  expect(cands).toContain('h3')
  expect(cands).not.toContain('h1')
  expect(argvOf('seq').at(-3)).toBe(CWD)
  expect(argvOf('seq').at(-2)).toBe(SID)
  expect(w.statuses.at(-1)).toBe('cyth 3 items · 1 pending · 2 pins')
})

test('session.compact keys a subagent store by session/agent', async ($, on) => {
  const w = world(on, { cli: goodCli, env: { CYTH_TAIL: '40' } })
  on('session.compact', () => ({ skip: 'engine native' }))
  await $.session.compact({ ...compactInput, agentId: 'ag1' } as never)
  const fold = w.runs.find(x => sub(x.argv) === 'fold')!
  expect(fold.argv.slice(-3)).toEqual(['claude', `${SID}/ag1`, '7'])
  const sync = w.runs.find(x => sub(x.argv) === 'sync-claude')!
  expect(sync.argv.at(-1)).toBe(`/cfg/projects/-w/${SID}/subagents/agent-ag1.jsonl`)
})

test('session.compact precompute is skipped without any CLI call', async ($, on) => {
  const w = world(on, { cli: goodCli })
  on('session.compact', () => ({ skip: 'engine native' }))
  const r = await $.session.compact({ ...compactInput, trigger: 'precompute' } as never)
  expect(r).toEqual({ skip: 'cyberthymesia compacts on demand' })
  expect(w.runs).toHaveLength(0)
})

for (const [label, bad] of [
  ['exit code 1', { exitCode: 1, stderr: 'boom' }],
  ['a thrown spawn', 'throw'],
] as const) {
  for (const stage of ['sync-claude', 'seq', 'fold', 'view']) {
    test(`session.compact fails open when ${stage} has ${label}`, async ($, on) => {
      const w = world(on, { cli: argv => (sub(argv) === stage ? bad : goodCli(argv)), env: { CYTH_TAIL: '40' } })
      on('session.compact', () => ({ skip: 'engine native' }))
      const r = await $.session.compact(compactInput as never)
      expect(r).toEqual({ skip: 'engine native' })
      const last = w.statuses.at(-1)
      expect(last?.startsWith('cyth: compaction failed, native behaviour')).toBe(true)
      if (label === 'exit code 1') expect(last).toContain('exited 1')
    })
  }
}

test('session.compact fails open when the CLI produces an empty view block', async ($, on) => {
  const w = world(on, { cli: argv => (sub(argv) === 'view' ? { exitCode: 0, stdout: '{"block":"  "}' } : goodCli(argv)), env: { CYTH_TAIL: '40' } })
  on('session.compact', () => ({ skip: 'engine native' }))
  const r = await $.session.compact(compactInput as never)
  expect(r).toEqual({ skip: 'engine native' })
  expect(w.statuses.at(-1)).toContain('empty view block')
})

test('session.compact fails open when the tail start is not in the store', async ($, on) => {
  const w = world(on, { cli: argv => (sub(argv) === 'seq' ? { exitCode: 0, stdout: '' } : goodCli(argv)), env: { CYTH_TAIL: '40' } })
  on('session.compact', () => ({ skip: 'engine native' }))
  const r = await $.session.compact(compactInput as never)
  expect(r).toEqual({ skip: 'engine native' })
  expect(w.statuses.at(-1)).toContain('tail start not in the store')
  expect(w.runs.some(x => sub(x.argv) === 'fold')).toBe(false)
})

test('session.compact fails open without a clean tail boundary', async ($, on) => {
  const w = world(on, { cli: goodCli })
  on('session.compact', () => ({ skip: 'engine native' }))
  const r = await $.session.compact({ trigger: 'manual', messages: [u('only', 'h0')] } as never)
  expect(r).toEqual({ skip: 'engine native' })
  expect(w.statuses.at(-1)).toContain('no clean tail boundary')
  expect(w.runs).toHaveLength(0)
})

test('session.compact survives a status failure after a good compaction', async ($, on) => {
  world(on, { cli: argv => (sub(argv) === 'status' ? { exitCode: 1 } : goodCli(argv)), env: { CYTH_TAIL: '40' } })
  on('session.compact', () => ({ skip: 'engine native' }))
  const r = await $.session.compact(compactInput as never)
  expect(r).toEqual({ messages: [MESSAGES[2], MESSAGES[3]] })
})

test('CYTH_DISABLE=1 passes every hook through and runs no CLI', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { cli: goodCli, env: { CYTH_DISABLE: '1', CYTH_TAIL: '40' } })
  on('session.start', () => ({ cwd: CWD }) as never)
  on('session.usage', () => ({ value: { context: { tokens: 9_999_999 } } as never }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.context', () => ({ blocks: [] }) as never)
  on('turn.complete', () => ({ text: 'native turn' }))
  on('session.compact', () => ({ skip: 'engine native' }))
  on('tool.call', () => ({ result: 'native tool' }))
  let registered = 0
  on('tool.register', () => {
    registered++
    return { value: { name: 'x' } as never }
  })

  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  expect(registered).toBe(0)
  const p = await $.prompt.compose({ model: 'm', promptModel: 'm', outputStyle: null, tools: [], traits: [], surfaces: ['terminal'], sections: [] } as never)
  expect(p.sections).toEqual([])
  expect((await $.prompt.context({ blocks: [] } as never)).blocks).toEqual([])
  expect(await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never)).toEqual({ text: 'native turn' })
  await clock.advance(5000)
  expect(await $.session.compact(compactInput as never)).toEqual({ skip: 'engine native' })
  for (const t of ['zoom', 'find', 'pin', 'unpin', 'pins']) {
    const r = await $.tool.call({ tool: `mcp__cyberthymesia__memory_${t}`, query: 'q', ref: '#1', reason: 'r', id: 1 } as never)
    expect(r).toMatchObject({ result: 'native tool' })
  }
  expect(w.runs).toHaveLength(0)
})

test('session.start registers the five memory tools and shows status', async ($, on) => {
  const w = world(on, { cli: goodCli })
  const names: string[] = []
  on('session.start', () => ({ cwd: CWD }) as never)
  on('tool.register', (_, e) => {
    names.push((e as { name: string }).name)
    return { value: { name: (e as { name: string }).name } as never }
  })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  expect(names).toEqual(['memory_zoom', 'memory_find', 'memory_pin', 'memory_unpin', 'memory_pins'])
  expect(w.statuses).toContain('cyth 3 items · 1 pending · 2 pins')
})

test('status line flags an algedonic alarm', async ($, on) => {
  const w = world(on, { cli: argv => (sub(argv) === 'status' ? { exitCode: 0, stdout: '{"items":1,"pending":0,"pins":1,"algedonic":true}' } : goodCli(argv)) })
  on('session.start', () => ({ cwd: CWD }) as never)
  on('tool.register', () => ({ value: { name: 'x' } as never }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  expect(w.statuses.at(-1)).toBe('cyth 1 items · 0 pending · 1 pins · ALGEDONIC: review with memory_pins')
})

const toolCli: Cli = argv => ({ exitCode: 0, stdout: JSON.stringify({ text: `ran ${argv.slice(7).join(' ')}` }) })

test('memory_find runs search <q> and returns the CLI text', async ($, on) => {
  const w = world(on, { cli: toolCli })
  on('tool.call', () => ({ result: 'native' }))
  const r = await $.tool.call({ tool: 'mcp__cyberthymesia__memory_find', query: 'needle' } as never)
  expect(r).toMatchObject({ result: 'ran search needle' })
  expect(w.runs).toHaveLength(1)
  expect(w.runs[0]!.argv).toEqual(['node', BIN, '--cwd', CWD, '--session', `claude:${SID}`, '--json', 'search', 'needle'])
})

test('memory_find with regex true adds --regex; false does not', async ($, on) => {
  const w = world(on, { cli: toolCli })
  on('tool.call', () => ({ result: 'native' }))
  await $.tool.call({ tool: 'mcp__cyberthymesia__memory_find', query: 'a.*b', regex: true } as never)
  expect(w.runs[0]!.argv.slice(7)).toEqual(['search', 'a.*b', '--regex'])
  await $.tool.call({ tool: 'mcp__cyberthymesia__memory_find', query: 'a.*b', regex: false } as never)
  expect(w.runs[1]!.argv.slice(7)).toEqual(['search', 'a.*b'])
})

test('the other memory tools map to their CLI commands', async ($, on) => {
  const w = world(on, { cli: toolCli })
  on('tool.call', () => ({ result: 'native' }))
  const cases: [string, Record<string, unknown>, string[]][] = [
    ['zoom', { ref: '#3-9' }, ['zoom', '#3-9']],
    ['pin', { ref: '#4', reason: 'why' }, ['pin', '#4', 'why']],
    ['unpin', { id: 12 }, ['unpin', '12']],
    ['pins', {}, ['pins']],
  ]
  for (const [t, input, argv] of cases) {
    const r = await $.tool.call({ tool: `mcp__cyberthymesia__memory_${t}`, ...input } as never)
    expect(r).toMatchObject({ result: `ran ${argv.join(' ')}` })
  }
  expect(w.runs.map(x => x.argv.slice(7))).toEqual(cases.map(c => c[2]))
})

test('a failing CLI denies the tool call with the reason', async ($, on) => {
  world(on, { cli: () => ({ exitCode: 1, stderr: 'no such ref' }) })
  on('tool.call', () => ({ result: 'native' }))
  const r = await $.tool.call({ tool: 'mcp__cyberthymesia__memory_find', query: 'x' } as never)
  expect(JSON.stringify(r)).toContain('memory_find: cyth search exited 1: no such ref')
  expect(JSON.stringify(r)).not.toContain('native')
})

test('a throwing spawn denies the tool call', async ($, on) => {
  world(on, { cli: () => 'throw' })
  on('tool.call', () => ({ result: 'native' }))
  const r = await $.tool.call({ tool: 'mcp__cyberthymesia__memory_zoom', ref: '#1' } as never)
  expect(JSON.stringify(r)).toContain('spawn failed')
  expect(JSON.stringify(r)).not.toContain('native')
})

test('a tool for another server is not served', async ($, on) => {
  const w = world(on, { cli: toolCli })
  on('tool.call', () => ({ result: 'native' }))
  const r = await $.tool.call({ tool: 'mcp__other__memory_find', query: 'x' } as never)
  expect(r).toMatchObject({ result: 'native' })
  expect(w.runs).toHaveLength(0)
})

test('prompt.context adds the view block after the engine blocks, from the first request', async ($, on) => {
  const w = world(on, { cli: goodCli })
  on('prompt.context', () => ({ blocks: [{ name: 'claudeMd', text: 'md' }] }) as never)
  const r = await $.prompt.context({ blocks: [] } as never)
  expect(r.blocks).toEqual([{ name: 'claudeMd', text: 'md' }, { name: 'cyberthymesia', text: '<memory>VIEWBLOCK</memory>' }])
  expect(w.runs.map(x => x.argv)).toEqual([['node', BIN, '--cwd', CWD, '--session', `claude:${SID}`, '--json', 'view', 'claude', SID]])
})

test('prompt.context fails open: no view, no block, a status line', async ($, on) => {
  const w = world(on, { cli: argv => (sub(argv) === 'view' ? { exitCode: 1, stderr: 'boom' } : goodCli(argv)) })
  on('prompt.context', () => ({ blocks: [{ name: 'claudeMd', text: 'md' }] }) as never)
  const r = await $.prompt.context({ blocks: [] } as never)
  expect(r.blocks).toEqual([{ name: 'claudeMd', text: 'md' }])
  expect(w.statuses.at(-1)).toContain('cyth: view failed')
})

test('prompt.context with an empty view block adds nothing', async ($, on) => {
  world(on, { cli: argv => (sub(argv) === 'view' ? { exitCode: 0, stdout: '{"block":" "}' } : goodCli(argv)) })
  on('prompt.context', () => ({ blocks: [] }) as never)
  const r = await $.prompt.context({ blocks: [] } as never)
  expect(r.blocks).toEqual([])
})

test('the mod no longer adds a system-prompt section of its own', async ($, on) => {
  world(on, { cli: goodCli })
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base prompt', scope: 'session' }] }) as never)
  const p = await $.prompt.compose({ model: 'm', promptModel: 'm', outputStyle: null, tools: [], traits: [], surfaces: ['terminal'], sections: [] } as never)
  expect(p.sections.map(x => x.id)).toEqual(['base'])
})

/** A CLI with `left` pending jobs; each put lands and removes one. */
function backlogCli(left: number, putOk = true): { cli: Cli; puts: () => number } {
  let puts = 0
  const cli: Cli = argv => {
    const s = sub(argv)
    if (s === 'pending') {
      const n = Math.min(Number(argv[9] ?? 4), left)
      return { exitCode: 0, stdout: JSON.stringify(Array.from({ length: n }, (_, k) => ({ ref: `#${k}`, prompt: `p${k}` }))) }
    }
    if (s === 'put') {
      puts++
      if (putOk) left--
      return { exitCode: 0, stdout: JSON.stringify({ ok: putOk }) }
    }
    return goodCli(argv)
  }
  return { cli, puts: () => puts }
}

test('summaries drain the backlog in rounds after a turn, on the cheap model', async ($, on) => {
  const clock = mock.clock(on)
  const b = backlogCli(10)
  world(on, { cli: b.cli })
  const models: string[] = []
  on('model.complete', (_, e) => {
    models.push((e as { model: string }).model)
    return { value: { isAnswered: true, text: 'a short summary' } } as never
  })
  on('session.usage', () => ({ value: { context: { tokens: 10 } } as never }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(5000)
  expect(b.puts()).toBe(10)
  expect(new Set(models)).toEqual(new Set(['haiku']))
})

test('summaries: an empty answer is not put, and asks at low effort with room to answer', async ($, on) => {
  const clock = mock.clock(on)
  const b = backlogCli(10)
  world(on, { cli: b.cli })
  const asks: { effort?: string; maxTokens?: number }[] = []
  on('model.complete', (_, e) => {
    asks.push(e as never)
    return { value: { isAnswered: true, text: '  ' } } as never
  })
  on('session.usage', () => ({ value: { context: { tokens: 10 } } as never }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(5000)
  expect(b.puts()).toBe(0)
  expect(asks.length).toBe(4)
  expect(asks[0]!.effort).toBe('low')
  expect(asks[0]!.maxTokens).toBe(1024)
})

test('summaries stop after a round that lands nothing', async ($, on) => {
  const clock = mock.clock(on)
  const b = backlogCli(10, false)
  world(on, { cli: b.cli })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'x' } }) as never)
  on('session.usage', () => ({ value: { context: { tokens: 10 } } as never }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(5000)
  expect(b.puts()).toBe(4)
})

test('summaries stop at the round cap', async ($, on) => {
  const clock = mock.clock(on)
  const b = backlogCli(1000)
  world(on, { cli: b.cli })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'x' } }) as never)
  on('session.usage', () => ({ value: { context: { tokens: 10 } } as never }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(5000)
  expect(b.puts()).toBe(32)
})

test('session.start drains the backlog in the background', async ($, on) => {
  const clock = mock.clock(on)
  const b = backlogCli(6)
  world(on, { cli: b.cli })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'x' } }) as never)
  on('session.start', () => ({ cwd: CWD }) as never)
  on('tool.register', () => ({ value: { name: 'x' } as never }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  expect(b.puts()).toBe(0)
  await clock.advance(5000)
  expect(b.puts()).toBe(6)
})
