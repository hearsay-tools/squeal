// Throwaway probe (016-35), not a design. Loads Squeal 0.1.335's Pi extension
// ($HT_SQUEAL_EXT, unchanged) and maps the Pi event names and result shapes it
// uses onto OMP 18.8.0's, to show which of Squeal's behaviours OMP's own
// events can carry. It does not fix the daemon spawn (process.execPath is the
// omp binary in the worker too; see execpath-worker.mjs).
//   turn_end {entries}            -> pi.sendMessage(..., {deliverAs: $HT_BOUNDARY_AS})
//   before_agent_start sections   -> result.systemPrompt (appended)
//   agent_before_settle           -> session_stop {continue, additionalContext}
//   agent_settled                 -> agent_end (willContinue false)
import { appendFileSync } from "node:fs";

export default async function (pi) {
  const { default: squeal } = await import(process.env.HT_SQUEAL_EXT);
  const handlers = new Map();
  // Trace to $HT_EVENT_LOG: every sendMessage Squeal makes, and its outcome.
  const trace = (line) => {
    if (process.env.HT_EVENT_LOG) appendFileSync(process.env.HT_EVENT_LOG, `${JSON.stringify({ at: new Date().toISOString(), shim: true, ...line })}\n`);
  };
  const proxy = new Proxy(pi, {
    get(target, key) {
      if (key === "on") return (name, handler) => handlers.set(name, handler);
      if (key === "sendMessage") {
        return (message, options) => {
          trace({ sendMessage: options, chars: String(message?.content ?? "").length });
          try {
            return target.sendMessage(message, options);
          } catch (error) {
            trace({ sendMessageThrew: String(error) });
            throw error;
          }
        };
      }
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  squeal(proxy);
  const text = (entries) => entries.map((e) => e.content).join("\n\n");
  for (const name of ["session_start", "input", "tool_call", "session_shutdown"]) {
    const h = handlers.get(name);
    if (h) pi.on(name, h);
  }
  pi.on("before_agent_start", async (event, ctx) => {
    const sections = {};
    const result = await handlers.get("before_agent_start")({ ...event, systemPromptOptions: { sections } }, ctx);
    const primer = Object.values(sections).join("\n\n");
    if (!primer) return result;
    return { ...result, systemPrompt: [...event.systemPrompt, primer] };
  });
  // HT_BOUNDARY=tool_result: Squeal's boundary per tool call, its text as the
  // call's additionalContext, which OMP sends before the next provider request.
  if (process.env.HT_BOUNDARY === "tool_result") {
    pi.on("tool_result", async (event, ctx) => {
      const result = await handlers.get("turn_end")({ toolResults: [{ toolName: event.toolName }] }, ctx);
      return result?.entries?.length ? { additionalContext: text(result.entries) } : undefined;
    });
  } else pi.on("turn_end", async (event, ctx) => {
    const result = await handlers.get("turn_end")(event, ctx);
    if (result?.entries?.length) {
      pi.sendMessage(
        { customType: "squeal", content: text(result.entries), display: true },
        { deliverAs: process.env.HT_BOUNDARY_AS || "steer" },
      );
    }
  });
  pi.on("session_stop", async (event, ctx) => {
    const result = await handlers.get("agent_before_settle")({ outcome: "completed" }, ctx);
    if (result?.continue && result.entries?.length) {
      return { continue: true, additionalContext: text(result.entries) };
    }
    return undefined;
  });
  pi.on("agent_end", async (event, ctx) => {
    trace({ agentEnd: true, willContinue: event.willContinue ?? null });
    if (event.willContinue) return;
    await handlers.get("agent_settled")(event, ctx);
  });
}
