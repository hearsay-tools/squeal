// Throwaway probe (016-35). No agent session and no model: drives Squeal's Pi
// extension ($HT_SQUEAL_EXT) through one turn with a fake `pi` and context,
// then waits 30 s for the idle wake (a sendMessage with triggerTurn). Run in
// ~/ht035/repo after reset-repo.sh baseline, once under Node and once under
// OMP's Bun (BUN_BE_BUN=1 omp wake-direct.mjs), to tell a runtime difference
// from an OMP event-mapping one.
import { writeFileSync } from "node:fs";

const { default: squeal } = await import(process.env.HT_SQUEAL_EXT);
const handlers = new Map();
const sent = [];
const t0 = Date.now();
const say = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
squeal({
  on: (name, handler) => handlers.set(name, handler),
  sendMessage: (message, options) => {
    sent.push(options);
    say("sendMessage", JSON.stringify(options), String(message.content).split("\n")[0]);
  },
});
const ctx = {
  sessionManager: { getSessionId: () => `wake-direct-${process.versions.bun ? "bun" : "node"}` },
  cwd: process.cwd(),
  mode: "rpc",
};
const fire = async (name, event) => {
  const result = await handlers.get(name)?.(event, ctx);
  say(name, result === undefined ? "-" : JSON.stringify(result).slice(0, Number(process.env.HT_SHOW ?? 160)));
};
say("runtime", process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`);
await fire("session_start", { reason: "startup" });
await fire("input", {});
await fire("before_agent_start", { prompt: "p", systemPromptOptions: { sections: {} } });
await new Promise((r) => setTimeout(r, 8000)); // let the spawned daemon settle in
await fire("tool_call", { toolName: "write", input: {} });
// A unique comment: Squeal reuses a stored result for content it has run before.
writeFileSync("mul.js", `export const mul = (a, b) => a + b; // ${Date.now()}\n`);
await new Promise((r) => setTimeout(r, Number(process.env.HT_SETTLE_DELAY_MS ?? 0))); // the model "thinks"
await fire("turn_end", { toolResults: [{ toolName: "write" }] });
await fire("agent_before_settle", { outcome: "completed" });
await fire("agent_settled", {});
for (let i = 0; i < 30 && !sent.some((o) => o.triggerTurn); i++) await new Promise((r) => setTimeout(r, 1000));
say("woken", sent.some((o) => o.triggerTurn));
await fire("session_shutdown", { reason: "quit" });
process.exit(0);
