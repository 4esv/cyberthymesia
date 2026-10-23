// cyberthymesia for Pi: every chat goes forever (SPEC §9 pi).
//
//  ingest     syncPi(session file) before each model call and at agent_end. The file is Pi's
//             own record (entry ids are stable), so re-runs, resumes and backfill agree on uuids.
//  context    every model call: [one user message = view block] + this session's raw tail.
//             When the tail passes TAIL, fold at a user message (never inside a tool pair).
//  compact    session_before_compact returns OUR compaction (view block as the summary,
//             first tail entry kept): Pi's summarizer never runs, and an overflow still retries.
//  tools      memory_zoom / memory_find / memory_pin / memory_unpin / memory_pins.
//  summaries  agent_end: pending(N) -> cheapest model -> put. Background, one batch at a time.
//  fail open  any error -> the hook returns nothing (Pi's native context) + one notify.
//             CYTH_DISABLE=1 -> nothing is registered beyond a status line.
//
// No runtime import of @earendil-works/*: the host API is described structurally (as
// compact-bash.ts / fleet-bar.ts do), and model calls go through ctx.modelRegistry.

import { existsSync } from "node:fs";
import { assemble, bytesFrom, chooseCut, chooseFold, plan, toolCallIds, blocks, type Msg, type Seq } from "./plan.ts";

// ---- core (SPEC §8), structurally ------------------------------------------------------------

export type View = { block: string; viewEnd: number; tailStart: number; bytes: number; root: string; algedonic: boolean };
export type Store = {
	root: string;
	dbPath: string;
	syncPi(sessionPath: string): { added: number };
	seqOf(harness: string, session: string, uuid: string): number | undefined;
	view(harness: string, session: string, opts?: { high?: number; tail?: number; tailStart?: number }): View;
	fold(harness: string, session: string, tailStart: number): void;
	zoom(ref: string): string;
	search(q: string, opts?: { regex?: boolean; limit?: number }): string;
	pin(ref: string, reason: string): number;
	unpin(id: number): void;
	pins(): string;
	pending(limit: number): { ref: string; prompt: string }[];
	put(ref: string, text: string): boolean;
	status(): { items: number; nodes: number; pending: number; pins: number; algedonic: boolean; root: string };
	close(): void;
};
export type Core = { openStore(cwd: string, opts?: { home?: string }): Store };

// ---- Pi host, structurally ---------------------------------------------------------------------

type Entry = { type: string; id: string; message?: Msg };
type Model = { provider: string; id: string; api?: string; cost?: { input?: number; output?: number }; input?: string[] };
type Ctx = {
	cwd: string;
	hasUI?: boolean;
	ui?: { notify?: (msg: string, level: string) => void; setStatus?: (key: string, text: string | undefined) => void };
	model?: Model;
	modelRegistry?: {
		find?(provider: string, id: string): Model | undefined;
		getAvailable?(): Model[];
		complete?(model: Model, context: unknown, options?: unknown): Promise<{ content?: Block[]; stopReason?: string; errorMessage?: string }>;
	};
	sessionManager: { getSessionId(): string; getSessionFile(): string | undefined; getBranch(): Entry[] };
};
type Block = { type: string; text?: string };
type ToolResult = { content: { type: "text"; text: string }[]; details: unknown };
type Tool = {
	name: string; label: string; description: string; promptSnippet?: string; parameters: unknown;
	execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, ctx: Ctx): Promise<ToolResult>;
};
export type Pi = {
	on(event: string, handler: (event: any, ctx: Ctx) => unknown): unknown;
	registerTool?(tool: Tool): void;
};

// ---- constants -----------------------------------------------------------------------------------

export const HARNESS = "pi";
const NODE = 512;
const STATUS_KEY = "cyth";

// SPEC §7, verbatim. Appended to the system prompt; never changes, so it never breaks the cache.
export const CONTRACT = `## Memory: cyberthymesia
This conversation never ends; nothing is ever lost. <memory> lists the project's
whole history as a binary tree of one-line summaries, oldest first: \`#a-b|...\`
covers items a..b, \`#n|...\` is one item. Detail fades with age. The raw messages
after it are the recent present, verbatim.
- The latest word on a thing is the truth. Before you act, guess or ask about
  anything past, find it in <memory> and zoom until you have it whole.
- memory_zoom(ref): open #a-b into its halves; #n gives the item whole (paged).
- memory_find(query): full-text search over every item, verbatim.
- memory_pin(ref, reason) / memory_unpin(id): keep something at full resolution.
- <pinned> items are alarms and standing orders: obey them until resolved.
- Summaries keep little of tool output: say in your reply what you learned that matters later.`;

const SUMMARY_SYSTEM = "You compress conversation records into one line. Output only that line.";

type Env = Record<string, string | undefined>;
const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : undefined);

export type Deps = { core?: Core; coreError?: unknown; env?: Env };

// Pi uuid per SPEC §1: entry id + block index; tool items keyed by toolCallId.
export function piUuid(entryId: string, block: number): string {
	return `${entryId}:${block}`;
}

export function createExtension(pi: Pi, deps: Deps): void {
	const env = deps.env ?? process.env;
	const disabled = env.CYTH_DISABLE === "1";
	const high = num(env.CYTH_HIGH);
	const tail = num(env.CYTH_TAIL) ?? 160 * 1024;
	const batch = num(env.CYTH_SUMMARY_BATCH) ?? 4;
	const home = env.CYTH_HOME || undefined;

	const status = (ctx: Ctx, text: string | undefined) => {
		try { ctx.ui?.setStatus?.(STATUS_KEY, text); } catch { /* UI is optional */ }
	};

	if (disabled) {
		pi.on("session_start", (_e, ctx) => status(ctx, "cyth: off (CYTH_DISABLE=1)"));
		return;
	}

	let store: Store | undefined;
	let storeCwd = "";
	let notified = false;
	let algedonicNotified = false;
	let summarizing = false;
	const failedRefs = new Set<string>();
	const seqCache = new Map<string, number>(); // `${session}\0${uuid}` -> seq; seqs never change

	const getStore = (cwd: string): Store => {
		if (!deps.core) throw new Error(`core unavailable: ${String((deps.coreError as Error)?.message ?? deps.coreError)}`);
		if (store && storeCwd === cwd) return store;
		try { store?.close(); } catch { /* ignore */ }
		store = deps.core.openStore(cwd, home ? { home } : undefined);
		storeCwd = cwd;
		seqCache.clear();
		return store;
	};

	const failOpen = (ctx: Ctx, where: string, err: unknown) => {
		const msg = err instanceof Error ? err.message : String(err);
		status(ctx, `cyth: error (native ${where})`);
		if (notified) return;
		notified = true;
		try { ctx.ui?.notify?.(`cyberthymesia: ${where} failed, using Pi's native behaviour: ${msg}`, "warning"); } catch { /* ignore */ }
	};

	const showStatus = (ctx: Ctx, s: Store) => {
		const st = s.status();
		status(ctx, `${st.algedonic ? "ALGEDONIC · " : ""}cyth ${st.items} items · ${st.pending} pending · ${st.pins} pins`);
		if (st.algedonic && !algedonicNotified) {
			algedonicNotified = true;
			try { ctx.ui?.notify?.("cyberthymesia: ALGEDONIC: pins over quota; review with memory_pins", "warning"); } catch { /* ignore */ }
		}
	};

	const sync = (s: Store, ctx: Ctx) => {
		const file = ctx.sessionManager.getSessionFile();
		if (file && existsSync(file)) s.syncPi(file); // Pi writes the file once the first user message exists
	};

	// The store seq of a message: the smallest seq of any item it produced; undefined if none yet.
	const seqOfMessage = (s: Store, session: string, m: Msg, entryId: string | undefined): Seq => {
		const look = (uuid: string): Seq => {
			const k = `${session}\0${uuid}`;
			const hit = seqCache.get(k);
			if (hit !== undefined) return hit;
			const v = s.seqOf(HARNESS, session, uuid);
			if (v !== undefined) seqCache.set(k, v);
			return v;
		};
		const found: number[] = [];
		const add = (v: Seq) => { if (v !== undefined) found.push(v); };
		if (m.role === "toolResult" && typeof m.toolCallId === "string") add(look(m.toolCallId));
		if (m.role === "user" || m.role === "assistant") {
			if (entryId) blocks(m).forEach((_b, i) => add(look(piUuid(entryId, i))));
			for (const id of toolCallIds(m)) add(look(id));
		}
		return found.length ? Math.min(...found) : undefined;
	};

	// Map messages to entry ids via the branch (context messages are clones, so match by role+timestamp).
	const entryIndex = (entries: Entry[]) => {
		const byKey = new Map<string, string>();
		for (const e of entries) if (e.type === "message" && e.message) byKey.set(`${e.message.role}\0${e.message.timestamp}`, e.id);
		return (m: Msg) => byKey.get(`${m.role}\0${m.timestamp}`);
	};

	const viewOpts = () => ({ ...(high ? { high } : {}), tail });

	// ---- context: the view replaces history before every model call ----------------------------

	pi.on("context", (event: { messages: Msg[] }, ctx) => {
		try {
			const session = ctx.sessionManager.getSessionId();
			if (!ctx.sessionManager.getSessionFile()) return; // --no-session: nothing to ingest, stay native
			const s = getStore(ctx.cwd);
			// view before sync: a new session's tailStart is fixed before its own messages land,
			// so all of them stay raw (also true for a pi-subagents fork child: new id, copied entries).
			let v = s.view(HARNESS, session, viewOpts());
			sync(s, ctx);
			const msgs = event.messages;
			const idOf = entryIndex(ctx.sessionManager.getBranch());
			const seqs = msgs.map((m) => seqOfMessage(s, session, m, idOf(m)));
			let p = plan(msgs, seqs, v.tailStart, tail);
			if (p.fold) {
				s.fold(HARNESS, session, p.fold.seq);
				v = s.view(HARNESS, session, viewOpts());
				p = { cut: chooseCut(msgs, seqs, v.tailStart), tailBytes: 0 };
			}
			return { messages: assemble(v.block, msgs, p.cut) };
		} catch (err) {
			failOpen(ctx, "context", err);
			return undefined;
		}
	});

	// ---- compaction: ours, never Pi's summarizer -------------------------------------------------
	// Returning a compaction (not cancel): (1) an overflow compaction with willRetry still retries,
	// after we fold; cancel would fail the turn. (2) /compact becomes "fold now". (3) Pi's stored
	// summary is the view block, so a later fail-open or a session opened without the extension
	// still starts from the memory instead of from nothing. (4) Pi's in-memory history shrinks.
	// The context hook drops Pi's compactionSummary message, so the model never sees it twice.

	pi.on("session_before_compact", (event: { branchEntries: Entry[]; preparation?: { tokensBefore?: number }; reason?: string }, ctx) => {
		try {
			const session = ctx.sessionManager.getSessionId();
			if (!ctx.sessionManager.getSessionFile()) return undefined;
			const s = getStore(ctx.cwd);
			let v = s.view(HARNESS, session, viewOpts());
			sync(s, ctx);
			const entries = event.branchEntries.filter((e) => e.type === "message" && e.message);
			const msgs = entries.map((e) => e.message as Msg);
			const seqs = msgs.map((m, i) => seqOfMessage(s, session, m, entries[i].id));
			let cut = chooseCut(msgs, seqs, v.tailStart);
			const tailBytes = bytesFrom(msgs, cut);
			const b = chooseFold(msgs, seqs, cut, v.tailStart, Math.floor(Math.min(tail, tailBytes) / 2));
			if (b !== undefined) {
				s.fold(HARNESS, session, seqs[b] as number);
				v = s.view(HARNESS, session, viewOpts());
				cut = chooseCut(msgs, seqs, v.tailStart);
			}
			if (cut >= entries.length) {
				status(ctx, "cyth: compaction cancelled (no tail to keep)");
				return { cancel: true };
			}
			return {
				compaction: {
					summary: v.block,
					firstKeptEntryId: entries[cut].id,
					tokensBefore: event.preparation?.tokensBefore ?? 0,
					details: { cyberthymesia: { tailStart: v.tailStart, viewEnd: v.viewEnd, root: v.root, reason: event.reason } },
				},
			};
		} catch (err) {
			failOpen(ctx, "compaction", err);
			return undefined; // Pi's summarizer: the native behaviour
		}
	});

	// ---- contract in the system prompt ---------------------------------------------------------

	pi.on("before_agent_start", (event: { systemPrompt: string }) => {
		if (!deps.core) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${CONTRACT}` };
	});

	// ---- after each agent run: ingest, status, background summaries ------------------------------

	pi.on("agent_end", (_e, ctx) => {
		try {
			if (!ctx.sessionManager.getSessionFile()) return;
			const s = getStore(ctx.cwd);
			sync(s, ctx);
			showStatus(ctx, s);
			void summarize(ctx, s);
		} catch (err) {
			failOpen(ctx, "ingest", err);
		}
	});

	pi.on("session_start", (_e, ctx) => {
		if (!deps.core) { failOpen(ctx, "load", deps.coreError ?? "core missing"); return; }
		try { showStatus(ctx, getStore(ctx.cwd)); } catch (err) { failOpen(ctx, "open", err); }
	});

	pi.on("session_shutdown", () => {
		try { store?.close(); } catch { /* ignore */ }
		store = undefined;
	});

	// ---- summaries -------------------------------------------------------------------------------
	// Model pick and the fallback chain follow pi-lcm's callCompactionModel (MIT,
	// github.com/codexstar69/pi-lcm, src/index.ts): configured model first, then the session model.
	// Here: CYTH_SUMMARY_MODEL=provider/id, else the cheapest available model of the session's
	// provider (never another provider: no surprise bills), else the session model.

	const pickModels = (ctx: Ctx): Model[] => {
		const out: Model[] = [];
		const reg = ctx.modelRegistry;
		const want = env.CYTH_SUMMARY_MODEL;
		if (want && want.includes("/")) {
			const [prov, ...rest] = want.split("/");
			const m = reg?.find?.(prov, rest.join("/"));
			if (m) out.push(m);
		}
		if (ctx.model) {
			const cost = (m: Model) => (m.cost?.input ?? Infinity) + (m.cost?.output ?? Infinity);
			let avail: Model[] = [];
			try { avail = reg?.getAvailable?.() ?? []; } catch { /* ignore */ }
			const same = avail.filter((m) => m.provider === ctx.model!.provider && (!m.input || m.input.includes("text"))).sort((a, b) => cost(a) - cost(b));
			if (same[0]) out.push(same[0]);
			out.push(ctx.model);
		}
		return out.filter((m, i) => out.findIndex((o) => o.provider === m.provider && o.id === m.id) === i);
	};

	const ask = async (ctx: Ctx, models: Model[], prompt: string): Promise<string | undefined> => {
		for (const model of models) {
			try {
				const r = await ctx.modelRegistry!.complete!(model, {
					systemPrompt: SUMMARY_SYSTEM,
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				}, { maxTokens: 1024, signal: AbortSignal.timeout(60_000) });
				if (r.stopReason === "error" || r.stopReason === "aborted") continue;
				const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(" ").replace(/\s+/g, " ").trim();
				if (text) return text;
			} catch { /* next model */ }
		}
		return undefined;
	};

	const summarize = async (ctx: Ctx, s: Store) => {
		if (summarizing || !ctx.modelRegistry?.complete) return;
		summarizing = true;
		try {
			const jobs = s.pending(batch + failedRefs.size).filter((j) => !failedRefs.has(j.ref)).slice(0, batch);
			if (!jobs.length) return;
			const models = pickModels(ctx);
			if (!models.length) return;
			for (const job of jobs) {
				let text = await ask(ctx, models, job.prompt);
				if (text && Buffer.byteLength(text) > NODE) {
					const n = Buffer.byteLength(text);
					text = await ask(ctx, models, `${job.prompt}\n\nYour answer was:\n${text}\n\nToo long: ${n} bytes, limit 512. Cut the least valuable items.`);
				}
				// Over NODE twice, or rejected: the clip stays (SPEC §2), and we stop asking this run.
				let ok = false;
				if (text && Buffer.byteLength(text) <= NODE) {
					try { ok = s === store && s.put(job.ref, text); } catch { ok = false; }
				}
				if (!ok) failedRefs.add(job.ref);
				if (s !== store) return; // session ended or cwd changed mid-batch
			}
			showStatus(ctx, s);
		} catch {
			/* background: never surfaces */
		} finally {
			summarizing = false;
		}
	};

	// ---- tools -----------------------------------------------------------------------------------

	if (typeof pi.registerTool !== "function") return;
	const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], details: undefined });
	const tool = (name: string, description: string, parameters: unknown, run: (s: Store, p: any) => string) =>
		pi.registerTool!({
			name, label: name, description, parameters, promptSnippet: description,
			async execute(_id, params, _signal, _u, ctx) {
				return text(run(getStore(ctx.cwd), params ?? {})); // throws -> Pi reports an error result
			},
		});
	const str = (description: string) => ({ type: "string", description });

	tool("memory_zoom", "Open a memory ref: #a-b gives its two halves; #n gives item n whole, paged (#n@offset continues).",
		{ type: "object", properties: { ref: str("A ref from <memory>, e.g. #0-15, #7, #7@20000") }, required: ["ref"] },
		(s, p) => s.zoom(String(p.ref)));
	tool("memory_find", "Full-text search over every item of the project's history, verbatim, newest first.",
		{ type: "object", properties: {
			query: str("FTS5 query, or a regex when regex=true"),
			regex: { type: "boolean", description: "Treat query as a regular expression" },
			limit: { type: "integer", description: "Max hits (default 20)" },
		}, required: ["query"] },
		(s, p) => s.search(String(p.query), { regex: p.regex === true, limit: typeof p.limit === "number" ? p.limit : undefined }));
	tool("memory_pin", "Pin an item so it shows verbatim in <pinned> until unpinned.",
		{ type: "object", properties: { ref: str("Item ref, e.g. #42"), reason: str("Why it must stay at full resolution") }, required: ["ref", "reason"] },
		(s, p) => `pinned as ${s.pin(String(p.ref), String(p.reason))}`);
	tool("memory_unpin", "Resolve a pin by its id (see memory_pins).",
		{ type: "object", properties: { id: { type: "integer", description: "Pin id" } }, required: ["id"] },
		(s, p) => { s.unpin(Number(p.id)); return `unpinned ${Number(p.id)}`; });
	tool("memory_pins", "List all open pins (alarms and standing orders) with their ids.",
		{ type: "object", properties: {} },
		(s) => s.pins());
}
