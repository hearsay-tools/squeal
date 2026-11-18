#!/usr/bin/env node
// Throwaway probe for 023-10. Not product code. A session's timeline from its stamped stream:
//   node timeline.mjs /tmp/w12-023-10/logs/<id> [--full]
// One line per tool call (Bash command, file edits), per hook text that carries SQUEAL, per
// tool result (cut to 600 characters, --full: whole) and the final result with usage.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const full = process.argv.includes("--full");
const cut = (s, n = 600) => (full || s.length <= n ? s : `${s.slice(0, n)} …[${s.length} chars]`);
const lines = readFileSync(join(dir, "stream.jsonl"), "utf8").split("\n").filter(Boolean);
const out = [];
for (const raw of lines) {
  const tab = raw.indexOf("\t");
  const { t } = JSON.parse(raw.slice(0, tab));
  let ev;
  try {
    ev = JSON.parse(raw.slice(tab + 1));
  } catch {
    continue;
  }
  const at = t.toFixed(1).padStart(7);
  if (ev.type === "assistant") {
    for (const c of ev.message?.content ?? []) {
      if (c.type === "text" && c.text.trim()) out.push(`${at} SAY  ${cut(c.text.trim(), 1500)}`);
      if (c.type === "tool_use") {
        const i = c.input ?? {};
        const what = i.command ?? i.file_path ?? i.pattern ?? i.skill ?? i.description ?? JSON.stringify(i);
        out.push(`${at} TOOL ${c.name}: ${cut(String(what), 2000)}`);
      }
    }
  } else if (ev.type === "user") {
    for (const c of ev.message?.content ?? []) {
      if (c.type === "tool_result") {
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join("") : String(c.content ?? "");
        out.push(`${at} RES  ${cut(text.replace(/\n/g, "\n             "))}`);
      }
    }
  } else if (ev.type === "system" && /hook/.test(ev.subtype ?? "")) {
    const text = JSON.stringify(ev);
    if (/SQUEAL/.test(text)) {
      const body = ev.output ?? ev.stdout ?? ev.response ?? text;
      out.push(`${at} HOOK ${ev.hook_event_name ?? ev.subtype}: ${cut(String(typeof body === "string" ? body : JSON.stringify(body)), 1500)}`);
    }
  } else if (ev.type === "result") {
    out.push(
      `${at} END  ${ev.subtype} turns=${ev.num_turns} duration=${ev.duration_ms}ms cost=$${ev.total_cost_usd} usage=${JSON.stringify(ev.usage)}`,
    );
    out.push(`${at} FINAL ${cut(String(ev.result ?? ""), 4000)}`);
  }
}
writeFileSync(join(dir, full ? "timeline-full.txt" : "timeline.txt"), `${out.join("\n")}\n`);
console.log(out.length, "lines");
