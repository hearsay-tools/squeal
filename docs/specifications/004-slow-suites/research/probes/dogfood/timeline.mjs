// A readable timeline of one Codex rollout: tool cells, the commands they ran,
// developer messages (Squeal's included), assistant messages. Read only.
// Usage: node timeline.mjs <rollout.jsonl> [--full-squeal]
import { readFileSync } from "node:fs";

const [file, flag] = process.argv.slice(2);
const full = flag === "--full-squeal";
const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t0 = Date.parse(lines[0].timestamp);
const at = (ts) => `+${((Date.parse(ts) - t0) / 1000).toFixed(1)}s ${ts.slice(11, 23)}`;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} [...${s.length - n} more]` : s);
const one = (s) => s.replace(/\s+/g, " ");

for (const o of lines) {
  const p = o.payload ?? {};
  if (o.type === "response_item" && p.type === "message") {
    const text = (p.content ?? []).map((c) => c.text ?? "").join(" ");
    if (p.role === "developer" && text.startsWith("SQUEAL")) {
      console.log(`${at(o.timestamp)} DEVELOPER (Squeal)\n${full ? text : cut(text, 600)}\n`);
    } else if (p.role === "assistant") {
      console.log(`${at(o.timestamp)} ASSISTANT ${cut(one(text), 400)}\n`);
    } else {
      console.log(`${at(o.timestamp)} ${p.role.toUpperCase()} ${cut(one(text), 120)}\n`);
    }
  } else if (o.type === "response_item" && p.type === "custom_tool_call") {
    console.log(`${at(o.timestamp)} CELL ${p.call_id.slice(-8)} ${cut(one(p.input ?? ""), 500)}`);
  } else if (o.type === "response_item" && p.type === "custom_tool_call_output") {
    const out = typeof p.output === "string" ? p.output : JSON.stringify(p.output);
    const hook = /blocked by \w+ hook|hook/i.test(out) && /SQUEAL ·/.test(out) ? " [hook text?]" : "";
    console.log(`${at(o.timestamp)} CELL-OUT ${p.call_id.slice(-8)}${hook} ${cut(one(out), 300)}\n`);
  } else if (o.type === "event_msg" && p.type === "item_completed") {
    const it = p.item ?? {};
    if (it.type === "CommandExecution") {
      const cmd = Array.isArray(it.command) ? it.command.at(-1) : String(it.command);
      const ms = it.duration_ms ?? it.durationMs ?? "";
      console.log(`${at(o.timestamp)}   CMD ${it.status} exit=${it.exit_code ?? it.exitCode ?? "?"} ${ms} ${cut(one(cmd), 300)}`);
    } else if (it.type === "FileChange") {
      const changes = it.changes ?? {};
      const paths = (Array.isArray(changes) ? changes.map((c) => c.path) : Object.keys(changes)).join(", ");
      console.log(`${at(o.timestamp)}   PATCH ${it.status} ${paths}`);
    }
  } else if (o.type === "event_msg" && (p.type === "task_started" || p.type === "task_complete")) {
    console.log(`${at(o.timestamp)} ${p.type}\n`);
  }
}
