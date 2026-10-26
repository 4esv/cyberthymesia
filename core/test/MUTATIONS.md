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

## Failure pins: live main session only, resolve per tool (core/src/index.ts, pins.ts, leaves.ts): 8/8 killed
Test command: `node --test core/test/properties.test.ts core/test/store.test.ts` (mutants in core/test/mutants.failpins.json). F07 and F08 first survived; the "tool status" test now covers them.

| id | file | guard | result |
|---|---|---|---|
| F01 | core/src/index.ts | failure pin: never from a subagent item | killed |
| F02 | core/src/index.ts | failure pin: never during backfill | killed |
| F03 | core/src/index.ts | backfill passes failPins=false | killed |
| F04 | core/src/pins.ts | failure key is per session (another session's success does not resolve) | killed |
| F05 | core/src/pins.ts | failure resolves on any later success of the same tool, not the same output | killed |
| F06 | core/src/pins.ts | failure key includes the tool name (a Read success does not resolve a Bash failure) | killed |
| F07 | core/src/leaves.ts | tool ERR only from isError or a nonzero exit code of that call | killed |
| F08 | core/src/leaves.ts | exit code 0 is ok | killed |

## Header view (2026-10-25): 26/26 killed
The tree view and the summary drain were removed, so the `fit`/`reach` guards (I30, I37-I39,
I42), the claude-code drain guards (M23-M29) and the pi drain guards (P1-P4 above) no longer
apply. New guards, swept with `node core/scripts/mutate.ts <file> --test "<cmd>"`:
core `core/test/mutants.header.json` (`node --test core/test/properties.test.ts core/test/store.test.ts core/test/cli.test.ts`),
pi `pi/test/mutants.header.json` (`node --test pi/test/extension.test.ts pi/test/plan.test.ts`),
claude-code `claude-code/tests/mutants.header.json` (`claude plugin test claude-code`).
H01 survived the first sweep (random budgets never hit the newline boundary); a fixed
boundary case was added to P2 and H01 was re-swept killed.

| id | file | guard | result |
|---|---|---|---|
| H01 | core/src/view.ts | <recent> <= HEADER: each line's newline counts | killed (after adding the boundary case) |
| H02 | core/src/view.ts | <recent> <= HEADER: the budget binds | killed |
| H03 | core/src/view.ts | contiguous slice: the first line that does not fit stops the walk | killed |
| H04 | core/src/view.ts | whole lines only | killed |
| H05 | core/src/view.ts | newest last | killed |
| H06 | core/src/view.ts | never an item >= tailStart (and the slice ends at tailStart - 1) | killed |
| H07 | core/src/view.ts | the oldest line carries its session tag | killed |
| H08 | core/src/view.ts | determinism: no clock in the block | killed |
| H09 | core/src/index.ts | block stable between folds: <recent> ends at tailStart, not at count | killed |
| H10 | core/src/index.ts | recent line rebuilt from the item (tagged oldest line, no legacy summary) | killed |
| H11 | core/src/index.ts | resolveHeader rejects non-positive CYTH_HEADER | killed |
| H12 | core/src/index.ts | resolveHeader rejects a non-positive explicit header | killed |
| H13 | core/src/index.ts | CYTH_HEADER honoured | killed |
| H14 | core/src/util.ts | default header budget is 8192 bytes | killed |
| H15 | core/src/index.ts | fold is forward only | killed |
| H16 | core/src/index.ts | verify: viewEnd equals tailStart | killed |
| H17 | core/src/index.ts | verify: tailStart <= count | killed |
| PH1 | pi/src/extension.ts | a tool error carries core's message | killed |
| PH2 | pi/src/extension.ts | a tool error is an error result | killed |
| PH3 | pi/src/extension.ts | CYTH_HEADER reaches core's view | killed |
| PH4 | pi/src/extension.ts | status line has no summary backlog | killed |
| PH5 | pi/src/extension.ts | no summaries: agent_end never drains pending | killed |
| CH1 | claude-code/hooks/register.ts | a tool error is core's message, not the CLI wrapper | killed |
| CH2 | claude-code/hooks/register.ts | a tool error is not a bare 'failed' | killed |
| CH3 | claude-code/hooks/register.ts | status line has no summary backlog | killed |
| CH4 | claude-code/hooks/register.ts | no summaries: a turn never drains pending | killed |

## Search and <recent> leave out cyth's own tool calls (2026-10-25): 11/11 killed
Test command: `node --test core/test/properties.test.ts core/test/store.test.ts` (mutants in core/test/mutants.own.json).

| id | file | guard | result |
|---|---|---|---|
| O01 | core/src/index.ts | FTS search leaves out cyth's own tool calls | killed |
| O02 | core/src/index.ts | regex search leaves out cyth's own tool calls | killed |
| O03 | core/src/index.ts | <recent> leaves out cyth's own tool calls | killed |
| O04 | core/src/index.ts | <recent> tag compares with the line above, not a skipped call | killed |
| O05 | core/src/leaves.ts | Claude Code spelling (mcp__cyberthymesia__memory_*) is cyth's own | killed |
| O06 | core/src/leaves.ts | Pi spelling (bare memory_*) is cyth's own | killed |
| O07 | core/src/leaves.ts | memory_pin / memory_unpin / memory_pins calls are cyth's own | killed |
| O08 | core/src/leaves.ts | exact names only: a lookalike tool (memory_find_v2) is not cyth's | killed |
| O09 | core/src/index.ts | malformed meta does not make search throw | killed |
| O10 | core/src/view.ts | a skipped item does not end the <recent> walk | killed |
| O11 | core/src/view.ts | the oldest shown line (not a skipped seq) carries the tag | killed |

## No summary queue: pending/put/forget and status.pending removed (2026-10-25): 4/4 killed
The summary guards S01-S08 above (put's meta-commentary check, the prompts) and I11's
put/forget leafTag path no longer exist. New guards, test command
`node --test core/test/store.test.ts core/test/cli.test.ts` (mutants in core/test/mutants.pending.json).
Also checked: a fresh copy of the real ~/.cyberthymesia/Users-axel store (2373 items, 1221
legacy `model` nodes) opens with this code, `status` has no pending, `verify` is clean.

| id | file | guard | result |
|---|---|---|---|
| Q01 | core/src/index.ts | status has no pending count | killed |
| Q02 | core/bin/cyth.ts | the CLI has no pending command | killed |
| Q03 | core/src/index.ts | the Store API has no summary queue | killed |
| Q04 | core/src/index.ts | an old store's model nodes still verify | killed |

## Directive pins: standing orders, not standing-order words (2026-10-25): 19/19 + 9/9 killed
The old word-anywhere guards D03, D04, D08 (old find), D09 ("every time") no longer exist;
"remember that" and "every time" are no longer patterns (task-local asides and narration in
the measured sets). Test command `node --test core/test/store.test.ts core/test/cli.test.ts`
(new mutants in core/test/mutants.directive.json). First sweep: R03, R05, R14, R19 survived
(no -ing example, "please never" always also sentence-initial, a redundant "I never want"
pattern, no question that would otherwise match); the redundant pattern was merged into
R13's, the tests gained those cases, and all were re-swept killed. The still-applicable
old mutants D01, D02, D05-D07, D10-D13 were re-swept against the new tests: D05-D07 first
survived (no quoted or code example matched a new pattern), examples were added, 9/9 killed.

| id | file | guard | result |
|---|---|---|---|
| R01 | core/src/pins.ts | an imperative (sentence-initial always/never + verb) is a standing order | killed |
| R02 | core/src/pins.ts | a sentence-initial always/never before a non-verb is not an imperative | killed |
| R03 | core/src/pins.ts | a sentence-initial always/never before an -ing/-ed word is not an imperative | killed (after adding the case) |
| R04 | core/src/pins.ts | the imperative is anchored at sentence start ("Love how you never give up" narrates) | killed |
| R05 | core/src/pins.ts | please always/never is a standing order | killed (after adding the case) |
| R06 | core/src/pins.ts | an order with from now on / going forward is a standing order | killed |
| R07 | core/src/pins.ts | the speaker's own plan with from now on is not an order | killed |
| R08 | core/src/pins.ts | someone else's plan with from now on is not an order | killed |
| R09 | core/src/pins.ts | you/we must always/never is a standing order | killed |
| R10 | core/src/pins.ts | make sure you always/never is a standing order | killed |
| R11 | core/src/pins.ts | I want you to always/never is a standing order | killed |
| R12 | core/src/pins.ts | let's always/never is a standing order | killed |
| R13 | core/src/pins.ts | I/we always/never want/prefer is a standing order (live pin #10: I never want) | killed |
| R14 | core/src/pins.ts | I don't ever want is a standing order | killed (after merging the redundant pattern) |
| R15 | core/src/pins.ts | our standard/rule is is a standing order | killed |
| R16 | core/src/pins.ts | we are trying to ... never (live pin #137) is a standing order | killed |
| R17 | core/src/pins.ts | the old word-anywhere test is gone (LoCoMo narration pinned) | killed |
| R18 | core/src/pins.ts | don't ever / do not ever opens an imperative | killed |
| R19 | core/src/pins.ts | a question is not an order | killed (after adding the case) |
| D05 | core/src/pins.ts | directive: double-quoted spans ignored | killed (after adding the case) |
| D06 | core/src/pins.ts | directive: inline code ignored | killed (after adding the case) |
| D07 | core/src/pins.ts | directive: fenced code ignored | killed (after adding the case) |

## Search `from` filter and the broadened contract (2026-10-25): 19/19 killed
Core test command: `node --test core/test/store.test.ts core/test/cli.test.ts` (mutants in core/test/mutants.from.json). Pi: `node --test pi/test/*.test.ts` (pi/test/mutants.from.json). Claude: `claude plugin test claude-code` (claude-code/tests/mutants.from.json).

| id | file | guard | result |
|---|---|---|---|
| F01 | core/src/index.ts | FTS search applies the from filter | killed |
| F02 | core/src/index.ts | regex search applies the from filter | killed |
| F03 | core/src/index.ts | from keeps (not drops) the named kind | killed |
| F04 | core/src/index.ts | a bad from throws instead of matching nothing | killed |
| F05 | core/src/index.ts | from=tool is accepted | killed |
| F06 | core/src/index.ts | from=assistant is accepted | killed |
| F07 | core/src/index.ts | from=user is accepted | killed |
| F08 | core/src/index.ts | FTS kind filter applies before limit (bm25 top-N picks only from the kind) | killed |
| F09 | core/src/index.ts | FTS limit is the caller's limit, counted over filtered hits | killed |
| F10 | core/src/index.ts | the error names the allowed values and the bad one | killed |
| F11 | core/bin/cyth.ts | CLI --from reaches search | killed |
| F12 | core/bin/cyth.ts | CLI --from takes a value | killed |
| F13 | core/src/view.ts | contract tells the model to search with from user | killed |
| F14 | core/src/view.ts | contract covers undo/blocker cases | killed |
| F15 | core/src/view.ts | contract warns against invented names | killed |
| PF1 | pi/src/extension.ts | Pi memory_find passes from to core | killed |
| PF2 | pi/src/extension.ts | Pi memory_find schema lists the three kinds | killed |
| CF1 | claude-code/hooks/register.ts | Claude memory_find passes --from to the CLI | killed |
| CF2 | claude-code/hooks/register.ts | Claude memory_find schema lists the three kinds | killed |

## No model paraphrase shown as the log (2026-10-25): 9/9 killed
Test command: `node --test core/test/store.test.ts` (mutants in core/test/mutants.verbatim.json).

| id | file | guard | result |
|---|---|---|---|
| V01 | core/src/index.ts | FTS search hit line is rebuilt from the item, not a legacy model leaf | killed |
| V02 | core/src/index.ts | regex search hit line is rebuilt from the item, not a legacy model leaf | killed |
| V03 | core/src/index.ts | roots() never shows a model node's text | killed |
| V04 | core/src/index.ts | range zoom never shows a model node's text | killed |
| V05 | core/src/index.ts | a node with a model node anywhere under it is rebuilt (a clip can quote a summary) | killed |
| V06 | core/src/index.ts | a model node itself is rebuilt, not shown | killed |
| V07 | core/src/index.ts | rebuilt tool-only node is the det aggregate, as ingest builds it | killed |
| V08 | core/src/index.ts | rebuilt leaf carries its session tag, as ingest builds it | killed |
| V09 | core/src/index.ts | memo is keyed by level and index | killed |

## Near-spelling search fallback (2026-10-25): 22/22 killed
Test command: `node --test core/test/fuzzy.test.ts core/test/store.test.ts` (mutants in core/test/mutants.fuzzy.json). Z03 survived at first, because the widened query's own LIMIT hid it. A case where the exact hit ranks low in the widened query now kills it.

| id | file | guard | result |
|---|---|---|---|
| Z01 | core/src/index.ts | no widening once exact hits reach FEW | killed |
| Z02 | core/src/index.ts | few exact hits do trigger the near-spelling search | killed |
| Z03 | core/src/index.ts | near hits never push the output past limit | killed |
| Z04 | core/src/index.ts | at most EXTRA near hits | killed |
| Z05 | core/src/index.ts | an exact hit is not repeated or displaced by a near hit | killed |
| Z06 | core/src/index.ts | exact hits are kept alongside near hits | killed |
| Z07 | core/src/index.ts | output says which near spellings were searched | killed |
| Z08 | core/src/index.ts | the vocab table is temp; the store file gains no table | killed |
| Z09 | core/src/fuzzy.ts | FTS syntax queries are never rewritten | killed |
| Z10 | core/src/fuzzy.ts | uppercase FTS operators count as syntax | killed |
| Z11 | core/src/fuzzy.ts | words under 4 letters are not widened | killed |
| Z12 | core/src/fuzzy.ts | 2 edits only from 8 letters | killed |
| Z13 | core/src/fuzzy.ts | only letter words are widened | killed |
| Z14 | core/src/fuzzy.ts | a word is not its own neighbour | killed |
| Z15 | core/src/fuzzy.ts | a neighbour shares the first letter | killed |
| Z16 | core/src/fuzzy.ts | neighbours with most documents first | killed |
| Z17 | core/src/fuzzy.ts | at most NEAR neighbours per word | killed |
| Z18 | core/src/fuzzy.ts | an adjacent swap costs 1 | killed |
| Z19 | core/src/fuzzy.ts | distance is capped at max + 1 | killed |
| Z20 | core/src/fuzzy.ts | words stay ANDed; only spellings are ORed | killed |
| Z21 | core/src/fuzzy.ts | quotes inside a word are escaped | killed |
| Z22 | core/src/fuzzy.ts | the vocab range covers the whole first letter | killed |

## OR fallback for search (2026-10-25): 14/14 killed
Test command: `node --test core/test/fuzzy.test.ts core/test/store.test.ts` (mutants in core/test/mutants.orfallback.json). Y01, Y03 and Y14 survived at first and each got a test. After near and OR hits were made to share the EXTRA cap, Y01 (OR fallback stays off once exact and near hits reach FEW) became an equivalent mutant, because the shared cap is already spent by then, so it was dropped. Y15 (near and OR hits share the EXTRA cap) was added.

| id | file | guard | result |
|---|---|---|---|
| Y02 | core/src/index.ts | few hits do trigger the OR fallback | killed |
| Y03 | core/src/index.ts | OR hits never push the output past limit | killed |
| Y04 | core/src/index.ts | at most EXTRA OR hits | killed |
| Y05 | core/src/index.ts | an exact or near hit is not repeated by the OR fallback | killed |
| Y06 | core/src/index.ts | exact hits are kept alongside OR hits | killed |
| Y07 | core/src/index.ts | output says the last hits match only some words | killed |
| Y08 | core/src/index.ts | the OR note does not replace the near-spelling note | killed |
| Y09 | core/src/index.ts | OR hits are listed newest first | killed |
| Y10 | core/src/index.ts | exact and near hits keep their newest-first order | killed |
| Y11 | core/src/index.ts | FTS syntax queries get no OR fallback | killed |
| Y12 | core/src/fuzzy.ts | the fallback ORs the words instead of ANDing them | killed |
| Y13 | core/src/fuzzy.ts | the OR query includes the near spellings | killed |
| Y14 | core/src/index.ts | the note names the words that were searched | killed |
| Y15 | core/src/index.ts | near and OR hits share the EXTRA cap | killed |

## from "user" keeps only what the user typed (2026-10-26): 14/14 killed
Test command: `node --test core/test/authors.test.ts core/test/store.test.ts` (mutants in core/test/mutants.fromuser.json). U14 (forgetSession clears stale authors) survived at first. The forget test left no typed item on a seq that a stale row could hide. The test now puts a plugin turn before a typed one, so the typed one moves onto the old seq of the plugin turn. The core `from` mutants (core/test/mutants.from.json) still give 15/15 killed with their own command.

| id | file | guard | result |
|---|---|---|---|
| U01 | core/src/index.ts | from user drops subagent briefs | killed |
| U02 | core/src/index.ts | from user drops items in authors | killed |
| U03 | core/src/ingest.ts | a compaction summary is marked compact | killed |
| U04 | core/src/ingest.ts | a claude -p turn is marked oneshot | killed |
| U05 | core/src/ingest.ts | a non-human origin is marked, a human one is not | killed |
| U06 | core/src/ingest.ts | syncClaude carries the author of a user turn | killed |
| U07 | core/src/index.ts | a oneShot user item is marked oneshot | killed |
| U08 | core/src/index.ts | ingest records authors | killed |
| U09 | core/src/index.ts | an old store relabels at open | killed |
| U10 | core/src/index.ts | the relabel runs once, never on a store that has the table | killed |
| U11 | core/src/index.ts | the relabel matches the record uuid without the part suffix | killed |
| U12 | core/src/index.ts | the relabel finds a session's transcript by file name | killed |
| U13 | core/src/index.ts | forgetSession keeps authors on the new seqs | killed |
| U14 | core/src/index.ts | forgetSession clears stale authors before re-ingest | killed |
