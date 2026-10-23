// cyberthymesia for Claude Code (SPEC §9, claude-code bullet).
// The module has no Node: core is reached through `$.process.run` of its CLI
// (`node core/bin/cyth.ts ... --json`). Every hook fails open: any error ends
// in the engine's own behaviour plus a status line saying so.
import type {
  EngineInterface,
  Register,
  SessionCompactInput,
  SessionCompactResult,
  SessionMessage,
  ToolCallResult,
} from 'claude-code'
import { chooseTail } from './tail'

const PLUGIN = 'cyberthymesia'
const DEFAULT_TAIL = 160 * 1024 // bytes (SPEC §3)
const NODE_BYTES = 512 // SPEC §2
const SUMMARY_BATCH = 4
// A thinking model can spend a small cap on thought and answer nothing: low effort, room to reply.
const SUMMARY_ASK = { maxTokens: 1024, effort: 'low' as const, timeoutMs: 60_000 }
const SUMMARY_ROUNDS = 8 // batches per drain: at most 32 summaries per turn
const CONTEXT_BLOCK = 'cyberthymesia'

// The contract (SPEC §7) is not kept here: core renders it at the head of the
// view block, so the model is told about <memory> only when <memory> is there.

// Module state: lost on a hot reload, which only costs a re-derivation.
const transcripts = new Map<string, string>() // session key -> transcript path
let summarizing = false

// ---------- env and the CLI ----------

async function disabled($: EngineInterface): Promise<boolean> {
  return (await $.env.get('CYTH_DISABLE')) === '1'
}

function numberEnv(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

function repoRoot(pluginRoot: string): string {
  return pluginRoot.replace(/\/+$/, '').replace(/\/[^/]+$/, '')
}

async function cliPaths($: EngineInterface): Promise<{ node: string; bin: string; core: string }> {
  const root = repoRoot($.plugin.root)
  const node = (await $.env.get('CYTH_NODE')) || 'node'
  const bin = (await $.env.get('CYTH_BIN')) || `${root}/core/bin/cyth.ts`
  const core = (await $.env.get('CYTH_CORE')) || `${root}/core/src/index.ts`
  return { node, bin, core }
}

/** Runs `node cyth.ts <args> --cwd <cwd> --json`; throws on a nonzero exit. */
async function cyth($: EngineInterface, cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
  const { node, bin } = await cliPaths($)
  // The session stays in the store it first used, whatever cwd has become.
  const session = await $.session.id()
  const r = await $.process.run([node, bin, '--cwd', cwd, '--session', `claude:${session}`, '--json', ...args], { cwd, timeoutMs })
  if (r.exitCode !== 0) {
    throw new Error(`cyth ${args[0] ?? ''} exited ${r.exitCode}: ${r.stderr.trim().split('\n')[0] ?? ''}`)
  }
  return r.stdout
}

async function cythJson($: EngineInterface, cwd: string, args: readonly string[]): Promise<unknown> {
  const out = await cyth($, cwd, args)
  return out.trim() === '' ? {} : JSON.parse(out)
}

/** The CLI's --json output for text commands: a bare string, or an object holding one. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    for (const k of ['text', 'result', 'output', 'block']) {
      const x = (v as Record<string, unknown>)[k]
      if (typeof x === 'string') return x
    }
  }
  return JSON.stringify(v)
}

// The CLI has no `seq-of`; Store.seqOf (SPEC §8) is reached by a one-shot
// node script that imports core. It prints the smallest seq found among the
// candidate uuids, or nothing.
function seqScript(coreUrl: string): string {
  return [
    `import { openStore } from ${JSON.stringify(coreUrl)};`,
    'const [cwd, session, raw] = process.argv.slice(1);',
    'const store = openStore(cwd, { session: { harness: "claude", session: session.split("/")[0] } });',
    'let best;',
    'try { for (const u of JSON.parse(raw)) { const s = store.seqOf("claude", session, u);',
    '  if (typeof s === "number" && (best === undefined || s < best)) best = s; } }',
    'finally { store.close(); }',
    'if (best !== undefined) process.stdout.write(String(best));',
  ].join('\n')
}

/** Core's item uuids for one message (SPEC §1): message uuid + block index; tools by tool_use id. */
export function uuidCandidates(m: SessionMessage): string[] {
  const out: string[] = []
  if (m.handle !== undefined) {
    out.push(m.handle)
    for (let k = 0; k < 8; k++) out.push(`${m.handle}:${k}`)
  }
  for (const u of m.toolUses) out.push(u.tool_use_id)
  for (const r of m.toolResults ?? []) out.push(r.tool_use_id)
  return out
}

async function seqOf($: EngineInterface, cwd: string, session: string, uuids: readonly string[]): Promise<number | undefined> {
  const { node, core } = await cliPaths($)
  const url = core.startsWith('file:') ? core : `file://${core}`
  const r = await $.process.run(
    [node, '--input-type=module', '-e', seqScript(url), cwd, session, JSON.stringify(uuids)],
    { cwd, timeoutMs: 30_000 },
  )
  if (r.exitCode !== 0) throw new Error(`seqOf exited ${r.exitCode}: ${r.stderr.trim().split('\n')[0] ?? ''}`)
  const n = Number(r.stdout.trim())
  return r.stdout.trim() === '' || !Number.isInteger(n) ? undefined : n
}

// ---------- transcripts ----------

function key(session: string, agentId: string | undefined): string {
  return agentId === undefined ? session : `${session}/${agentId}`
}

/** ~/.claude/projects/<cwd, non-alphanumerics as '-'>/<session>.jsonl, or its subagents/ file. */
async function transcriptPath($: EngineInterface, session: string, agentId: string | undefined, cwd: string): Promise<string | undefined> {
  const known = transcripts.get(key(session, agentId))
  if (known !== undefined) return known
  const home = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  const dir = `${home}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
  const path = agentId === undefined ? `${dir}/${session}.jsonl` : `${dir}/${session}/subagents/agent-${agentId}.jsonl`
  return (await $.fs.exists(path)) ? path : undefined
}

async function sync($: EngineInterface, session: string, agentId: string | undefined, cwd: string): Promise<void> {
  const path = await transcriptPath($, session, agentId, cwd)
  if (path === undefined) throw new Error(`no transcript found for ${key(session, agentId)}`)
  await cyth($, cwd, ['sync-claude', path])
}

// ---------- status line ----------

type Status = { items?: number; pending?: number; pins?: number; algedonic?: boolean }

async function showStatus($: EngineInterface, cwd: string): Promise<void> {
  const s = (await cythJson($, cwd, ['status'])) as Status
  const parts = [`cyth ${s.items ?? 0} items`, `${s.pending ?? 0} pending`, `${s.pins ?? 0} pins`]
  if (s.algedonic === true) parts.push('ALGEDONIC: review with memory_pins')
  $.ui.status(parts.join(' · '))
}

function failNote($: EngineInterface, where: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  $.ui.status(`cyth: ${where} failed, native behaviour (${msg.slice(0, 120)})`)
}

// ---------- compaction ----------

/**
 * Our answer to session.compact: the raw tail kept by handle. Folds core's
 * tailStart to the tail's first item first, so the view covers exactly what
 * the tail does not. The view itself reaches the model as the prompt.context
 * block, which the engine sends again after a compaction (SPEC §9).
 */
async function compactAnswer($: EngineInterface, e: SessionCompactInput): Promise<SessionCompactResult> {
  const id = await $.session.id()
  const cwd = await $.session.cwd()
  const session = key(id, e.agentId)
  const tail = numberEnv(await $.env.get('CYTH_TAIL'), DEFAULT_TAIL)

  const cut = chooseTail(e.messages, tail / 2)
  if (cut === undefined) throw new Error('no clean tail boundary')

  await sync($, id, e.agentId, cwd)
  const first = e.messages.slice(cut.index, cut.index + 3).flatMap(uuidCandidates)
  const seq = await seqOf($, cwd, session, first)
  if (seq === undefined) throw new Error(`tail start not in the store (${e.messages[cut.index]?.handle ?? '?'})`)

  await cyth($, cwd, ['fold', 'claude', session, String(seq)])
  // Checked before answering: a compaction without a view would drop history.
  await viewBlock($, cwd, session)
  $.ui.invalidate('prompt.context')
  return { messages: e.messages.slice(cut.index) }
}

/** The rendered view (contract, <memory>, <pinned>) for one session key. */
async function viewBlock($: EngineInterface, cwd: string, session: string): Promise<string> {
  const block = textOf(await cythJson($, cwd, ['view', 'claude', session]))
  if (block.trim() === '') throw new Error('empty view block')
  return block
}

// ---------- after a turn: ingest, trigger, summaries ----------

async function summarizeOne($: EngineInterface, cwd: string, model: string, ref: string, prompt: string): Promise<boolean> {
  const first = await $.model.complete({ model, prompt, ...SUMMARY_ASK })
  if (!first.isAnswered) return false
  let text = first.text.trim().replace(/\s*\n\s*/g, ' ')
  if (text === '') return false // an empty answer is no summary; the clip stays
  const n = new TextEncoder().encode(text).length
  if (n > NODE_BYTES) {
    const retry = await $.model.complete({
      model,
      prompt: `${prompt}\n\n${text}\n\nToo long: ${n} bytes, limit ${NODE_BYTES}. Cut the least valuable items.`,
      ...SUMMARY_ASK,
    })
    if (!retry.isAnswered) return false
    text = retry.text.trim().replace(/\s*\n\s*/g, ' ')
    if (text === '') return false
    if (new TextEncoder().encode(text).length > NODE_BYTES) return false // core keeps clip
  }
  const put = (await cythJson($, cwd, ['put', ref, text])) as { ok?: unknown }
  return put.ok === true
}

async function summarize($: EngineInterface, cwd: string): Promise<void> {
  if (summarizing) return
  summarizing = true
  try {
    const model = (await $.env.get('CYTH_SUMMARY_MODEL')) || 'haiku'
    // Drain in rounds: one batch per turn falls behind, since every turn adds
    // several clip nodes. Stop when nothing is pending or a round lands nothing.
    for (let round = 0; round < SUMMARY_ROUNDS; round++) {
      const raw = await cythJson($, cwd, ['pending', '--limit', String(SUMMARY_BATCH)])
      const jobs = ((Array.isArray(raw) ? raw : []) as { ref?: unknown; prompt?: unknown }[])
        .filter(j => typeof j.ref === 'string' && typeof j.prompt === 'string')
      if (jobs.length === 0) return
      // At most SUMMARY_BATCH in flight; one failure does not stop the others.
      const done = await Promise.allSettled(jobs.map(j => summarizeOne($, cwd, model, j.ref as string, j.prompt as string)))
      if (!done.some(d => d.status === 'fulfilled' && d.value)) return
    }
  } finally {
    summarizing = false
  }
}

async function afterTurn($: EngineInterface, agentId: string | undefined, cwd: string): Promise<void> {
  const id = await $.session.id()
  try {
    await sync($, id, agentId, cwd)
  } catch (err) {
    failNote($, 'ingest', err)
    return
  }
  try {
    await showStatus($, cwd)
  } catch (err) {
    failNote($, 'status', err)
  }
  // No compaction trigger of our own: a `$.session.compact()` this module
  // raises skips this module's own session.compact hook (re-entry), so the
  // engine's summarizer would run instead. The engine's own triggers (auto
  // near the window limit, /compact) reach the hook below.
  try {
    await summarize($, cwd)
    await showStatus($, cwd)
  } catch (err) {
    failNote($, 'summaries', err)
  }
}

// ---------- tools ----------

const TOOLS = [
  {
    name: 'memory_zoom',
    description: 'Open a memory ref: #a-b gives its two halves, #n the item whole (paged; #n@offset continues).',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: '#a-b, #n or #n@offset' } }, required: ['ref'] },
    argv: (i: Record<string, unknown>) => ['zoom', String(i.ref)],
  },
  {
    name: 'memory_find',
    description: "Full-text search over every item of the project's history, verbatim, newest first.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, regex: { type: 'boolean', description: 'treat query as a regex' } },
      required: ['query'],
    },
    argv: (i: Record<string, unknown>) => ['search', String(i.query), ...(i.regex === true ? ['--regex'] : [])],
  },
  {
    name: 'memory_pin',
    description: 'Keep an item at full resolution in <pinned> until unpinned. Returns the pin id.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: '#n' }, reason: { type: 'string' } },
      required: ['ref', 'reason'],
    },
    argv: (i: Record<string, unknown>) => ['pin', String(i.ref), String(i.reason)],
  },
  {
    name: 'memory_unpin',
    description: 'Resolve a pin by its id.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    argv: (i: Record<string, unknown>) => ['unpin', String(i.id)],
  },
  {
    name: 'memory_pins',
    description: 'List the pins, resolved or not, with their ids.',
    inputSchema: { type: 'object', properties: {} },
    argv: (_: Record<string, unknown>) => ['pins'],
  },
] as const

async function registerTools($: EngineInterface): Promise<void> {
  for (const t of TOOLS) {
    await $.tool.register({ name: t.name, description: t.description, inputSchema: t.inputSchema, isDeferred: false })
  }
}

async function runTool($: EngineInterface, name: string, input: Record<string, unknown>): Promise<string> {
  const t = TOOLS.find(x => x.name === name)
  if (t === undefined) throw new Error(`unknown tool ${name}`)
  const cwd = await $.session.cwd()
  return textOf(await cythJson($, cwd, t.argv(input)))
}

async function serveTool($: EngineInterface, name: string, e: object): Promise<ToolCallResult> {
  try {
    return { result: await runTool($, name, e as unknown as Record<string, unknown>) }
  } catch (err) {
    return { deny: `${name}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (await disabled($)) return next(e)
    try {
      await registerTools($)
    } catch (err) {
      failNote($, 'tool registration', err)
    }
    const started = await next(e)
    const cwd = await $.session.cwd()
    try {
      await showStatus($, cwd)
    } catch (err) {
      failNote($, 'status', err)
    }
    // Work down the backlog other sessions left, off the start's path.
    $.clock.after(1000, () => {
      summarize($, cwd).catch(err => failNote($, 'summaries', err))
    })
    return started
  })

  // The view block rides on the conversation's first user message, beside
  // CLAUDE.md, from the first request on: a new session sees the project's
  // tree at once. The engine asks again after a compaction. If the view
  // cannot be built, nothing is added, so nothing claims a <memory> that is
  // not there.
  on('prompt.context', async ($, e, next) => {
    const ctx = await next(e)
    if (await disabled($)) return ctx
    try {
      const cwd = await $.session.cwd()
      const block = await viewBlock($, cwd, await $.session.id())
      return { ...ctx, blocks: [...ctx.blocks.filter(b => b.name !== CONTEXT_BLOCK), { name: CONTEXT_BLOCK, text: block }] }
    } catch (err) {
      failNote($, 'view', err)
      return ctx
    }
  }).catch(($, e, next) => next(e))

  // Transcript paths, as the classic Stop events carry them (they fire before turn.complete).
  on('classic.Stop', ($, e, next) => {
    transcripts.set(e.session_id, e.transcript_path)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.SubagentStop', ($, e, next) => {
    transcripts.set(key(e.session_id, e.agent_id), e.agent_transcript_path)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (await disabled($)) return done
    const cwd = await $.session.cwd()
    const agentId = e.agentId
    // Off the turn's path: summaries must never block one.
    $.clock.after(250, () => {
      afterTurn($, agentId, cwd).catch(err => failNote($, 'after-turn', err))
    })
    return done
  })

  on('session.compact', async ($, e, next) => {
    if (await disabled($)) return next(e)
    // Our compaction is a few local CLI calls, no model: nothing to precompute,
    // and a precomputed answer would fold the store for a compaction that may
    // never come. Skip it; the real trigger asks again.
    if (e.trigger === 'precompute') return { skip: `${PLUGIN} compacts on demand` }
    try {
      const answer = await compactAnswer($, e)
      try {
        await showStatus($, await $.session.cwd())
      } catch {
        // the compaction stands without a status line
      }
      return answer
    } catch (err) {
      failNote($, 'compaction', err)
      return next(e)
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__cyberthymesia__memory_zoom' }, async ($, e, next) => ((await disabled($)) ? next(e) : serveTool($, 'memory_zoom', e)))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'memory_zoom failed' }))
  on('tool.call', { tool: 'mcp__cyberthymesia__memory_find' }, async ($, e, next) => ((await disabled($)) ? next(e) : serveTool($, 'memory_find', e)))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'memory_find failed' }))
  on('tool.call', { tool: 'mcp__cyberthymesia__memory_pin' }, async ($, e, next) => ((await disabled($)) ? next(e) : serveTool($, 'memory_pin', e)))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'memory_pin failed' }))
  on('tool.call', { tool: 'mcp__cyberthymesia__memory_unpin' }, async ($, e, next) => ((await disabled($)) ? next(e) : serveTool($, 'memory_unpin', e)))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'memory_unpin failed' }))
  on('tool.call', { tool: 'mcp__cyberthymesia__memory_pins' }, async ($, e, next) => ((await disabled($)) ? next(e) : serveTool($, 'memory_pins', e)))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'memory_pins failed' }))
}
