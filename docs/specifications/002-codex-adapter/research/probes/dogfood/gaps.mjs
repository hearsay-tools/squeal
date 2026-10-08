// Upper bounds on Squeal hook latency from a Codex rollout, which records no
// hook runs: for each SQUEAL developer message, the time since the tool item
// that completed just before it (PostToolUse), or since session_meta
// (SessionStart). Also counts tool items and cells. Read only.
// Usage: node gaps.mjs <rollout.jsonl>
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ms = (ts) => Date.parse(ts);
let lastTool;
let meta;
let tools = 0;
let cells = 0;
for (const o of lines) {
  const p = o.payload ?? {};
  if (o.type === "session_meta") meta = o;
  if (o.type === "response_item" && p.type === "custom_tool_call") cells++;
  if (o.type === "event_msg" && p.type === "item_completed" && ["CommandExecution", "FileChange"].includes(p.item?.type)) {
    tools++;
    const it = p.item;
    lastTool = { ts: o.timestamp, what: it.type === "FileChange" ? "apply_patch" : (it.command?.at?.(-1) ?? "").slice(0, 70) };
  }
  if (o.type === "response_item" && p.type === "message" && p.role === "developer") {
    const text = (p.content ?? []).map((c) => c.text ?? "").join(" ");
    if (!text.startsWith("SQUEAL")) continue;
    const first = text.split("\n")[0];
    if (first.includes("registered")) {
      console.log(`${o.timestamp} SessionStart +${ms(o.timestamp) - ms(meta.timestamp)} ms after session_meta: ${first}`);
    } else {
      console.log(`${o.timestamp} PostToolUse +${ms(o.timestamp) - ms(lastTool.ts)} ms after "${lastTool.what}" completed: ${first}`);
    }
  }
}
console.log(`tool items: ${tools}, code-mode cells: ${cells}`);
