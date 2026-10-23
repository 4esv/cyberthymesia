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
  leafModel(pre, summary), mergeClip(a, b), combine(a, b), aggText(meta), leafPrompt, mergePrompt.
- view.ts: reach, fit, coverage, renderBlock, memBytes, ViewState, Part.
- pins.ts: isDirective, toolKey, pinText, renderPins, PinRow.
- merkle.ts: leafHash, nodeHash, foldRoots, mthReference, EMPTY.
- util.ts: NODE, PAGE, HIGH, TAIL, bytes, clipBytes, oneLine, canonical, sha256hex, span,
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
- views(harness, session, parts TEXT (JSON [{l,i,text}]), view_end, tail_start, high,
  PRIMARY KEY(harness, session)).
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
Pins: isDirective(row) → pin kind 'directive', reason 'directive'. toolKey(row): if !ok → pin
kind 'failure', key = norm, reason 'failure'; if ok → mark resolved every open failure pin
with the same key. Heuristics never resolve directive/manual pins.
- toolOk(output, isError): a tool is ERR only when isError is true or exitCode(output) is a
  nonzero number (a leading "Exit code N", or a trailing "Command exited with code N" line).
  The output text alone never marks a tool ERR — a successful `grep` whose output prints
  "... publish attempt failed" stays ok. tailLine still chooses which line the digest shows.
- isDirective(item, oneShot): SPEC §5. Only explicit standing-order words
  (always|never|from now on|don't ever|do not ever|remember that|every time), on a sentence
  that does not end in "?", after quotes and code are removed; never for a one-shot run
  (NormItem.oneShot) or an item with an agent.
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
- High = opts.high ?? env CYTH_HIGH ?? HIGH. A session's high is persisted in views.high.
- view(h, s, opts): if no views row: create with tailStart = min(opts.tailStart ?? count, count),
  parts [], viewEnd 0, then reach(tailStart) and fit(high), persist. If the row exists,
  opts.tailStart is ignored (only fold moves it). If opts.high is given, persist it.
  Render: block = renderBlock(parts, pinnedBlock) where parts carry their SNAPSHOT text and
  pinnedBlock = renderPins(open pins oldest first, text = pinText(item)).block.
  root = hex MTH(viewEnd). bytes = bytes(block). algedonic = renderPins(...).over > 0.
  Log a views_log row (n = viewEnd) unless the last row for (h, s) has the same sha.
- fold(h, s, tailStart): create the view as above if absent; new = min(max(tailStart,
  state.tailStart), count); state.tailStart = new; reach(state, new, textOf);
  fit(state, high, textOf) (one batch); persist. textOf(l, i) = the node's current text.

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
- Each hit: `#n|<leaf (0,n) current text>` then `\n  ` + a one-line snippet (~120 bytes around
  the match; fts5 snippet() is fine for FTS). Output capped at PAGE bytes (stop adding hits).
  No hits → `no hits for ${q}`.
- roots(): `#ref|text` for roots(count), '\n'-joined ('' for an empty store).

## pins
- pin(ref, reason): ref must be an item '#n' with n < count (ranges and offsets throw).
  kind 'manual'. Returns the id. unpin(id): unknown or already-resolved id throws.
- pins(): every open pin, oldest first, `[id] #seq kind: reason | pinText`, '\n'-joined;
  'no open pins' if none.
- status(): items, nodes (row count), pending (see below), pins (open count),
  algedonic (renderPins over > 0), root (hex MTH(count)).

## summaries
- pending(limit): nodes with source 'clip' and tries < 2, ORDER BY l ASC, i DESC.
  Leaf prompt = leafPrompt(item text) (the item's full text); merge = mergePrompt(childA.text,
  childB.text) with current child texts. Returns [{ref: refOf(l,i), prompt}].
- put(ref, text): t = oneLine(text). Reject (return false) if the ref is not a node, its
  source is det or verbatim, t is empty, bytes(t) > NODE, or t matches META_OUTPUT (leaves.ts). On a reject of a clip/model node
  by length or meta-commentary, increment tries. Accept: leaf → leafModel(prefix(kind, tag-or-null as at
  build), t); merge → t. source 'model'. Returns true. Never changes snapshots in views.
- forget(ref): a model node goes back to its clip text (leaf: leafText again; merge: mergeClip
  of the children's current texts), source clip, tries 0. Other sources: no-op.

## verify()
Problems (strings) for: an item hash that does not match its recomputed hash; for every
distinct n in views_log, hex MTH(n) recomputed from recomputed item hashes (mthReference)
that differs from the logged root; a node text over NODE bytes or containing '\n'; a node
mh that does not match its children / item; a persisted view whose coverage(parts,
viewEnd) is non-empty or whose viewEnd > count. ok = problems.length === 0.

## misc
- tag(harness, session): 'c'/'p' + the LAST 4 alphanumeric characters of the session id
  (not the first 4), so same-day UUIDv7 Pi sessions get distinct tags; for a Claude
  subagent key like 'abc/agent-x9f2' it is the last 4 alphanumerics of the whole key.
- openStore(cwd, {home}): root = projectRoot(cwd), dbPath = storePath(root, home); mkdir -p.
  Schema created idempotently (CREATE ... IF NOT EXISTS). close() closes the db.
- Tool items with no call seen (lookup miss): name from parser ('unknown' etc.), still stored.
- Deterministic: the same inputs give byte-identical blocks (no Date/random in blocks).
- Export openStore (and re-export the types). File header comment: one paragraph.
