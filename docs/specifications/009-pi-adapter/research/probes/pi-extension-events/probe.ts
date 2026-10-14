// THROWAWAY research probe for spec 009 topic pi-extension-events. Not product code.
// A scripted fake provider plus an event recorder, with behaviours switched on by PROBE_FLAGS.
// Run only as the throwaway user squeal-e2e (see README.md).
import * as fs from "node:fs";
import * as net from "node:net";
import { createAssistantMessageEventStream, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = process.env.PROBE_LOG ?? "/tmp/probe.jsonl";
const PLAN: any[] = process.env.PROBE_PLAN ? JSON.parse(fs.readFileSync(process.env.PROBE_PLAN, "utf8")) : [];
const FLAGS = new Set((process.env.PROBE_FLAGS ?? "").split(",").filter(Boolean));
const QUIET = process.env.PROBE_QUIET === "1";
const MARK = /(INJECT|PRIMER|DENY|AGENTSMD|APPENDSP|SETTLE|SKILLMARK)-[\w.-]+/g;

const g = globalThis as any;
g.__probeFactoryRuns = (g.__probeFactoryRuns ?? 0) + 1;
let moduleState = 0;

function log(rec: Record<string, unknown>) {
	fs.appendFileSync(LOG, `${JSON.stringify({ t: Date.now(), hr: Number(process.hrtime.bigint() / 1000n), pid: process.pid, ...rec })}\n`);
}
const short = (s: unknown, n = 300) => (typeof s === "string" && s.length > n ? `${s.slice(0, n)}…(${s.length})` : s);
const texts = (content: any) =>
	typeof content === "string" ? content : (content ?? []).map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("");
const markers = (v: unknown) => [...new Set(JSON.stringify(v).match(MARK) ?? [])];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summariseMessage(m: any) {
	if (m.role === "system") return { role: "system", sections: m.sections ? Object.keys(m.sections) : undefined, len: texts(m.content).length };
	if (m.role === "assistant")
		return { role: "assistant", text: short(texts(m.content.filter((c: any) => c.type === "text")), 120), toolCalls: m.content.filter((c: any) => c.type === "toolCall").map((c: any) => c.name) };
	if (m.role === "toolResult") return { role: "toolResult", toolName: m.toolName, id: m.toolCallId, isError: m.isError, text: short(texts(m.content), 400) };
	return { role: m.role, customType: m.customType, text: short(texts(m.content), 400) };
}

let requestIndex = 0;

export default function (pi: ExtensionAPI) {
	log({ ev: "factory", factoryRuns: g.__probeFactoryRuns, flags: [...FLAGS], argv: process.argv.slice(2) });

	// ---- scripted fake provider ------------------------------------------------------------
	pi.registerProvider("fake", {
		baseUrl: "http://fake.invalid",
		apiKey: "not-a-credential",
		api: "fake-api",
		models: [{ id: "fake-1", name: "Fake 1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 4096 }],
		streamSimple: (model: any, context: any, options: any) => {
			const stream = createAssistantMessageEventStream();
			const n = requestIndex++;
			const step = PLAN[n] ?? { text: `plan exhausted at request ${n}` };
			const sp = getCurrentSystemPrompt(context.messages) ?? "";
			log({
				ev: "PROVIDER_REQUEST",
				n,
				messageCount: context.messages.length,
				systemPromptLen: sp.length,
				systemPromptMarkers: markers(sp),
				markers: markers(context.messages),
				tail: context.messages.slice(-6).map(summariseMessage),
			});
			(async () => {
				const output: any = {
					role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
					usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "pending", timestamp: Date.now(),
				};
				stream.push({ type: "start", partial: output });
				if (step.waitAbort) {
					await new Promise<void>((resolve) => {
						if (options?.signal?.aborted) return resolve();
						options?.signal?.addEventListener("abort", () => resolve());
					});
					output.stopReason = "aborted";
					output.errorMessage = "Request was aborted";
					log({ ev: "PROVIDER_ABORTED", n });
					stream.push({ type: "error", reason: "aborted", error: output });
					stream.end();
					return;
				}
				if (step.delayMs) await sleep(step.delayMs);
				if (step.text) {
					output.content.push({ type: "text", text: step.text });
					stream.push({ type: "text_start", contentIndex: 0, partial: output });
					stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: output });
				}
				for (const [i, call] of (step.tools ?? []).entries()) {
					const tc = { type: "toolCall", id: `call_${n}_${i}`, name: call.name, arguments: call.arguments };
					output.content.push(tc);
					const idx = output.content.length - 1;
					stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
					stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: tc, partial: output });
				}
				output.stopReason = step.tools?.length ? "toolUse" : "stop";
				stream.push({ type: "done", reason: output.stopReason, message: output });
				stream.end();
			})();
			return stream;
		},
	} as any);

	// ---- recorder ----------------------------------------------------------------------------
	const ctxInfo = (ctx: any) => {
		try {
			return { sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), cwd: ctx.cwd, mode: ctx.mode, idle: ctx.isIdle(), hasUI: ctx.hasUI, signal: !!ctx.signal };
		} catch (e) {
			return { ctxError: String(e) };
		}
	};
	const summarise = (e: any): Record<string, unknown> => {
		switch (e.type) {
			case "session_start": return { reason: e.reason, previousSessionFile: e.previousSessionFile };
			case "session_shutdown": return { reason: e.reason, targetSessionFile: e.targetSessionFile };
			case "before_agent_start": return { prompt: short(e.prompt), sections: Object.keys(e.systemPromptOptions?.sections ?? {}), appendSystemPromptLen: e.systemPromptOptions?.appendSystemPrompt?.length, contextFiles: e.systemPromptOptions?.contextFiles?.map((f: any) => f.path), skills: e.systemPromptOptions?.skills?.map((s: any) => s.name), systemPromptLen: e.systemPrompt.length };
			case "turn_start": return { turnIndex: e.turnIndex };
			case "turn_end": return { turnIndex: e.turnIndex, msg: summariseMessage(e.message), toolResults: e.toolResults.length, entries: e.entries, continue: e.continue, outcome: e.outcome, canContinue: e.context?.canContinue, pending: e.context?.pendingMessages?.length };
			case "agent_before_settle": return { entries: e.entries, continue: e.continue, outcome: e.outcome, canContinue: e.context?.canContinue, pending: e.context?.pendingMessages?.length };
			case "agent_end": return { messages: e.messages.length, roles: e.messages.map((m: any) => m.role) };
			case "tool_call": return { toolCallId: e.toolCallId, toolName: e.toolName, input: e.input, parent: e.parentToolCallId };
			case "tool_result": return { toolCallId: e.toolCallId, toolName: e.toolName, input: e.input, isError: e.isError, text: short(texts(e.content), 400), details: e.details ? Object.keys(e.details) : undefined };
			case "tool_execution_start": return { toolCallId: e.toolCallId, toolName: e.toolName };
			case "tool_execution_end": return { toolCallId: e.toolCallId, toolName: e.toolName, isError: e.isError };
			case "message_start": case "message_end": return { msg: summariseMessage(e.message) };
			case "context": return { messages: e.messages.length, markers: markers(e.messages) };
			case "session_compact": return { reason: e.reason, fromExtension: e.fromExtension };
			case "session_before_compact": return { reason: e.reason };
			case "input": return { text: short(e.text), source: e.source, streamingBehavior: e.streamingBehavior };
			case "model_select": return { model: e.model?.id, source: e.source };
			default: return {};
		}
	};
	const EVENTS = [
		"resources_discover", "session_start", "session_info_changed", "session_before_switch", "session_before_fork", "session_before_compact", "session_compact", "session_compact_failed", "session_shutdown", "session_before_tree", "session_tree", "mcp_servers_change",
		"context", "before_provider_request", "after_provider_response", "before_agent_start", "agent_start", "agent_end", "agent_before_settle", "agent_settled",
		"turn_start", "turn_end", "message_start", "message_end", "tool_execution_start", "tool_execution_end", "model_select", "thinking_level_select", "tool_call", "tool_result", "user_bash", "input",
	];
	if (!QUIET) for (const name of EVENTS) pi.on(name as any, (e: any, ctx: any) => { log({ ev: name, ...summarise(e), ctx: ctxInfo(ctx) }); });

	// ---- behaviours --------------------------------------------------------------------------
	if (FLAGS.has("inject_tool_result"))
		pi.on("tool_result", (e: any) => ({ content: [...e.content, { type: "text", text: `\nINJECT-tool_result-${e.toolCallId}` }] }));
	if (FLAGS.has("inject_turn_end"))
		pi.on("turn_end", (e: any) => ({ entries: [{ type: "custom_message", customType: "squeal-probe", content: `INJECT-turn_end-${e.turnIndex}`, display: true }] }));
	if (FLAGS.has("inject_steer"))
		pi.on("tool_execution_end", (e: any) => { pi.sendMessage({ customType: "squeal-probe", content: `INJECT-steer-${e.toolCallId}`, display: true }, { deliverAs: "steer" }); });
	if (FLAGS.has("inject_followup"))
		pi.on("tool_execution_end", (e: any) => { pi.sendMessage({ customType: "squeal-probe", content: `INJECT-followUp-${e.toolCallId}`, display: true }, { deliverAs: "followUp" }); });
	if (FLAGS.has("inject_nextturn"))
		pi.on("tool_execution_end", (e: any) => { pi.sendMessage({ customType: "squeal-probe", content: `INJECT-nextTurn-${e.toolCallId}`, display: true }, { deliverAs: "nextTurn" }); });
	if (FLAGS.has("inject_context")) {
		let k = 0;
		pi.on("context", (e: any) => ({ messages: [...e.messages, { role: "user", content: [{ type: "text", text: `INJECT-context-${k++}` }], timestamp: Date.now() }] }));
	}
	if (FLAGS.has("deny_once")) {
		let denied = false;
		pi.on("tool_call", (e: any) => {
			if (!denied && ["write", "edit", "bash"].includes(e.toolName)) {
				denied = true;
				return { block: true, reason: "DENY-squeal-regression: fix the failing test first" };
			}
		});
	}
	if (FLAGS.has("settle_once")) {
		let done = false;
		pi.on("agent_before_settle", (e: any) => {
			if (done) return;
			done = true;
			return { entries: [{ type: "custom_message", customType: "squeal-probe", content: "SETTLE-news-1", display: true }], continue: true };
		});
	}
	if (FLAGS.has("settle_entry_only"))
		pi.on("agent_before_settle", () => ({ entries: [{ type: "custom_message", customType: "squeal-probe", content: "SETTLE-entry-only", display: true }] }));
	if (FLAGS.has("settle_always")) {
		let k = 0;
		pi.on("agent_before_settle", () => ({ entries: [{ type: "custom_message", customType: "squeal-probe", content: `SETTLE-loop-${k++}`, display: true }], continue: true }));
	}
	if (FLAGS.has("primer_section"))
		pi.on("before_agent_start", (e: any) => {
			e.systemPromptOptions.sections.squeal = `PRIMER-section ${"x".repeat(Number(process.env.PROBE_PRIMER_PAD ?? 0))}`;
		});
	if (FLAGS.has("primer_message"))
		pi.on("before_agent_start", () => ({ message: { customType: "squeal-primer", content: "PRIMER-message", display: false } }));
	if (FLAGS.has("compact_custom"))
		pi.on("session_before_compact", (e: any) => ({ compaction: { summary: "INJECT-compaction-summary", firstKeptEntryId: e.preparation.firstKeptEntryId, tokensBefore: 100 } }));

	for (const ev of (process.env.PROBE_THROW ?? "").split(",").filter(Boolean))
		pi.on(ev as any, () => { throw new Error(`probe throws in ${ev}`); });
	for (const spec of (process.env.PROBE_SLOW ?? "").split(",").filter(Boolean)) {
		const [ev, ms] = spec.split(":");
		pi.on(ev as any, async () => { log({ ev: "SLOW_BEGIN", in: ev, ms: Number(ms) }); await sleep(Number(ms)); log({ ev: "SLOW_END", in: ev }); });
	}
	for (const ev of (process.env.PROBE_HANG ?? "").split(",").filter(Boolean))
		pi.on(ev as any, () => { log({ ev: "HANG_BEGIN", in: ev }); return new Promise(() => {}); });

	if (FLAGS.has("trivial")) {
		pi.on("tool_call", async () => undefined);
		pi.on("tool_result", async () => undefined);
	}
	if (FLAGS.has("socket") || FLAGS.has("socket_leak")) {
		// One unix-socket connection held for the session; one request/response round trip per tool event.
		let sock: net.Socket | undefined;
		let waiting: ((s: string) => void)[] = [];
		pi.on("session_start", async () => {
			sock = net.createConnection(process.env.PROBE_SOCK!);
			sock.setEncoding("utf8");
			let buf = "";
			sock.on("data", (d: string) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiting.shift()?.(line); } });
			await new Promise((r) => sock!.once("connect", r));
		});
		const ask = (q: string) => new Promise<string>((r) => { waiting.push(r); sock!.write(`${q}\n`); });
		pi.on("tool_call", async (e: any) => { await ask(`call ${e.toolCallId}`); });
		pi.on("tool_result", async (e: any) => { await ask(`result ${e.toolCallId}`); });
		pi.on("session_shutdown", () => { if (FLAGS.has("socket_leak")) return; sock?.end(); sock = undefined; });
	}

	pi.on("session_start", () => { moduleState++; log({ ev: "STATE", moduleState, factoryRuns: g.__probeFactoryRuns }); });

	pi.registerCommand("probe-new", {
		description: "probe: replace the session",
		handler: async (_args: string, ctx: any) => {
			log({ ev: "CMD_probe-new_begin", ctx: ctxInfo(ctx) });
			const r = await ctx.newSession({ withSession: async (c: any) => { log({ ev: "withSession", ctx: ctxInfo(c), moduleState }); } });
			log({ ev: "CMD_probe-new_end", r });
		},
	});
	pi.registerCommand("probe-old-ctx", {
		description: "probe: use a stale context after replacement",
		handler: async (_args: string, ctx: any) => {
			const r = await ctx.newSession({});
			try { log({ ev: "stale", info: ctx.sessionManager.getSessionId() }); } catch (err) { log({ ev: "staleError", err: String(err) }); }
			log({ ev: "CMD_probe-old-ctx_end", r });
		},
	});
}
