# cyberthymesia — v0 spec

Every chat goes forever. The context window is a cache over a lossless, auditable
log. The model sees a small fixed header (pins and the newest items) and reaches
everything else by search and zoom. No model ever summarizes the log.

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

- **Leaf, user/assistant:** the text if ≤ NODE (`verbatim`), else `clip`.
- **Leaf, tool:** deterministic digest (`det`), never a model:
  `t:<Tool> <key arg> → <status>; <n> lines; <first error line | last line>`.
  Key arg per tool: Bash `command`; Read/Edit/Write/NotebookEdit `file_path`
  (+ range / `+a -r` lines); Grep/Glob `pattern` (+ match count); Agent/Task
  `description`; WebFetch `url`; WebSearch `query`; default: name + clipped JSON
  input. Status: `ok` | `ERR` (the harness's `isError`, or a nonzero
  `exit code` in the output). Output text alone never makes a call ERR: a
  successful `grep failed` prints "failed".
- **Leaf prefix:** `u:` `a:` `t:`, then `@<h><sess4>` (`c`/`p` + the last 4
  alphanumerics of the session id; Pi ids are UUIDv7, whose first characters
  are a timestamp shared by every session of the day) only when the session
  differs from the previous leaf's.
- **Merge `(l≥1)`:** if every item under it is a `tool` item, a `det` aggregate
  composed from the children's `meta` (`{tools:{Bash:3,…}, files:[top5], fails, oks}`),
  rendered ≤ NODE. Else `clip` = first ⌊(NODE−5)/2⌋ bytes of each child joined
  by ` … `.
- A node is built as soon as both children exist. The tree serves range zoom
  (§4), the Merkle audit (§6) and `verify`. It is not what the model sees (§3).

**Legacy: model summaries (off).** Earlier versions had the adapters replace
`clip` texts with one-line model summaries (`source = model`). The adapters no
longer ask: a summarized tree in context made models answer "not in the
history" without searching, and summaries were the dominant cost. Core keeps
`pending`, `put` and `forget` (and their prompts and checks in `leaves.ts`) so old stores still open and
their `model` nodes still verify; nothing in the view depends on them.

## 3. View

The view is a small fixed header, the same in both harnesses. It is persisted
per `(project, harness, session)` as one number, `tailStart` (a `seq`), so its
bytes stay stable between folds (prompt cache).

- **Rendering** (one text block, the order IS the cache layout):
  1. the contract (§7), stable. It travels only inside this block, so a model
     is told about `<recent>` exactly when `<recent>` is in its context;
  2. the `<pinned>` block (§5), which changes only when pins change;
  3. `<recent>`, one line per item, then `</recent>`. The lines are the newest
     items before `tailStart`, from any session, newest last, leaving out
     cyth's own tool calls (§4). A line is
     `#n|` + the item's leaf text (§2), rebuilt from the item itself (a legacy
     model summary is not used). The tag `@c1234` / `@p1234` appears where the
     session changes from the line above it, and always on the oldest line shown.
     Lines are added newest first while their bytes (each line plus its `\n`)
     stay ≤ `HEADER`, whole lines only; the first line that does not fit stops
     the walk, so the slice is contiguous and ends at `tailStart − 1`;
  4. nothing else: no tree lines. The harness appends the raw tail after this block.
- **Deterministic.** The block is a function of the items before `tailStart`,
  the open pins and `HEADER`. Items are append-only, so while only the tail
  grows (and pins do not change) the block is byte-identical.
- **Tail.** After `tailStart`, the current session's own messages go raw, as the
  harness has them. Items from other sessions after `tailStart` reach
  `<recent>` at the next fold, and `memory_find` at once.
- **Fold.** When the raw tail exceeds `TAIL` bytes, move `tailStart` forward to
  a user-message boundary that leaves about `TAIL/2` raw (never between a tool
  call and its result). Folds never move `tailStart` back.
- `viewEnd` (in results and `views_log`) equals `tailStart`: the log the view
  stands for is `[0, tailStart)`, all of it reachable by search.
- Defaults: `HEADER = 8192` bytes of `<recent>` lines (≈ 2k tokens),
  `TAIL = 160 KB` (≈ 45k tokens). Overrides in env `CYTH_HEADER`, `CYTH_TAIL`;
  `view(…, {header})` overrides per call.
- Why (bench, branch `bench/memory`, LongMemEval pilot + held-out): with a
  compressed tree in context, the model answered "not in the history" without
  searching 20-28% of the time, and was 10-18 points less accurate than plain
  find/zoom. A header of pins + recent items matched or beat the tree at the
  same budget, and context stayed flat (~4.5k tokens) over a 2.26M-token replay.

## 4. Search and zoom

- `zoom('#lo-hi')` → the two child lines (`#ref|text`, current text). A range
  must be aligned (hi−lo+1 a power of two, lo a multiple of it); otherwise core
  throws a message saying so, and both adapters return that message to the model.
- `zoom('#n')` → item n whole: kind, session, ts, text (tool: input + output),
  paged at `PAGE = 20000` bytes; `zoom('#n@offset')` continues; every page ends
  with a footer saying whether more remains and how to get it (OptMem).
- `search(q, {regex?, limit=20})` → `#n|leaf text` + a snippet per hit.
  Default FTS5: bm25 picks the best `limit` hits, which are then listed newest
  first (by `seq`, descending); `regex` scans newest first, capped by PAGE.
- **Own calls are not hits.** A tool item of cyth's own tools (`memory_find`,
  `memory_zoom`, `memory_pin`, `memory_unpin`, `memory_pins`, in both
  spellings: Pi's bare name and Claude Code's `mcp__cyberthymesia__<name>`)
  stays in the log (hash, Merkle tree, `verify`, `zoom('#n')` unchanged) but
  is left out of `search` (FTS and regex, before `limit` applies) and of
  `<recent>`. Otherwise every query's output, which quotes earlier hits, comes
  back as a hit of the next query and crowds out the facts. The filter is at
  query time (a join on `items.meta.name`), so stores ingested before it need
  no migration.
- `roots()` → the tree's roots, for orientation (not shown to the model).

## 5. Algedonic channel (pins)

A bypass that never decays. A pin shows its item verbatim (clipped to 1024 B) in
`<pinned>` until it is resolved, whatever its age.

- Auto-pin at ingest (heuristics, can only ADD):
  - `directive`: a `user` item ≤ 1000 chars with a sentence (split after
    `.` `!` `?` or a line break) that matches the standing-order words
    `/\b(always|never|from now on|don't ever|do not ever|remember that|every time)\b/i`
    (whole words) and does not end in `?`. Quoted spans (`"…"`, `“…”`, `'…'`) and
    code (`` `…` ``, fenced blocks) are removed first: a word inside them is
    being talked about, not given. Never a directive: a task request or question
    without such words, a user item with an `agent` (a subagent's prompt, not a
    human), or any item of a one-shot non-interactive run (`NormItem.oneShot`:
    Claude transcripts with `entrypoint: "sdk-cli"` = `claude -p`; Pi when the
    extension's `ctx.hasUI` is not true = `pi -p`, passed as `syncPi(file,
    {oneShot: true})` / `cyth sync-pi --one-shot`). A false pin is misdirection,
    since `<pinned>` reads as standing orders.
  - `failure`: a `tool` item with status `ERR` (only `isError` or a nonzero
    exit code of that very call) that is UNRESOLVED and that a future session
    needs. Only from live ingest of a main session: never from a subagent item
    (`agent` set; a finished transcript, whose handback reports outcomes) and
    never during `backfill`. A failure is open per (session, agent, tool name)
    and auto-resolves when a later call of the same tool in that session has
    status `ok`.
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
  check); check every node text ≤ NODE and every persisted view has
  `viewEnd = tailStart ≤ count`. Non-zero exit on any failure.

## 7. Contract (the head of the view block, both harnesses)

Every sentence in it must be true of what the model has in front of it, in
both harnesses. It is rendered by core at the head of the view block (§3), not
put in the system prompt: if the view cannot be built, the model gets neither
the header nor a description of one. Its job is behaviour: the log is complete
and cheap to search, so the model must search before it claims absence and
never asks the user to re-supply what the log holds.

```
## Memory: cyberthymesia
This project keeps a full log of every session, Claude Code and Pi alike. The log
holds each user message, assistant reply and tool call, verbatim. Searching it
is cheap.
<recent> is only the latest slice of that log, not the history. Older items are
not shown here, but they are in the log.
Each <recent> line is one item, oldest first: `#n|` then u: (user), a: (assistant)
or t: (tool). @c1234 or @p1234 names the Claude Code or Pi session where it changes.
A line ending in … is clipped. A tool line is a digest of the call.
The messages after this block are the recent part of this session, verbatim.
This block was built when this conversation started or last compacted. The tools
read the log as it is now.
- Before you say something is absent, unknown or not discussed, call memory_find.
  Try at least two phrasings.
- Never ask the user to repeat context the log may hold. Find it instead.
- The latest word on a thing is the truth.
- memory_find(query): full-text search over every item, newest first. Calls of
  these memory_* tools are left out of search and <recent>.
- memory_zoom(ref): #n gives item n whole, a tool call with its input and output.
  Long items are paged: #n@offset continues.
- memory_pin(ref, reason) / memory_unpin(id): keep an item in <pinned>, or release it.
- <pinned> holds user directives and unresolved tool failures, verbatim (first 1 KB)
  whatever their age. Follow them. If one is resolved or was flagged by mistake,
  say so and unpin it.
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
  syncPi(sessionPath: string, opts?: { oneShot?: boolean }): { added: number }
  backfill(opts: { claudeDir?: string; piDir?: string }): { added: number } // this project's sessions, merged by ts
  seqOf(harness, session, uuid): number | undefined
  view(harness, session, opts?: { header?: number; tail?: number; tailStart?: number }): {
    block: string; viewEnd: number; tailStart: number; bytes: number; root: string; algedonic: boolean }
  fold(harness, session, tailStart: number): void   // advance tailStart (forward only)
  zoom(ref: string): string
  search(q: string, opts?: { regex?: boolean; limit?: number }): string
  pin(ref: string, reason: string): number; unpin(id: number): void; pins(): string
  pending(limit: number): { ref: string; prompt: string }[]  // legacy (§2): unused by adapters
  put(ref: string, text: string): boolean            // legacy model summary, validated ≤ NODE
  forget(ref: string): void                          // legacy
  forgetSession(arg: string, opts?: { dryRun?: boolean }): ForgetPlan  // §8a
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
<ref> | forget-session <id|tag> [--dry-run] | verify`. `sync-pi` takes `--one-shot`. Global `--cwd DIR` (default cwd) and `--json`. Exit ≠ 0 on error,
message on stderr.

### 8a. `forgetSession`

Removes one session (`arg` = session id, an unambiguous id prefix of ≥ 4 chars,
or a leaf tag like `p1be2`; ambiguity is an error) from a store, consistently,
in one transaction: its items, FTS rows, `raw` and pending `calls` rows, its
ingest cursors (files whose path holds the session id), and the pins on its
items. The log stays dense, so the remaining items are renumbered `0..n-1`,
re-hashed and the whole tree rebuilt (legacy model summaries become clips); manual
and surviving auto pins follow their items (same ids); every `views` row and the
`views_log` are cleared, because their seqs and roots no longer hold. The
session goes into `forgotten`, so a later sync, backfill or ingest of it adds
nothing. `{dryRun: true}` returns the same `ForgetPlan` (items, fts rows, raw,
calls, pins, views, cursors, remaining) and changes nothing.

## 9. Adapters

Both: **fail open.** Any error in cyberthymesia → the harness's native
behaviour, plus a status line saying so. `CYTH_DISABLE=1` → pass-through.
**No model calls:** neither adapter asks a model for anything (no summaries,
no `pending`/`put`). Tools: `memory_zoom`, `memory_find`, `memory_pin`,
`memory_unpin`, `memory_pins` (thin calls into core). A core error in a tool
reaches the model as `<tool>: <core's message>` (an error result), never a bare
"failed". The status line shows items and pins. Both adapters have identical
semantics: the same core `view` block (§3), rendered for the first model call
of every session and again after every fold or compaction; a new session in a
project with history sees its pins and newest items at once, and the rest by
search.

- **claude-code/** (a Claude Code mod; no Node in the module, so core is reached
  through `$.process.run` of the CLI). Ingest: `sync-claude` on the session's
  transcript at `turn.complete`. View: a `prompt.context` hook adds the view
  block for `(claude, <session>)` as a context block of the conversation's
  first user message (beside CLAUDE.md), so it is there from the first
  request; the engine keeps that block until a compaction, then asks again.
  Compaction: answer `session.compact` with the tail messages kept by handle,
  after folding `tailStart` to the tail's first item and invalidating
  `prompt.context`, so the re-sent block is the folded view. The adapter
  never calls `$.session.compact()` itself: a compaction a module raises skips
  that module's own `session.compact` hook, so the engine's summarizer would
  run instead. Compaction comes from the engine's triggers (`/compact`, and
  auto-compaction, whose threshold `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` and
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (≥ 100k) lower to keep the context small).
  Subagent compactions (`agentId`) fold under `session = <session>/<agentId>`.
- **Claude transcripts after a compaction** repeat the kept tail as new
  records (new uuids, same timestamps and text). Ingest drops a user or
  assistant record whose session, kind, timestamp and text equal an existing
  item's, and skips the engine's own compaction summary (`isCompactSummary`).
- **pi/** (a Pi extension; imports core directly). Ingest at `message_end`
  (or `syncPi` on the session file). `context` hook: replace everything before
  the tail with one user message carrying the view block; fold when the tail
  passes TAIL. `CYTH_HEADER` is passed to `view` as `{header}`. `session_before_compact`: return our compaction (or cancel) so Pi's
  summarizer never runs.

## 10. Tests (core, `node --test`)

Seeded PRNG property tests over random item streams (mixed kinds, sizes,
sessions, failures):
1. `<recent>` is whole leaf lines (each exactly `#n|` + the leaf text of §3),
   newest last, contiguous, ending at `tailStart − 1`, never an item ≥ `tailStart`;
   no `<memory>` section.
2. `<recent>` lines total ≤ `HEADER` bytes, and the next older line would not fit.
   The block is byte-identical between folds while only the tail grows.
3. Every node text ≤ NODE bytes, one line.
4. Re-ingest is a no-op; item count and root unchanged.
5. Merkle: MTH matches a reference implementation; appending never changes the
   MTH of any earlier prefix; `verify` passes, and fails on a tampered item.
6. `zoom('#lo-hi')` returns exactly its two children; `#n@offset` pages reassemble to the item.
7. Pins: the quota is respected; a failure auto-resolves on a later success; heuristics never remove a pin.
8. Determinism: the same input gives byte-identical view blocks.

Each guard is mutation-tested once (break it, see a test fail, restore), and the
result is recorded in `core/test/MUTATIONS.md`.
