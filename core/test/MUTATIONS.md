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

## claude-code/hooks: 17/17 killed
Test command: `claude plugin test claude-code`

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
| M13 | claude-code/hooks/register.ts | contract not injected when disabled | killed |
| M14 | claude-code/hooks/register.ts | no after-turn work when disabled | killed |
| M15 | claude-code/hooks/register.ts | compaction threshold strict | killed |
| M16 | claude-code/hooks/tail.ts | pick respects clean cuts | killed |
| M17 | claude-code/hooks/register.ts | ingest failure surfaces a status line | killed |
