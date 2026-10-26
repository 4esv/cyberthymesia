// The view (SPEC §3): a small fixed header, not a summary of the history.
// It is the contract, the <pinned> block and <recent>: the newest items
// before tailStart, one leaf line each, newest last, whole lines only, within
// a fixed byte budget. Everything older is reached with memory_find and
// memory_zoom. Pure: item lines come from a lookup.

import { bytes } from './util.ts'

export const CONTRACT = `## Memory: cyberthymesia
This project keeps a full log of every session, Claude Code and Pi alike. The log
holds each user message, assistant reply and tool call, verbatim. Searching it
is cheap.
<recent> is only the latest slice of that log, not the history. Older items are
not shown here, but they are in the log.
Each <recent> line is one item, oldest first: \`#n|\` then u: (user), a: (assistant)
or t: (tool). @c1234 or @p1234 names the Claude Code or Pi session where it changes.
A line ending in … is clipped. A tool line is a digest of the call.
The messages after this block are the recent part of this session, verbatim.
This block was built when this conversation started or last compacted. The tools
read the log as it is now.
- Before you undo, delete, revert or contradict earlier work, or raise something
  as open, undecided or a blocker, call memory_find. See why it is there and
  whether it was settled. Do the same before you say something is absent,
  unknown or not discussed.
- Decisions live in the user's own words. Search them with from "user".
- Try at least two phrasings. Use words the user would have used, not names you
  made up.
- Never ask the user to repeat context the log may hold. Find it instead.
- The latest word on a thing is the truth.
- memory_find(query, from?): full-text search over every item, newest first. from
  is user, assistant or tool and keeps only items of that kind. user means what
  the user typed, not a brief for a subagent or a one-shot run. Calls of these
  memory_* tools are left out of search and <recent>.
- memory_zoom(ref): #n gives item n whole, a tool call with its input and output.
  Long items are paged: #n@offset continues.
- memory_pin(ref, reason) / memory_unpin(id): keep an item in <pinned>, or release it.
- <pinned> holds user directives and unresolved tool failures, verbatim (first 1 KB)
  whatever their age. Follow them. If one is resolved or was flagged by mistake,
  say so and unpin it.`

// The line of item `seq`; `first` asks for its session tag even when the item
// before it is from the same session (the oldest line has no line above it).
export type LineOf = (seq: number, first: boolean) => string

// The newest lines before `end`, newest last, whole lines only, while their
// bytes (each line plus its '\n') stay <= budget. Items `skip` names (cyth's
// own tool calls) are not shown. Stops at the first line that does not fit, so
// the slice is contiguous over the shown items. The oldest line carries its tag.
export function recentLines(end: number, budget: number, lineOf: LineOf, skip: (seq: number) => boolean = () => false): string[] {
  const out: string[] = []
  let used = 0
  let oldest = -1
  for (let seq = end - 1; seq >= 0; seq--) {
    if (skip(seq)) continue
    const forced = lineOf(seq, true)
    if (used + bytes(forced) + 1 > budget) break
    const natural = lineOf(seq, false)
    out.push(natural)
    used += bytes(natural) + 1
    oldest = seq
  }
  if (out.length > 0) out[out.length - 1] = lineOf(oldest, true)
  return out.reverse()
}

export function recentBytes(lines: string[]): number {
  let n = 0
  for (const l of lines) n += bytes(l) + 1
  return n
}

export function renderRecent(lines: string[]): string {
  let s = '<recent>\n'
  for (const l of lines) s += l + '\n'
  return s + '</recent>\n'
}

export function renderBlock(pinned: string, recent: string[]): string {
  return CONTRACT + '\n\n' + pinned + renderRecent(recent)
}
