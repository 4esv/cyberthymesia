# Mutation results (SPEC §10)

Each guard was broken once, the tests were run, and the guard was restored. Run the sweep with `node core/scripts/mutate.ts <mutants.json> --test "<cmd>"`.

## core/src/index.ts: 103/103 killed
Test command: `node --test core/test/properties.test.ts core/test/store.test.ts`

| id | file | guard | result |
|---|---|---|---|
| I01 | core/src/index.ts | ingest idempotency on (harness,session,uuid) | killed |
| I02 | core/src/index.ts | ingest lastSeq = count-1 | killed |
| I03 | core/src/index.ts | ingest added counter | killed |
| I04 | core/src/index.ts | ingest records thinking in raw | killed |
| I05 | core/src/index.ts | ingest FTS body of a tool includes name+input | killed |
| I06 | core/src/index.ts | cascade condition: merge only at odd index | killed |
| I07 | core/src/index.ts | cascade parity: right child is 2*pi+1 | killed |
| I08 | core/src/index.ts | det-vs-clip merge: det only if both children det | killed |
| I09 | core/src/index.ts | tag on first leaf (ingest) | killed |
| I10 | core/src/index.ts | tag on session change (ingest): session compared | killed |
| I11 | core/src/index.ts | tag on first leaf (leafTag for put/forget) | killed |
| I12 | core/src/index.ts | tag on session change (leafTag): session compared | killed |
| I13 | core/src/index.ts | directive pin created | killed |
| I14 | core/src/index.ts | failure pin only when tool failed | killed |
| I15 | core/src/index.ts | failure auto-resolves on later success | killed |
| I16 | core/src/index.ts | auto-resolve matches on normalized key | killed |
| I17 | core/src/index.ts | cursor reset when file shrank | killed |
| I18 | core/src/index.ts | cursor upsert advances offset | killed |
| I19 | core/src/index.ts | calls upsert refreshes a re-opened call | killed |
| I20 | core/src/index.ts | syncClaude stores open calls | killed |
| I21 | core/src/index.ts | syncPi deletes closed calls | killed |
| I22 | core/src/index.ts | call lookup keeps name and input | killed |
| I23 | core/src/index.ts | backfill filters claude files by project root | killed |
| I24 | core/src/index.ts | backfill filters pi files by project root | killed |
| I25 | core/src/index.ts | backfill orders items by ts | killed |
| I26 | core/src/index.ts | backfill stores open calls | killed |
| I27 | core/src/index.ts | view tailStart clamped to <= count | killed |
| I28 | core/src/index.ts | view tailStart clamped to >= 0 | killed |
| I29 | core/src/index.ts | view tailStart defaults to count | killed |
| I30 | core/src/index.ts | view fits to high on creation | killed |
| I31 | core/src/index.ts | view persists a new high on existing view | killed |
| I32 | core/src/index.ts | view bytes is UTF-8 byte length | killed |
| I33 | core/src/index.ts | view root is MTH at viewEnd | killed |
| I34 | core/src/index.ts | view algedonic only when pins over quota | killed |
| I35 | core/src/index.ts | views_log dedupes on sha | killed |
| I36 | core/src/index.ts | views_log compares to the latest entry | killed |
| I37 | core/src/index.ts | resolveHigh rejects non-positive explicit high | killed |
| I38 | core/src/index.ts | resolveHigh rejects non-positive CYTH_HIGH | killed |
| I39 | core/src/index.ts | ensureView reuses an existing view | killed |
| I40 | core/src/index.ts | fold forward-only (max with current tailStart) | killed |
| I41 | core/src/index.ts | fold clamps to count (min) | killed |
| I42 | core/src/index.ts | fold fits with the view's persisted high | killed |
| I43 | core/src/index.ts | zoom range: hi must be < count | killed |
| I44 | core/src/index.ts | zoom item: n must be < count | killed |
| I45 | core/src/index.ts | zoom item: offset may equal total, not exceed | killed |
| I46 | core/src/index.ts | zoom page capped at PAGE bytes | killed |
| I47 | core/src/index.ts | zoom page never splits a UTF-8 code point | killed |
| I48 | core/src/index.ts | zoom footer: more only while bytes remain | killed |
| I49 | core/src/index.ts | search FTS syntax-error fallback runs the quoted query | killed |
| I50 | core/src/index.ts | search fallback escapes embedded quotes | killed |
| I51 | core/src/index.ts | search default limit 20 | killed |
| I52 | core/src/index.ts | search regex: invalid pattern gives no hits | killed |
| I53 | core/src/index.ts | search regex is case-insensitive | killed |
| I54 | core/src/index.ts | search regex newest first | killed |
| I55 | core/src/index.ts | search regex honours limit | killed |
| I56 | core/src/index.ts | search regex snippet window start clamped at 0 | killed |
| I57 | core/src/index.ts | search output capped at PAGE | killed |
| I58 | core/src/index.ts | search empty result message | killed |
| I59 | core/src/index.ts | pin rejects ranges | killed |
| I60 | core/src/index.ts | pin rejects offsets | killed |
| I61 | core/src/index.ts | pin rejects item beyond store | killed |
| I62 | core/src/index.ts | unpin unknown id throws | killed |
| I63 | core/src/index.ts | unpin resolved pin throws | killed |
| I64 | core/src/index.ts | pins() lists open pins only | killed |
| I65 | core/src/index.ts | view pinned block lists open pins only | killed |
| I66 | core/src/index.ts | pending: tries < 2 | killed |
| I67 | core/src/index.ts | pending: order leaves first | killed |
| I68 | core/src/index.ts | pending: order newest first within a level | killed |
| I69 | core/src/index.ts | pending: only clip nodes | killed |
| I70 | core/src/index.ts | pending: merge prompt uses both children | killed |
| I71 | core/src/index.ts | status pending counts tries < 2 | killed |
| I72 | core/src/index.ts | put rejects det nodes | killed |
| I73 | core/src/index.ts | put rejects verbatim nodes | killed |
| I74 | core/src/index.ts | put rejects empty text | killed |
| I75 | core/src/index.ts | put rejects text > NODE bytes (boundary) | killed |
| I76 | core/src/index.ts | put rejects text > NODE bytes | killed |
| I77 | core/src/index.ts | put increments tries on rejection | killed |
| I78 | core/src/index.ts | put rejects refs with an offset | killed |
| I79 | core/src/index.ts | put on a missing node returns false | killed |
| I80 | core/src/index.ts | put on a malformed ref returns false | killed |
| I81 | core/src/index.ts | put leaf keeps the leaf prefix | killed |
| I82 | core/src/index.ts | put branch: leaf vs merge node | killed |
| I83 | core/src/index.ts | forget only reverts model nodes | killed |
| I84 | core/src/index.ts | forget resets tries | killed |
| I85 | core/src/index.ts | forget merge node recomputes mergeClip of children | killed |
| I86 | core/src/index.ts | forget leaf branch | killed |
| I87 | core/src/index.ts | verify: item hash | killed |
| I88 | core/src/index.ts | verify: MTH per views_log n | killed |
| I89 | core/src/index.ts | verify: MTH reference over first n items | killed |
| I90 | core/src/index.ts | verify: node size | killed |
| I91 | core/src/index.ts | verify: node size boundary (512 ok) | killed |
| I92 | core/src/index.ts | verify: node newline | killed |
| I93 | core/src/index.ts | verify: leaf mh | killed |
| I94 | core/src/index.ts | verify: internal mh | killed |
| I95 | core/src/index.ts | verify: missing children | killed |
| I96 | core/src/index.ts | verify: view coverage | killed |
| I97 | core/src/index.ts | verify: viewEnd > count | killed |
| I98 | core/src/index.ts | verify: view parts JSON | killed |
| I99 | core/src/index.ts | verify: item meta JSON | killed |
| I100 | core/src/index.ts | verify: ok iff no problems | killed |
| I101 | core/src/index.ts | safeParse: malformed JSON never throws | killed |
| I102 | core/src/index.ts | tx: rollback on error | killed |
| I103 | core/src/index.ts | tx: commit | killed |

## core/bin/cyth.ts: 18/18 killed
Test command: `node --test core/test/cli.test.ts`

| id | file | guard | result |
|---|---|---|---|
| C1 | core/bin/cyth.ts | arity: wrong arg count is a usage error | killed |
| C2 | core/bin/cyth.ts | integer check on seq/id/limit | killed |
| C3 | core/bin/cyth.ts | harness must be claude or pi | killed |
| C4 | core/bin/cyth.ts | verify ok=false exits 1 | killed |
| C5 | core/bin/cyth.ts | usage errors exit 2 | killed |
| C6 | core/bin/cyth.ts | errors exit nonzero | killed |
| C7 | core/bin/cyth.ts | unknown flag rejected | killed |
| C8 | core/bin/cyth.ts | --json emits JSON | killed |
| C9 | core/bin/cyth.ts | put false is not an error | killed |
| C10 | core/bin/cyth.ts | --regex reaches search | killed |
| C11 | core/bin/cyth.ts | --limit reaches search | killed |
| C12 | core/bin/cyth.ts | --home selects the store home | killed |
| C13 | core/bin/cyth.ts | --cwd selects the project | killed |
| C14 | core/bin/cyth.ts | pending --limit honoured | killed |
| C15 | core/bin/cyth.ts | unknown command exits 2 | killed |
| C16 | core/bin/cyth.ts | sync-claude routes to syncClaude | killed |
| C17 | core/bin/cyth.ts | fold passes seq | killed |
| C18 | core/bin/cyth.ts | value flag without a value is a usage error | killed |

## Audit fixes, 2026-10-23: core 8/8 killed
Test command: `node --test core/test/properties.test.ts core/test/store.test.ts`. Run on the new
guards only (the full index sweep above takes ~25 minutes). I104, L1, L2, P1 are also in
`mutants.index.json`.

| id | file | guard | result |
|---|---|---|---|
| I104 | core/src/index.ts | search FTS output is re-sorted newest first | killed |
| L1 | core/src/leaves.ts | toolOk: output text alone never marks a tool ERR | killed |
| L2 | core/src/leaves.ts | tag uses the last 4 alphanumerics, not the first 4 | killed |
| P1 | core/src/pins.ts | isDirective: a question sentence is not a directive | killed |
| I105 | core/src/index.ts | syncClaude drops a compaction re-written tail | killed |
| I106 | core/src/index.ts | copies within one chunk dropped | killed (after adding the one-pass test) |
| I107 | core/src/index.ts | dedupe keyed on timestamp | killed |
| I108 | core/src/ingest.ts | engine compaction summary is not a user item | killed |

## claude-code/hooks: 27/28 killed, 1 equivalent
Test command: `claude plugin test claude-code`. M15 (compaction threshold) was removed with the
self-triggered compaction; M13 now guards the view block instead of the contract section.

| id | file | guard | result |
|---|---|---|---|
| M1 | claude-code/hooks/register.ts | CYTH_DISABLE kill switch | killed |
| M2 | claude-code/hooks/register.ts | nonzero CLI exit throws | killed |
| M3 | claude-code/hooks/register.ts | compaction fails open to native | killed |
| M4 | claude-code/hooks/register.ts | compaction failure sets a status line | killed |
| M5 | claude-code/hooks/register.ts | tool failure denies | killed |
| M6 | claude-code/hooks/tail.ts | tail never splits a use from its result (edge) | killed |
| M7 | claude-code/hooks/tail.ts | tail no-split check | killed |
| M8 | claude-code/hooks/register.ts | regex flag forwarded | killed |
| M9 | claude-code/hooks/register.ts | precompute skipped | killed |
| M10 | claude-code/hooks/register.ts | tail start must be in store before fold | killed |
| M11 | claude-code/hooks/register.ts | empty view block rejected | killed |
| M12 | claude-code/hooks/register.ts | no clean boundary rejected | killed |
| M13 | claude-code/hooks/register.ts | view block not added when disabled | killed |
| M14 | claude-code/hooks/register.ts | no after-turn work when disabled | killed |
| M16 | claude-code/hooks/tail.ts | pick respects clean cuts | killed |
| M17 | claude-code/hooks/register.ts | ingest failure surfaces a status line | killed |
| M18 | claude-code/hooks/register.ts | prompt.context adds the view block | killed |
| M19 | claude-code/hooks/register.ts | prompt.context fails open with no block | killed |
| M20 | claude-code/hooks/register.ts | empty view block refused | killed |
| M21 | claude-code/hooks/register.ts | compaction re-asks prompt.context | killed |
| M22 | claude-code/hooks/register.ts | compaction keeps only the tail | killed |
| M23 | claude-code/hooks/register.ts | drain stops after a round that lands nothing | killed |
| M24 | claude-code/hooks/register.ts | drain capped at 8 rounds | killed |
| M25 | claude-code/hooks/register.ts | drain ends when nothing is pending | equivalent: an empty round lands nothing, so the no-progress stop ends the drain too |
| M26 | claude-code/hooks/register.ts | session.start drains the backlog | killed |
| M27 | claude-code/hooks/register.ts | a refused put counts as no progress | killed |
| M28 | claude-code/hooks/register.ts | an empty answer is not put | killed |
| M29 | claude-code/hooks/register.ts | summaries ask at low effort | killed |

## pi/src: 3/4 killed, 1 equivalent (pi/test/mutants.json)
Test command: `node --test pi/test/extension.test.ts pi/test/plan.test.ts`

| id | file | guard | result |
|---|---|---|---|
| P1 | pi/src/extension.ts | drain stops after a round that lands nothing | killed |
| P2 | pi/src/extension.ts | drain capped at 8 rounds | killed |
| P3 | pi/src/extension.ts | session_start drains the backlog | killed |
| P4 | pi/src/extension.ts | drain ends when nothing is pending | equivalent: an empty round lands nothing, so the no-progress stop ends the drain too |

## Pin, summary, cap and forget-session fixes: 36/36 killed
Test command: `node --test core/test/*.test.ts` (D14: `node --test pi/test/*.test.ts`). Sweep files: `core/test/mutants.fix.json`, `pi/test/mutants.fix.json`. A first sweep left S02, S04, S05, F08, F11 alive (overlapping patterns in one test string; no ambiguity or raw-row test) and S03 unapplied (non-unique find); tests and the find were fixed, and those six were re-swept killed.

| id | file | guard | result |
|---|---|---|---|
| D01 | core/src/pins.ts | directive: never from a one-shot run | killed |
| D02 | core/src/pins.ts | directive: never from a subagent prompt | killed |
| D03 | core/src/pins.ts | directive: only explicit standing-order words | killed |
| D04 | core/src/pins.ts | directive: "don't ever" is a standing order | killed |
| D05 | core/src/pins.ts | directive: double-quoted spans ignored | killed |
| D06 | core/src/pins.ts | directive: inline code ignored | killed |
| D07 | core/src/pins.ts | directive: fenced code ignored | killed |
| D08 | core/src/pins.ts | directive: a question is not an order | killed |
| D09 | core/src/pins.ts | directive: "every time" is a standing order | killed |
| D10 | core/src/index.ts | ingest passes oneShot to the directive check | killed |
| D11 | core/src/ingest.ts | claude -p transcripts (sdk-cli) are one-shot | killed |
| D12 | core/src/ingest.ts | syncPi oneShot reaches the items | killed |
| D13 | core/src/index.ts | syncPi forwards opts.oneShot | killed |
| S01 | core/src/index.ts | put rejects meta-commentary | killed |
| S02 | core/src/leaves.ts | meta check: "these two lines" | killed |
| S03 | core/src/leaves.ts | meta check: "the merged line" | killed |
| S04 | core/src/leaves.ts | meta check: "no lasting" | killed |
| S05 | core/src/leaves.ts | meta check: "nothing of lasting" | killed |
| S06 | core/src/leaves.ts | meta check: "this summary" | killed |
| S07 | core/src/leaves.ts | leaf prompt forbids meta-commentary | killed |
| S08 | core/src/leaves.ts | merge prompt forbids meta-commentary | killed |
| H01 | core/src/util.ts | default view cap is 32768 bytes | killed |
| F01 | core/src/index.ts | forgetSession dry run changes nothing | killed |
| F02 | core/src/index.ts | forgetSession tombstones the session | killed |
| F03 | core/src/index.ts | ingest skips forgotten sessions | killed |
| F04 | core/src/index.ts | forgetSession drops the session's cursors | killed |
| F05 | core/src/index.ts | forgetSession rebuilds the FTS rows | killed |
| F06 | core/src/index.ts | forgetSession clears views | killed |
| F07 | core/src/index.ts | forgetSession clears views_log (stale roots) | killed |
| F08 | core/src/index.ts | forgetSession refuses an ambiguous id | killed |
| F09 | core/src/index.ts | forgetSession drops pins on removed items | killed |
| F10 | core/src/index.ts | forgetSession remaps surviving pins | killed |
| F11 | core/src/index.ts | forgetSession drops the session's raw rows | killed |
| F12 | core/src/index.ts | rebuild does not re-run auto-pin heuristics | killed |
| F13 | core/src/index.ts | forgetSession finds the session's cursor files | killed |
| D14 | pi/src/extension.ts | pi -p (no UI) syncs as one-shot | killed |

## session to store stickiness (core/src/sessions.ts, core/bin/cyth.ts, core/src/index.ts): 5/5 killed
Test command: `node --test core/test/sessions.test.ts` (mutants in core/test/mutants.sessions.json). S03 first survived; the test now also views a `session/agent` key.

| id | file | guard | result |
|---|---|---|---|
| S01 | core/src/sessions.ts | session keeps the store recorded at first contact, not the current cwd's | killed |
| S02 | core/src/sessions.ts | first contact is recorded | killed |
| S03 | core/src/sessions.ts | a subagent key belongs to its parent session's store | killed |
| S04 | core/bin/cyth.ts | sync-claude infers the session from the transcript path | killed |
| S05 | core/src/index.ts | openStore resolves through the session registry | killed |

Guard mutation (home-guard.test.ts): a test file that called openStore without a home made the guard fail ("tests leaked stores into the default home"); removing it made it pass. The guard first passed vacuously because a nested `node --test` inherits NODE_TEST_CONTEXT and runs nothing; the guard now deletes that variable.
Pi: replacing getStore(ctx.cwd, sidOf(ctx)) with getStore(ctx.cwd) made pi/test/extension.test.ts fail (1 test), restored.
