// Throwaway: a readable timeline of one Codex rollout file: the model's tool
// calls and their outputs (first line), developer and user messages (SQUEAL
// text in full, the rest cut), and agent messages, with ms since t0.
//   node timeline.mjs <rollout.jsonl> [t0-ms]
import { readFileSync } from "node:fs";

const [file, t0Arg] = process.argv.slice(2);
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const t0 = Number(t0Arg ?? Date.parse(lines[0].timestamp));
const text = (p) =>
  (p.content ?? [])
    .map((c) => c.text ?? "")
    .join("")
    .trim();
const cut = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\n/g, "⏎");
for (const l of lines) {
  const dt = Date.parse(l.timestamp) - t0;
  const p = l.payload ?? {};
  let out = null;
  if (l.type === "response_item" && p.type === "message") {
    const t = text(p);
    if (p.role === "assistant") out = `assistant: ${cut(t, 300)}`;
    else out = t.includes("SQUEAL") ? `${p.role}:\n${t}` : `${p.role}: ${cut(t)}`;
  } else if (l.type === "response_item" && /call$/.test(p.type ?? "")) {
    out = `call ${p.name}: ${cut(p.input ?? p.arguments ?? "", 400)}`;
  } else if (l.type === "response_item" && /call_output$/.test(p.type ?? "")) {
    const o = typeof p.output === "string" ? p.output : JSON.stringify(p.output);
    out = o.includes("SQUEAL") ? `output:\n${o}` : `output: ${cut(o)}`;
  } else if (l.type === "event_msg" && /hook/i.test(p.type ?? "")) {
    out = `event ${p.type}: ${cut(JSON.stringify(p), 300)}`;
  }
  if (out) console.log(`+${dt}ms ${out}`);
}
