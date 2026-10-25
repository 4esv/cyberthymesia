# cyberthymesia core store: settled design for core/src/index.ts

Repo root: this repository. The contract is SPEC.md (§1-§8, §10).
This file settles what the spec leaves open. Where it and SPEC.md disagree, SPEC.md wins.

Runtime: Node 26 runs .ts directly (type stripping: no enums, no namespaces, no parameter
properties; `import type` for types; relative imports end in `.ts`). `node:sqlite`
(DatabaseSync), zero npm deps. FTS5 is available in node:sqlite (checked).

Reuse the pure modules, do not reimplement them:
- types.ts: NormItem, ViewResult, Status, Store (the interface to implement; includes roots()).
- project.ts: projectRoot(cwd), storePath(root, home).
- ingest.ts: parseClaude(file, start, lookup), parsePi(file, start, lookup), claudeCwd(file),
  piHeader(file), listClaude(dir), listPi(dir). Chunk = {items, raw, open, closed, end, bad}.
- leaves.ts: ItemRow, leafText(item, tag|null), tag(harness, session), prefix(kind, tag),
  mergeClip(a, b), combine(a, b), aggText(meta), CYTH_TOOLS, cythTool(name).
- view.ts: CONTRACT, recentLines, recentBytes, renderRecent, renderBlock.
- pins.ts: isDirective, toolKey, pinText, renderPins, PinRow.
- merkle.ts: leafHash, nodeHash, foldRoots, mthReference, EMPTY.
- util.ts: NODE, PAGE, HEADER, TAIL, bytes, clipBytes, oneLine, canonical, sha256hex, span,
  refOf, parseRef, roots.

## Schema (one SQLite file per project)
PRAGMA journal_mode=WAL; busy_timeout=5000. Every write is one short `BEGIN IMMEDIATE`
transaction (rollback on throw). Never hold a transaction across anything slow.

- items(seq INTEGER PRIMARY KEY, harness, session, agent NULL, uuid, kind, ts, text,
  meta TEXT NULL (JSON), hash TEXT (hex), UNIQUE(harness, session, uuid)).
  For a tool item: text = tool.output, meta = {name, input, isError}. Else meta NULL.
  Thinking goes to `raw`, never into items.
  hash = sha256hex(canonical({seq, harness, session, agent: agent ?? null, uuid, kind, ts, text, meta})).
- items_fts: FTS5 table (body), rowid = seq. body = text for user/assistant;
  for tool: name + ' ' + canonical(input) + '\n' + output.
- raw(harness, session, uuid, thinking, PRIMARY KEY(harness, session, uuid)), INSERT OR IGNORE.
- nodes(l, i, text, source, meta TEXT NULL (AggMeta JSON), mh TEXT (hex Merkle hash),
  tries INTEGER DEFAULT 0, PRIMARY KEY(l, i)).
- views(harness, session, parts TEXT, view_end, tail_start, high,
  PRIMARY KEY(harness, session)). A view is its tail_start; view_end is written equal to it.
  `parts` (the old tree view) is written '[]' and never read; `high` records the header
  budget of the last write and is never read. The columns stay so old stores open.
- views_log(id INTEGER PRIMARY KEY, ts, harness, session, n, root, view_end, tail_start, sha, bytes).
- pins(id INTEGER PRIMARY KEY, seq, reason, kind, key NULL, resolved INTEGER DEFAULT 0).
- forgotten(harness, session, PRIMARY KEY(harness, session)): sessions removed by forgetSession (SPEC §8a); ingest skips them.
- cursors(file TEXT PRIMARY KEY, harness, offset INTEGER).
- calls(harness, session, id, agent NULL, name, input TEXT JSON, ts, PRIMARY KEY(harness, session, id)):
  tool calls still waiting for a result, carried across syncs.

## ingest(items)
One transaction. For each NormItem in order: skip if (harness, session, uuid) exists.
seq = current count. Insert the item, its fts row, `raw` if thinking. Build leaf (0,seq):
leafText(row, t) with t = tag(harness, session) when seq == 0 or the previous item's
(harness, session) differs, else null. mh = hex(leafHash(hash bytes)). Then cascade: while
the node just built (l, i) has i odd, build (l+1, i>>1) from (l, i-1) and (l, i):
- both children have non-null meta (all tools) → source det, meta = combine, text = aggText.
- else source clip, text = mergeClip(a.text, b.text), meta null.
- mh = hex(nodeHash(a.mh, b.mh)).
Pins: isDirective(row) → pin kind 'directive', reason 'directive'. toolKey(row): key =
harness/session/agent/lowercased tool name. If !ok and live (not backfill) and agent is null →
pin kind 'failure', reason 'failure'; if ok → mark resolved every open failure pin with the
same key (backfill and subagent items still resolve, never create). Heuristics never resolve directive/manual pins.
- toolOk(output, isError): a tool is ERR only when isError is true or exitCode(output) is a
  nonzero number (a leading "Exit code N", or a trailing "Command exited with code N" line).
  The output text alone never marks a tool ERR — a successful `grep` whose output prints
  "... publish attempt failed" stays ok. tailLine still chooses which line the digest shows.
- isDirective(item, oneShot): SPEC §5. A sentence (not ending in "?", quotes and code
  removed) that matches one of STANDING (pins.ts): a sentence-initial imperative
  always/never/don't ever + a word not in NOT_VERB and not -ing/-ed; please always/never;
  from now on / going forward / from here on with no "I'll / he will / I'm going to / I hope"
  clause (SELF); you|we should|must|need to|have to always|never; make sure you always|never;
  want you to always|never; let's always|never; I|we (almost) always|never|don't ever
  want|prefer; our standard|rule|convention|policy|default is; we're trying|aiming|going to …
  always|never. Never for a one-shot run (NormItem.oneShot) or an item with an agent.
Returns {added, lastSeq: count-1} (-1 when empty).

## sync / backfill
- syncClaude(file) / syncPi(file): cursor offset (0 if none; reset to 0 if the file is now
  smaller). Parse from offset with lookup = SELECT from calls. In one transaction: ingest the
  items, insert raw, upsert chunk.open into calls, delete chunk.closed from calls, set the
  cursor to chunk.end. Returns {added}.
- backfill({claudeDir = ~/.claude/projects, piDir = ~/.pi/agent/sessions}): list files;
  keep a Claude file iff projectRoot(claudeCwd(file)) === store.root, a Pi file iff
  projectRoot(piHeader(file).cwd) === store.root. Parse each from its cursor, collect all
  items, stable-sort by ts (string compare of ISO ts; ties keep file order), then one
  transaction: ingest all, raw, calls, cursors. Returns {added}.

## view / fold
- header = opts.header ?? env CYTH_HEADER ?? HEADER (positive numbers only, floored). Not
  persisted as state: the same env gives the same block.
- view(h, s, opts): if no views row: create with tailStart = clamp(opts.tailStart ?? count,
  0, count). If the row exists, opts.tailStart is ignored (only fold moves it).
  Render: block = CONTRACT + '\n\n' + pinnedBlock + '<recent>\n' + lines + '</recent>\n', where
  pinnedBlock = renderPins(open pins oldest first, text = pinText(item)).block and lines =
  recentLines(tailStart, header, recentLine, ownTool). ownTool(seq) = a tool item whose
  meta.name is in CYTH_TOOLS (leaves.ts: memory_find/zoom/pin/unpin/pins, bare and
  mcp__cyberthymesia__-prefixed); those seqs are skipped. recentLine(seq, first) = `#seq|` +
  leafText(item, tag unless the previous non-ownTool item has the same harness and session,
  or always when first).text, rebuilt from the item (never the
  node text, so a legacy model summary never shows and the line can never change).
  recentLines walks seq = tailStart-1 down, adds a line while the total (line + '\n' each,
  the oldest counted with its forced tag) stays <= header, stops at the first that does not
  fit, and returns them newest last.
  viewEnd = tailStart. root = hex MTH(viewEnd). bytes = bytes(block). algedonic =
  renderPins(...).over > 0. Log a views_log row (n = viewEnd) unless the last row for
  (h, s) has the same sha.
- fold(h, s, tailStart): create the view as above if absent; new = min(max(tailStart,
  state.tailStart), count); persist.

## zoom
- '#lo-hi': the node must exist (hi < count) else throw. Returns the two child lines
  `#ref|text` (current text) joined by '\n'.
- '#n' / '#n@offset': n < count else throw. The whole document of item n is
  `#n kind <harness>:<session>[ agent <agent>] <ts>\n` + body, where body = text for
  user/assistant; for tool: `tool ${name}${isError ? ' (isError)' : ''}\ninput: ${canonical(input)}\noutput:\n${output}`.
  Page = bytes [offset, offset+PAGE) of the document (clipBytes on the remainder; never
  split a code point). Return page + footer, footer exactly:
  `\n[#n bytes ${offset}-${end} of ${total}; more: memory_zoom #n@${end}]` when end < total, else
  `\n[#n bytes ${offset}-${end} of ${total}; end]`. Concatenating the pages (footers
  stripped) reproduces the document exactly. offset > total → throw.

## search(q, {regex = false, limit = 20})
- FTS: top `limit` by bm25 from items_fts MATCH q; if MATCH throws a syntax error, retry
  with every whitespace token double-quoted (inner quotes doubled). bm25 only selects which
  items qualify; the hits are then re-sorted newest first (seq/rowid descending) before
  output.
- regex: new RegExp(q, 'i'), scan items newest first over the fts body, up to limit hits.
- Both join items_fts to items on seq = rowid and drop ownTool rows in SQL (NOT_OWN:
  kind 'tool', json_valid(meta), json_extract(meta, '$.name') IN CYTH_TOOLS), so `limit`
  counts only rows that are shown. Query time, no ingest flag: old stores need no migration.
- Each hit: `#n|<leaf (0,n) current text>` then `\n  ` + a one-line snippet (~120 bytes around
  the match; fts5 snippet() is fine for FTS). Output capped at PAGE bytes (stop adding hits).
  No hits → `no hits for ${q}`.
- roots(): `#ref|text` for roots(count), '\n'-joined ('' for an empty store).

## pins
- pin(ref, reason): ref must be an item '#n' with n < count (ranges and offsets throw).
  kind 'manual'. Returns the id. unpin(id): unknown or already-resolved id throws.
- pins(): every open pin, oldest first, `[id] #seq kind: reason | pinText`, '\n'-joined;
  'no open pins' if none.
- status(): items, nodes (row count), pins (open count),
  algedonic (renderPins over > 0), root (hex MTH(count)).

## summaries (legacy, removed)
There is no summary queue (no pending/put/forget). Old stores keep their `model` nodes
as plain node text; nothing reads or rewrites them, and `tries` is written 0 and never read.

## verify()
Problems (strings) for: an item hash that does not match its recomputed hash; for every
distinct n in views_log, hex MTH(n) recomputed from recomputed item hashes (mthReference)
that differs from the logged root; a node text over NODE bytes or containing '\n'; a node
mh that does not match its children / item; a persisted view whose viewEnd != tailStart
or whose tailStart > count. ok = problems.length === 0.

## misc
- tag(harness, session): 'c'/'p' + the LAST 4 alphanumeric characters of the session id
  (not the first 4), so same-day UUIDv7 Pi sessions get distinct tags; for a Claude
  subagent key like 'abc/agent-x9f2' it is the last 4 alphanumerics of the whole key.
- openStore(cwd, {home}): root = projectRoot(cwd), dbPath = storePath(root, home); mkdir -p.
  Schema created idempotently (CREATE ... IF NOT EXISTS). close() closes the db.
- Tool items with no call seen (lookup miss): name from parser ('unknown' etc.), still stored.
- Deterministic: the same inputs give byte-identical blocks (no Date/random in blocks).
- Export openStore (and re-export the types). File header comment: one paragraph.
