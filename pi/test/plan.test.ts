import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble, bytesFrom, chooseCut, chooseFold, plan, safeCut, toolCallIds, type Msg, type Seq } from "../src/plan.ts";

const user = (t: string): Msg => ({ role: "user", content: [{ type: "text", text: t }], timestamp: 1 });
const asst = (t: string, calls: string[] = []): Msg => ({
	role: "assistant",
	content: [...(t ? [{ type: "text", text: t }] : []), ...calls.map((id) => ({ type: "toolCall", id, name: "bash", arguments: {} }))],
	timestamp: 1,
});
const result = (id: string, t = "ok"): Msg => ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text: t }], isError: false, timestamp: 1 });

// Every toolResult in `out` has its toolCall earlier in `out`.
function pairsIntact(out: Msg[]): boolean {
	const seen = new Set<string>();
	for (const m of out) {
		for (const id of toolCallIds(m)) seen.add(id);
		if (m.role === "toolResult" && !seen.has(m.toolCallId as string)) return false;
	}
	return true;
}

const msgs: Msg[] = [
	user("u0"), // 0  seq 0
	asst("a1", ["c1"]), // 1  seq 1 (text), c1 -> 2
	result("c1"), // 2  seq 2
	asst("a3"), // 3  seq 3
	user("u4"), // 4  seq 4 (seq 5 is another session's item)
	asst("", ["c2"]), // 5  seq 6 (only a toolCall: the tool item's seq)
	result("c2"), // 6  seq 6
	asst("a7"), // 7  seq 7
	user("u8 in flight"), // 8  not synced yet
];
const seqs: Seq[] = [0, 1, 2, 3, 4, 6, 6, 7, undefined];

test("view message first, then the raw tail from tailStart", () => {
	const cut = chooseCut(msgs, seqs, 4);
	assert.equal(cut, 4);
	const out = assemble("<memory>\n#0-3|x\n</memory>", msgs, cut);
	assert.equal(out[0].role, "user");
	assert.match((out[0].content as any)[0].text, /^<memory>/);
	assert.equal(out[0].timestamp, 0);
	assert.deepEqual(out.slice(1), msgs.slice(4));
});

test("messages without a seq (in flight) always stay in the tail", () => {
	assert.equal(chooseCut(msgs, seqs, 100), 8);
	assert.deepEqual(assemble("v", msgs, chooseCut(msgs, seqs, 100)).slice(1), [msgs[8]]);
});

test("a cut that would land on a toolResult moves back to its toolCall", () => {
	// tailStart 2: seq 1 (index 1) is the last before it, so the naive cut is 2 = result(c1).
	assert.equal(chooseCut(msgs, seqs, 2), 1);
	assert.equal(safeCut(msgs, 2), 1);
	assert.ok(pairsIntact(assemble("v", msgs, chooseCut(msgs, seqs, 2)).slice(1)));
});

test("Pi's own compaction summary is dropped wherever it sits", () => {
	const withSummary: Msg[] = [{ role: "compactionSummary", summary: "old", timestamp: 1 } as Msg, ...msgs.slice(4)];
	const s: Seq[] = [undefined, ...seqs.slice(4)];
	const out = assemble("v", withSummary, chooseCut(withSummary, s, 4));
	assert.ok(out.every((m) => m.role !== "compactionSummary"));
	assert.equal(out.length, 1 + 5);
});

test("fold picks a user message, leaves <= TAIL/2 raw, never splits a pair", () => {
	const big = "x".repeat(1000);
	const m: Msg[] = [user("u0"), asst(big, ["c1"]), result("c1", big), user("u3"), asst(big, ["c2"]), result("c2", big), user("u6"), asst("short")];
	const s: Seq[] = [0, 1, 2, 3, 4, 5, 6, 7];
	const p = plan(m, s, 0, 3000);
	assert.ok(p.tailBytes > 3000);
	assert.ok(p.fold);
	assert.equal(m[p.fold!.index].role, "user");
	assert.equal(p.fold!.seq, s[p.fold!.index]);
	assert.equal(p.fold!.index, 6);
	assert.ok(bytesFrom(m, 6) <= 1500); // leaves <= TAIL/2 raw
	assert.ok(bytesFrom(m, 3) > 1500); // and the earlier boundary would not have
});

test("no fold below TAIL", () => {
	assert.equal(plan(msgs, seqs, 0, 1 << 20).fold, undefined);
});

test("fold falls back to the latest boundary when none leaves TAIL/2", () => {
	const big = "y".repeat(5000);
	const m: Msg[] = [user("u0"), asst(big), user("u2"), asst(big)];
	const p = plan(m, [0, 1, 2, 3], 0, 3000);
	assert.equal(p.fold!.index, 2);
});

test("fold never targets an unsynced user message", () => {
	const big = "z".repeat(5000);
	const m: Msg[] = [user("u0"), asst(big), user("u2 unsynced"), asst(big)];
	assert.equal(chooseFold(m, [0, 1, undefined, undefined], 0, 0, 100), undefined);
});

// Seeded property test: random Pi-shaped transcripts; any cut or fold keeps tool pairs whole.
function prng(seed: number) {
	return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
test("property: cut and fold never split a toolCall from its toolResult (500 runs)", () => {
	const r = prng(42);
	for (let run = 0; run < 500; run++) {
		const m: Msg[] = [];
		const s: Seq[] = [];
		let seq = 0;
		let callN = 0;
		const turns = 1 + Math.floor(r() * 8);
		for (let t = 0; t < turns; t++) {
			m.push(user(`u${t}`)); s.push(seq++);
			const steps = Math.floor(r() * 4);
			for (let k = 0; k < steps; k++) {
				const calls = Array.from({ length: 1 + Math.floor(r() * 3) }, () => `c${callN++}`);
				m.push(asst(r() < 0.5 ? "t".repeat(Math.floor(r() * 400)) : "", calls));
				const first = seq;
				s.push(first);
				for (const id of calls) { m.push(result(id, "o".repeat(Math.floor(r() * 2000)))); s.push(seq++); }
				if (r() < 0.3) seq++; // another session's item interleaves
			}
			m.push(asst("done")); s.push(seq++);
		}
		// the last turn is in flight with probability 1/2
		if (r() < 0.5) for (let i = s.length - 1; i >= 0 && m[i].role !== "user"; i--) s[i] = undefined;
		const tailStart = Math.floor(r() * (seq + 1));
		const tail = 500 + Math.floor(r() * 8000);
		const p = plan(m, s, tailStart, tail);
		assert.ok(pairsIntact(assemble("v", m, p.cut).slice(1)), `run ${run}: cut split a pair`);
		if (p.fold) {
			assert.equal(m[p.fold.index].role, "user", `run ${run}`);
			assert.ok(p.fold.seq >= tailStart, `run ${run}: fold went backwards`);
			const after = chooseCut(m, s, p.fold.seq);
			assert.ok(pairsIntact(assemble("v", m, after).slice(1)), `run ${run}: fold split a pair`);
			assert.ok(after <= p.fold.index, `run ${run}: fold dropped the boundary message`);
		}
	}
});

test("fold skips a user message that sits inside a tool pair (defensive: steering mid-batch)", () => {
	const big = "w".repeat(5000);
	const m: Msg[] = [user("u0"), asst("", ["c1"]), user("steer"), result("c1", big), user("u4"), asst("x")];
	const b = chooseFold(m, [0, 1, 2, 1, 4, 5], 0, 0, 100);
	assert.equal(b, 4);
});
