# cyberthymesia — v0 spec

Every chat goes forever. The context window is a cache over a lossless, auditable
log; the model sees a view whose detail decays with age, and drills down on demand.

This file is the contract between `core/`, `claude-code/` and `pi/`. Change it
first, then the code.

## 1. Model

- **Project.** One store per project. Project root = parent of
  `git rev-parse --path-format=absolute --git-common-dir` (so worktrees share one
  store), else the cwd. Store path: `$CYTH_HOME/<slug>/store.db`, `CYTH_HOME`
  default `~/.cyberthymesia`, `slug` = root path with `/` → `-`, leading `-`
  dropped. `~` (home) is the utility store. Every session of every harness in a
  project appends to the same store.
- **Item.** The unit of the log, append-only, never edited. `seq` is dense,
  0-based, per project. Kinds:
  - `user`: a user's words (text only; images as `[image]` markers).
  - `assistant`: the model's visible text.
  - `tool`: ONE tool call paired with its result (`name`, `input` JSON,
    `output` text, `isError`). Created when the result arrives, so a call and its
    result can never be split. A call with no result is not an item yet.
  - Thinking, hook attachments, system noise: NOT items. Thinking is kept in the
    side table `raw` (not in the tree, not in views).
- **Identity.** `(harness, session, uuid)` is unique; re-ingesting is a no-op.
  `harness` ∈ `claude` | `pi`. `uuid` = the source record's id (Claude message
  uuid + content-block index; Pi entry id + block index; tools keyed by
  tool_use id).
- **Hash.** `h(item) = sha256(canonical JSON of {seq,harness,session,agent,uuid,kind,ts,text,meta})`.

## 2. Tree

Binary, aligned power-of-two over `seq`, as uniichat and OptMem. Node `(l,i)`
covers items `[i·2^l, (i+1)·2^l)`; ref `#lo-hi` (inclusive). A leaf is `(0,i)`,
ref `#i`. Every node text is ≤ `NODE = 512` bytes UTF-8, one line (no `\n`).

Node `source` ∈ `verbatim` | `det` | `model` | `clip`:

- **Leaf, user/assistant:** the text if ≤ NODE (`verbatim`), else `clip` and
  queued for a model summary.
- **Leaf, tool:** deterministic digest (`det`), never a model:
  `t:<Tool> <key arg> → <status>; <n> lines; <first error line | last line>`.
  Key arg per tool: Bash `command`; Read/Edit/Write/NotebookEdit `file_path`
  (+ range / `+a -r` lines); Grep/Glob `pattern` (+ match count); Agent/Task
  `description`; WebFetch `url`; WebSearch `query`; default: name + clipped JSON
  input. Status: `ok` | `ERR` (isError, nonzero `exit code`, or a
  `/error|fail|exception|traceback/i` first line).
- **Leaf prefix:** `u:` `a:` `t:`, then `@<h><sess4>` (`c`/`p` + first 4 of the
  session id) only when the session differs from the previous leaf's.
- **Merge `(l≥1)`:** if every item under it is a `tool` item, a `det` aggregate
  composed from the children's `meta` (`{tools:{Bash:3,…}, files:[top5], fails, oks}`),
  rendered ≤ NODE. Else `clip` = first ⌊(NODE−5)/2⌋ bytes of each child joined
  by ` … `, queued for a model summary.
- A node is built as soon as both children exist. Nodes never wait on a model:
  `clip` is always there, and a `model` text replaces it later (`put`).
- `forget(ref)` drops a model summary back to `clip` and re-queues it (OptMem).

**Model summary prompts** (built by core, run by the adapters on whatever model
they have):

- leaf: `Compress this message into one line of at most 512 bytes. Keep what has lasting effect (decisions, facts, names, numbers, paths); drop the rest. Invent nothing.` + `<input>…</input>`
- merge: `Merge these two adjacent lines into one line of at most 512 bytes. Keep what has lasting effect; drop what does not. Invent nothing.` + both child lines.

A reply that is longer than NODE gets one retry with `Too long: N bytes, limit 512. Cut the least valuable items.`, then falls back to `clip`.

## 3. View

The view is uniichat's, persisted per `(project, harness, session)` so its bytes
stay stable between batches (prompt cache).

- `parts`: an ordered list of `{l, i, text}` covering `[0, viewEnd)` exactly,
  with no gaps or overlaps. `text` is a SNAPSHOT taken when the part entered the
  view, so the rendered prefix does not change when a summary lands; snapshots
  refresh only at the next batch.
- `reach(end)`: append leaves `(0,i)` for `i ∈ [viewEnd, end)`.
- `fit()`: if `bytes(view) > HIGH`, merge adjacent sibling pairs (`a.l = b.l`,
  `a.i` even, `b.i = a.i+1`) by highest due score `d = (viewEnd+1)/2^l − i`
  (oldest relative to its size first), ties to the older, until
  `bytes ≤ HIGH/2`. One batch per crossing. Merged parts snapshot their current
  text.
- **Convergence:** all-merged is the popcount(viewEnd) roots, ≤ 31 × NODE
  = 15.9 KB < HIGH/2 for any HIGH ≥ 32 KB, so `fit` always terminates under budget.
- **Rendering** (one text block, the order IS the cache layout):
  1. the contract (§7), stable;
  2. `<memory>` then one line per part, `#ref|text`, then `</memory>`; stable until the next batch;
  3. `<pinned>` block (§5), changes only when pins change;
  4. nothing else; the harness appends the raw tail after this block.
- **Tail.** The view covers the project log up to `tailStart` (a `seq`). After
  that, the current session's own messages go raw, as the harness has them.
  Items from other sessions after `tailStart` join the view at the next fold.
- **Fold.** When the raw tail exceeds `TAIL` bytes, move `tailStart` forward to
  a user-message boundary that leaves about `TAIL/2` raw (never between a tool call
  and its result), then `reach(tailStart)` and `fit()`.
- Defaults: `HIGH = 96 KB`, `TAIL = 160 KB` (≈ 27k + 45k tokens). Per-harness
  overrides in env `CYTH_HIGH`, `CYTH_TAIL`.

## 4. Search and zoom

- `zoom('#lo-hi')` → the two child lines (`#ref|text`, current text, not snapshot).
- `zoom('#n')` → item n whole: kind, session, ts, text (tool: input + output),
  paged at `PAGE = 20000` bytes; `zoom('#n@offset')` continues; every page ends
  with a footer saying whether more remains and how to get it (OptMem).
- `search(q, {regex?, limit=20})` → `#n|leaf text` + a snippet per hit, newest first.
  Default FTS5 (bm25) over item text; `regex` scans, capped by PAGE.
- `roots()` → the tree's roots, for orientation.

## 5. Algedonic channel (pins)

A bypass that never decays. A pin shows its item verbatim (clipped to 1024 B) in
`<pinned>` until it is resolved, whatever its age.

- Auto-pin at ingest (heuristics, can only ADD):
  - `directive`: a `user` item ≤ 1000 chars matching
    `/\b(never|always|don't|do not|must|stop|remember|from now on)\b/i`.
  - `failure`: a `tool` item with status `ERR`. Auto-resolves when a later
    tool item with the same normalized key arg (same Bash command, same file
    for Edit/Write) has status `ok`.
- Manual: `pin(ref, reason)` / `unpin(pinId)` via tools.
- Quota `PIN_BYTES = 8192`. Over quota → oldest pins render as refs only, and
  the block starts with `ALGEDONIC: <n> pins over quota; review with memory_pins`.
  Status reports `algedonic: true` so the adapters notify the human.

## 6. Audit

- Items are hashed (§1). Merkle Tree Hash over items `[0,n)` per RFC 6962
  (leaf `0x00‖h`, node `0x01‖l‖r`, largest power-of-two split).
- Every view sent is logged in `views_log`: `ts, harness, session, n (items
  covered), root (MTH at n), viewEnd, tailStart, sha256(rendered block), bytes`.
  "What did the model see at turn N" is replayable from that row.
- `verify()`: recompute every item hash from stored fields; recompute the MTH for
  every `n` in `views_log` and compare (that is the append-only consistency
  check); check every node text ≤ NODE and every persisted view covers
  `[0,viewEnd)` exactly. Non-zero exit on any failure.

## 7. Contract (the prompt section, both harnesses)

```
## Memory: cyberthymesia
This conversation never ends; nothing is ever lost. <memory> lists the project's
whole history as a binary tree of one-line summaries, oldest first: `#a-b|...`
covers items a..b, `#n|...` is one item. Detail fades with age. The raw messages
after it are the recent present, verbatim.
- The latest word on a thing is the truth. Before you act, guess or ask about
  anything past, find it in <memory> and zoom until you have it whole.
- memory_zoom(ref): open #a-b into its halves; #n gives the item whole (paged).
- memory_find(query): full-text search over every item, verbatim.
- memory_pin(ref, reason) / memory_unpin(id): keep something at full resolution.
- <pinned> items are alarms and standing orders: obey them until resolved.
- Summaries keep little of tool output: say in your reply what you learned that matters later.
```

## 8. Core API (`core/src/index.ts`, Node ≥ 22, `node:sqlite`, zero deps)

```ts
openStore(cwd: string, opts?: { home?: string }): Store
type NormItem = { harness: 'claude'|'pi'; session: string; agent?: string;
  uuid: string; kind: 'user'|'assistant'|'tool'; ts: string; text: string;
  tool?: { name: string; input: unknown; output: string; isError: boolean };
  thinking?: string }
interface Store {
  root: string; dbPath: string
  ingest(items: NormItem[]): { added: number; lastSeq: number }  // idempotent
  syncClaude(transcriptPath: string): { added: number }   // byte cursor per file
  syncPi(sessionPath: string): { added: number }
  backfill(opts: { claudeDir?: string; piDir?: string }): { added: number } // this project's sessions, merged by ts
  seqOf(harness, session, uuid): number | undefined
  view(harness, session, opts?: { high?: number; tail?: number; tailStart?: number }): {
    block: string; viewEnd: number; tailStart: number; bytes: number; root: string; algedonic: boolean }
  fold(harness, session, tailStart: number): void   // advance tailStart, reach, fit
  zoom(ref: string): string
  search(q: string, opts?: { regex?: boolean; limit?: number }): string
  pin(ref: string, reason: string): number; unpin(id: number): void; pins(): string
  pending(limit: number): { ref: string; prompt: string }[]
  put(ref: string, text: string): boolean            // model summary, validated ≤ NODE
  forget(ref: string): void
  status(): { items: number; nodes: number; pending: number; pins: number; algedonic: boolean; root: string }
  verify(): { ok: boolean; problems: string[] }
  close(): void
}
```

Writes are short transactions (`BEGIN IMMEDIATE`, WAL, `busy_timeout = 5000`),
never held across a model call (lossless-claw #1152). Many sessions write at
once; SQLite serializes them.

CLI `core/bin/cyth.ts` (run with `node`): `status | sync-claude <file> |
sync-pi <file> | backfill [--claude DIR] [--pi DIR] | view <harness> <session>
| fold <harness> <session> <seq> | zoom <ref> | search <q> [--regex] | pin <ref>
<reason> | unpin <id> | pins | pending [--limit N] | put <ref> <text> | forget
<ref> | verify`. Global `--cwd DIR` (default cwd) and `--json`. Exit ≠ 0 on error,
message on stderr.

## 9. Adapters

Both: **fail open.** Any error in cyberthymesia → the harness's native
behaviour, plus a status line saying so. `CYTH_DISABLE=1` → pass-through.
Summaries: after each turn, take `pending(4)` and run them on the cheapest model
available, in the background, never blocking a turn. Tools: `memory_zoom`,
`memory_find`, `memory_pin`, `memory_unpin`, `memory_pins` (thin calls into
core). Contract (§7) goes into the system prompt.

- **claude-code/** (a Claude Code mod; no Node in the module, so core is reached
  through `$.process.run` of the CLI). Ingest: `sync-claude` on the session's
  transcript at `turn.complete`. Compaction: answer `session.compact` with
  `{ messages: [ one user message = view block, …tail messages kept by handle ] }`;
  trigger it with `$.session.compact()` when the context passes `CYTH_COMPACT_AT`
  (default 100k tokens). Subagent compactions (`agentId`) get the same treatment
  under `session = <session>/<agentId>`.
- **pi/** (a Pi extension; imports core directly). Ingest at `message_end`
  (or `syncPi` on the session file). `context` hook: replace everything before
  the tail with one user message carrying the view block; fold when the tail
  passes TAIL. `session_before_compact`: return our compaction (or cancel) so Pi's
  summarizer never runs.

## 10. Tests (core, `node --test`)

Seeded PRNG property tests over random item streams (mixed kinds, sizes,
sessions, failures):
1. View covers `[0, viewEnd)` exactly, in order, after any sequence of reach/fit/fold.
2. After `fit`, `bytes ≤ HIGH` (convergence bound holds).
3. Every node text ≤ NODE bytes, one line.
4. Re-ingest is a no-op; item count and root unchanged.
5. Merkle: MTH matches a reference implementation; appending never changes the
   MTH of any earlier prefix; `verify` passes, and fails on a tampered item.
6. `zoom('#lo-hi')` returns exactly its two children; `#n@offset` pages reassemble to the item.
7. Pins: the quota is respected; a failure auto-resolves on a later success; heuristics never remove a pin.
8. Determinism: the same input gives byte-identical view blocks.

Each guard is mutation-tested once (break it, see a test fail, restore), and the
result is recorded in `core/test/MUTATIONS.md`.
