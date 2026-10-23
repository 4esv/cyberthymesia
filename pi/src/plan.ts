// plan: the pure half of the Pi adapter. Given the messages Pi is about to send and
// the store seq of each one, decide where the raw tail starts (SPEC §3 Tail) and
// where to fold (SPEC §3 Fold). No I/O, no Pi, no core: unit-tested on its own.
//
// Message shapes (Pi 1.0.4, AgentMessage):
//   user        { role, content: string | Block[], timestamp }
//   assistant   { role, content: Block[] (text | thinking | toolCall{id,name,arguments}), ... }
//   toolResult  { role, toolCallId, toolName, content: Block[], isError, timestamp }
//   others      compactionSummary | branchSummary | bashExecution | custom: no store item.

export type Block = { type: string; text?: string; id?: string; [k: string]: unknown };
export type Msg = { role: string; content?: string | Block[]; toolCallId?: string; timestamp?: number; [k: string]: unknown };
export type Seq = number | undefined;

// Pi's own summaries of history: the view replaces them, wherever they sit.
export const DROP_ROLES = new Set(["compactionSummary", "branchSummary"]);

export function blocks(m: Msg): Block[] {
	if (typeof m.content === "string") return [{ type: "text", text: m.content }];
	return Array.isArray(m.content) ? m.content : [];
}

export function toolCallIds(m: Msg): string[] {
	if (m.role !== "assistant") return [];
	return blocks(m).filter((b) => b.type === "toolCall" && typeof b.id === "string").map((b) => b.id as string);
}

// Bytes the model sees for a message, near enough for a budget (content only, thinking included:
// providers resend it).
export function msgBytes(m: Msg): number {
	return Buffer.byteLength(JSON.stringify(m.content ?? ""), "utf8") + 16;
}

export function bytesFrom(msgs: Msg[], from: number): number {
	let n = 0;
	for (let i = from; i < msgs.length; i++) if (!DROP_ROLES.has(msgs[i].role)) n += msgBytes(msgs[i]);
	return n;
}

// Move `cut` back until no toolResult at or after it answers a toolCall before it.
// A call and its result are never split (SPEC §1, §3 Fold).
export function safeCut(msgs: Msg[], cut: number): number {
	for (;;) {
		const callAt = new Map<string, number>();
		for (let i = 0; i < cut; i++) for (const id of toolCallIds(msgs[i])) callAt.set(id, i);
		let next = cut;
		for (let i = cut; i < msgs.length; i++) {
			const m = msgs[i];
			if (m.role === "toolResult" && typeof m.toolCallId === "string") {
				const at = callAt.get(m.toolCallId);
				if (at !== undefined && at < next) next = at;
			}
		}
		if (next === cut) return cut;
		cut = next;
	}
}

// Where the raw tail starts: just after the last message whose store seq is before
// tailStart. Messages with no seq yet (unsynced, in flight) sit after it by construction.
export function chooseCut(msgs: Msg[], seqs: Seq[], tailStart: number): number {
	let cut = 0;
	for (let i = 0; i < msgs.length; i++) {
		const s = seqs[i];
		if (s !== undefined && s < tailStart) cut = i + 1;
	}
	return safeCut(msgs, cut);
}

// A fold target: the earliest user message after `cut` that leaves at most `target`
// bytes raw, is already in the store (has a seq), and does not split a tool pair.
// If none leaves that little, the latest such boundary. Undefined if there is none.
export function chooseFold(msgs: Msg[], seqs: Seq[], cut: number, tailStart: number, target: number): number | undefined {
	let latest: number | undefined;
	for (let b = cut + 1; b < msgs.length; b++) {
		const s = seqs[b];
		if (msgs[b].role !== "user" || s === undefined || s < tailStart) continue;
		if (safeCut(msgs, b) !== b) continue;
		if (bytesFrom(msgs, b) <= target) return b;
		latest = b;
	}
	return latest;
}

export type Plan = { cut: number; tailBytes: number; fold?: { index: number; seq: number } };

// The whole decision for one model call.
export function plan(msgs: Msg[], seqs: Seq[], tailStart: number, tail: number): Plan {
	const cut = chooseCut(msgs, seqs, tailStart);
	const tailBytes = bytesFrom(msgs, cut);
	if (tailBytes <= tail) return { cut, tailBytes };
	const b = chooseFold(msgs, seqs, cut, tailStart, Math.floor(tail / 2));
	if (b === undefined) return { cut, tailBytes };
	return { cut, tailBytes, fold: { index: b, seq: seqs[b] as number } };
}

// The view block as one user message. Constant timestamp: nothing in it may change
// between folds (prompt cache).
export function viewMessage(block: string): Msg {
	return { role: "user", content: [{ type: "text", text: block }], timestamp: 0 };
}

// [view] + raw tail, Pi's own summaries dropped.
export function assemble(block: string, msgs: Msg[], cut: number): Msg[] {
	return [viewMessage(block), ...msgs.slice(cut).filter((m) => !DROP_ROLES.has(m.role))];
}
