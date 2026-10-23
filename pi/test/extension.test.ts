// The extension against a fake Pi host and a fake store (core-shaped, SPEC §8).
// Proves the wiring: view first + tail, fold, compaction, disable switch, fail open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExtension, piUuid, type Core, type Store, type View } from "../src/extension.ts";
import type { Msg } from "../src/plan.ts";

type Handler = (e: any, ctx: any) => any;
function fakePi() {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, any>();
	return {
		handlers, tools,
		on(ev: string, h: Handler) { handlers.set(ev, [...(handlers.get(ev) ?? []), h]); },
		registerTool(t: any) { tools.set(t.name, t); },
		emit(ev: string, e: any, ctx: any) { return (handlers.get(ev) ?? []).map((h) => h(e, ctx))[0]; },
	};
}

// A transcript: entries with ids, messages with distinct timestamps.
const SESSION = "s-1";
let ts = 1000;
const E = (id: string, message: Msg) => ({ type: "message", id, message: { ...message, timestamp: ts++ } });
const user = (t: string) => ({ role: "user", content: [{ type: "text", text: t }] });
const asst = (t: string, calls: string[] = []) => ({ role: "assistant", content: [...(t ? [{ type: "text", text: t }] : []), ...calls.map((id) => ({ type: "toolCall", id, name: "bash", arguments: { command: "ls" } }))] });
const result = (id: string, t: string) => ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text: t }], isError: false });

function fakeStore(seqByUuid: Map<string, number>, opts: { throwOn?: string } = {}) {
	const calls: string[] = [];
	let tailStart = 0;
	const block = () => `<memory>\n#0-${Math.max(0, tailStart - 1)}|summary up to ${tailStart}\n</memory>`;
	const s: Store & { calls: string[] } = {
		calls, root: "/r", dbPath: "/r/store.db",
		syncPi(f) { calls.push(`syncPi ${path.basename(f)}`); return { added: 0 }; },
		seqOf(h, sess, uuid) { if (opts.throwOn === "seqOf") throw new Error("boom"); return h === "pi" && sess === SESSION ? seqByUuid.get(uuid) : undefined; },
		view(h, sess): View {
			calls.push("view");
			if (opts.throwOn === "view") throw new Error("database is locked");
			return { block: block(), viewEnd: tailStart, tailStart, bytes: block().length, root: "r", algedonic: false };
		},
		fold(h, sess, t) { calls.push(`fold ${t}`); tailStart = t; },
		zoom: (ref) => `zoom ${ref}`, search: (q) => `search ${q}`, pin: () => 7, unpin: () => {}, pins: () => "<pinned></pinned>",
		pending: () => [], put: () => true,
		status: () => ({ items: 9, nodes: 9, pending: 0, pins: 0, algedonic: false, root: "r" }),
		close() {},
	};
	return s;
}

function setup(env: Record<string, string> = {}, storeOpts: { throwOn?: string } = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), "cyth-pi-"));
	const file = path.join(dir, "session.jsonl");
	writeFileSync(file, "");
	const big = "x".repeat(3000);
	const entries = [
		E("e0", user("first task")),
		E("e1", asst("looking", ["c1"])),
		E("e2", result("c1", big)),
		E("e3", asst("done one")),
		E("e4", user("second task")),
		E("e5", asst("", ["c2"])),
		E("e6", result("c2", big)),
		E("e7", asst("done two")),
		E("e8", user("third task")), // in flight: no seq
	];
	const seq = new Map<string, number>([
		[piUuid("e0", 0), 0], [piUuid("e1", 0), 1], ["c1", 2], [piUuid("e3", 0), 3],
		[piUuid("e4", 0), 4], ["c2", 6], [piUuid("e7", 0), 7],
	]);
	const store = fakeStore(seq, storeOpts);
	const core: Core = { openStore: () => store };
	const pi = fakePi();
	createExtension(pi, { core, env: { CYTH_TAIL: "4000", ...env } });
	const notes: string[] = [];
	const ctx = {
		cwd: dir, hasUI: true,
		ui: { notify: (m: string) => notes.push(m), setStatus: () => {} },
		sessionManager: { getSessionId: () => SESSION, getSessionFile: () => file, getBranch: () => entries },
	};
	// Pi hands the context hook clones of the entry messages.
	const messages = () => structuredClone(entries.map((e) => e.message)) as Msg[];
	return { pi, ctx, store, entries, messages, notes };
}

const texts = (out: Msg[]) => out.map((m) => `${m.role}:${(m.content as any[]).map((b) => b.text ?? b.id).join("+").slice(0, 24)}`);

test("context: one view message first, then the tail; folds past TAIL at a user message", () => {
	const { pi, ctx, store, messages } = setup();
	const r = pi.emit("context", { messages: messages() }, ctx);
	assert.ok(r?.messages);
	const out = r.messages as Msg[];
	console.log("transformed:", JSON.stringify(texts(out)));
	assert.equal(out[0].role, "user");
	assert.match((out[0].content as any)[0].text, /^<memory>/);
	// ~6.1 KB raw > TAIL 4000: fold to the earliest user boundary leaving <= 2000 B raw = e8 is
	// unsynced, so the latest synced boundary e4 (seq 4) wins.
	assert.deepEqual(store.calls.filter((c) => c.startsWith("fold")), ["fold 4"]);
	assert.equal(out.length, 1 + 5);
	assert.equal((out[1].content as any)[0].text, "second task");
	// view before sync (a new session's tailStart is fixed before its messages land)
	assert.deepEqual(store.calls.slice(0, 2), ["view", "syncPi session.jsonl"]);
});

test("context: view block bytes stable between folds", () => {
	const { pi, ctx, messages } = setup();
	const a = pi.emit("context", { messages: messages() }, ctx).messages[0];
	const b = pi.emit("context", { messages: messages() }, ctx).messages[0];
	assert.deepEqual(a, b);
});

test("context: a tool pair is never split even when tailStart points inside it", () => {
	const { pi, ctx, store, messages } = setup({ CYTH_TAIL: String(1 << 20) });
	store.fold("pi", SESSION, 2); // tailStart = 2 = c1's tool item; its call is in e1 (seq 1)
	const out = pi.emit("context", { messages: messages() }, ctx).messages as Msg[];
	assert.equal(out[1].role, "assistant");
	assert.equal((out[1].content as any[])[1].id, "c1");
	assert.equal(out[2].role, "toolResult");
});

test("CYTH_DISABLE=1: no context, compaction or tool handlers at all", () => {
	const { pi } = setup({ CYTH_DISABLE: "1" });
	assert.equal(pi.handlers.has("context"), false);
	assert.equal(pi.handlers.has("session_before_compact"), false);
	assert.equal(pi.tools.size, 0);
});

test("fail open: a core error returns nothing (Pi native) and notifies once", () => {
	const { pi, ctx, messages, notes } = setup({}, { throwOn: "view" });
	assert.equal(pi.emit("context", { messages: messages() }, ctx), undefined);
	assert.equal(pi.emit("context", { messages: messages() }, ctx), undefined);
	assert.equal(pi.emit("session_before_compact", { branchEntries: [], preparation: { tokensBefore: 1 } }, ctx), undefined);
	assert.equal(notes.length, 1);
	assert.match(notes[0], /database is locked/);
});

test("fail open: no core at all -> hooks return nothing, one notify at session start", () => {
	const pi = fakePi();
	createExtension(pi, { coreError: new Error("Cannot find module core"), env: {} });
	const notes: string[] = [];
	const ctx = { cwd: "/", ui: { notify: (m: string) => notes.push(m) }, sessionManager: { getSessionId: () => "x", getSessionFile: () => "/nonexistent", getBranch: () => [] } };
	pi.emit("session_start", {}, ctx);
	assert.equal(pi.emit("context", { messages: [] }, ctx), undefined);
	assert.equal(pi.emit("before_agent_start", { systemPrompt: "base" }, ctx), undefined);
	assert.equal(notes.length, 1);
});

test("--no-session: context stays native", () => {
	const { pi, ctx, messages } = setup();
	ctx.sessionManager.getSessionFile = () => undefined as any;
	assert.equal(pi.emit("context", { messages: messages() }, ctx), undefined);
});

test("session_before_compact: our compaction, view as summary, first tail entry kept", () => {
	const { pi, ctx, store, entries } = setup({ CYTH_TAIL: String(1 << 20) });
	const r = pi.emit("session_before_compact", { branchEntries: entries, preparation: { tokensBefore: 1234 }, reason: "threshold" }, ctx);
	assert.equal(r.cancel, undefined);
	assert.match(r.compaction.summary, /^<memory>/);
	assert.equal(r.compaction.tokensBefore, 1234);
	// forced fold even under TAIL: target = tailBytes/2 -> latest synced boundary e4
	assert.deepEqual(store.calls.filter((c) => c.startsWith("fold")), ["fold 4"]);
	assert.equal(r.compaction.firstKeptEntryId, "e4");
});

test("before_agent_start: no system-prompt contract (the view block carries it)", () => {
	const { pi, ctx } = setup();
	assert.equal(pi.emit("before_agent_start", { systemPrompt: "base" }, ctx), undefined);
});

test("tools: five memory tools, thin calls into core", async () => {
	const { pi, ctx } = setup();
	assert.deepEqual([...pi.tools.keys()].sort(), ["memory_find", "memory_pin", "memory_pins", "memory_unpin", "memory_zoom"]);
	const r = await pi.tools.get("memory_zoom").execute("id", { ref: "#0-3" }, undefined, undefined, ctx);
	assert.equal(r.content[0].text, "zoom #0-3");
	const p = await pi.tools.get("memory_pin").execute("id", { ref: "#4", reason: "r" }, undefined, undefined, ctx);
	assert.equal(p.content[0].text, "pinned as 7");
});

test("summaries: pending -> model -> put, retry once when too long, drained in batches", async () => {
	const { pi, ctx, store } = setup({ CYTH_SUMMARY_BATCH: "2" });
	const jobs = [{ ref: "#0-1", prompt: "p0" }, { ref: "#2-3", prompt: "p1" }, { ref: "#4-5", prompt: "p2" }];
	const puts: [string, string][] = [];
	const done = new Set<string>();
	store.pending = (n) => jobs.filter((j) => !done.has(j.ref)).slice(0, n);
	store.put = (ref, t) => { puts.push([ref, t]); done.add(ref); return true; };
	const asked: string[] = [];
	(ctx as any).model = { provider: "deepseek", id: "flash" };
	(ctx as any).modelRegistry = {
		getAvailable: () => [{ provider: "deepseek", id: "pro", cost: { input: 2, output: 2 } }, { provider: "deepseek", id: "flash", cost: { input: 1, output: 1 } }, { provider: "openai", id: "cheap", cost: { input: 0, output: 0 } }],
		complete: async (model: any, c: any) => {
			const prompt = c.messages[0].content[0].text as string;
			asked.push(`${model.id}:${prompt.slice(0, 2)}`);
			const long = prompt.startsWith("p0");
			return { content: [{ type: "text", text: long ? "L".repeat(600) : `sum of ${prompt.slice(0, 2)}` }], stopReason: "stop" };
		},
	};
	pi.emit("agent_end", { messages: [] }, ctx);
	await new Promise((r) => setTimeout(r, 20));
	// cheapest same-provider; one retry; batch of 2, then a second round for the rest
	assert.deepEqual(asked, ["flash:p0", "flash:p0", "flash:p1", "flash:p2"]);
	assert.deepEqual(puts, [["#2-3", "sum of p1"], ["#4-5", "sum of p2"]]); // p0 stayed too long: clip kept, not put
});

function backlog(ctx: any, store: any, n: number, putOk = true) {
	let left = n;
	let puts = 0;
	store.pending = (k: number) => Array.from({ length: Math.min(k, left) }, (_, i) => ({ ref: `#${puts}-${i}`, prompt: "p" }));
	store.put = () => { puts++; if (putOk) left--; return putOk; };
	ctx.model = { provider: "deepseek", id: "flash" };
	ctx.modelRegistry = { getAvailable: () => [], complete: async () => ({ content: [{ type: "text", text: "s" }], stopReason: "stop" }) };
	return () => puts;
}

test("summaries: a drain stops at 8 rounds", async () => {
	const { pi, ctx, store } = setup();
	const puts = backlog(ctx, store, 1000);
	pi.emit("agent_end", { messages: [] }, ctx);
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(puts(), 32);
});

test("summaries: a round that lands nothing ends the drain", async () => {
	const { pi, ctx, store } = setup();
	const puts = backlog(ctx, store, 1000, false);
	pi.emit("agent_end", { messages: [] }, ctx);
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(puts(), 4);
});

test("summaries: session_start drains the backlog", async () => {
	const { pi, ctx, store } = setup();
	const puts = backlog(ctx, store, 5);
	pi.emit("session_start", {}, ctx);
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(puts(), 5);
});
