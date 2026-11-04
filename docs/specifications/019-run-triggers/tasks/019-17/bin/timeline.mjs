#!/usr/bin/env node
// Throwaway probe for 019-17. Not product code. Runs as agent.
//   node timeline.mjs <session dir>
// One timeline per session from stream.jsonl (each line stamped with epoch ms by session.mjs),
// in seconds from the first line: each tool call (Edit, Write, Bash with its command), each
// tool result's end, each hook that ran with what it gave (a SQUEAL text, a block, or nothing),
// and the agent's texts. Claude Code's stream-json with --include-hook-events: `system`
// `hook_started` / `hook_response`. Codex's `exec --json` items: commands, file changes and
// messages; its hook texts are in the rollout (codex-rollout.jsonl, when session.mjs saved it).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
const lines = readFileSync(join(dir, "stream.jsonl"), "utf8").split("\n").filter(Boolean);
let t0 = null;
const rows = [];
const say = (t, kind, text) => rows.push({ t, kind, text });
const one = (s, n = 400) => s.replace(/\s+/g, " ").slice(0, n);
const hookText = (out) => {
  try {
    const o = JSON.parse(out);
    return o.hookSpecificOutput?.additionalContext ?? o.reason ?? o.systemMessage ?? out;
  } catch {
    return out;
  }
};
for (const raw of lines) {
  const sp = raw.indexOf(" ");
  const ts = Number(raw.slice(0, sp));
  t0 ??= ts;
  const t = ((ts - t0) / 1000).toFixed(2);
  let ev;
  try {
    ev = JSON.parse(raw.slice(sp + 1));
  } catch {
    continue;
  }
  if (ev.type === "system" && ev.subtype === "hook_started") say(t, "hook>", `${ev.hook_event ?? ""} ${ev.hook_name ?? ""}`);
  if (ev.type === "system" && ev.subtype === "hook_response") {
    const body = hookText(ev.output ?? ev.stdout ?? "");
    const block = /"decision"\s*:\s*"block"/.test(ev.output ?? "") ? "BLOCK " : "";
    say(t, "hook<", `${ev.hook_event ?? ""} ${ev.hook_name ?? ""} exit ${ev.exit_code ?? "?"} ${block}${body.trim() === "" ? "(nothing)" : `\n${body.trim()}`}${ev.stderr?.trim() ? `\n[stderr] ${one(ev.stderr, 600)}` : ""}`);
  }
  if (ev.type === "assistant") {
    for (const c of ev.message?.content ?? []) {
      if (c.type === "tool_use") say(t, "tool", `${c.name} ${one(c.input?.command ?? c.input?.file_path ?? JSON.stringify(c.input ?? {}), 300)}`);
      if (c.type === "text" && c.text.trim()) say(t, "text", one(c.text, 600));
    }
  }
  if (ev.type === "user" && Array.isArray(ev.message?.content)) {
    for (const c of ev.message.content) {
      if (c.type !== "tool_result") continue;
      const body = Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join(" ") : String(c.content ?? "");
      say(t, "result", one(body, 300));
    }
  }
  if (ev.type === "result") say(t, "end", `${ev.subtype} turns ${ev.num_turns} ${one(String(ev.result ?? ""), 300)}`);
  // Codex exec --json
  if (ev.type === "item.started" || ev.type === "item.completed") {
    const it = ev.item ?? {};
    const what = it.type === "command_execution" ? `$ ${one(it.command ?? "", 300)}${it.exit_code === undefined ? "" : ` -> ${it.exit_code}`}` : it.type === "file_change" ? `files ${JSON.stringify((it.changes ?? []).map((c) => c.path))}` : it.type === "agent_message" ? one(it.text ?? "", 600) : it.type;
    say(t, ev.type === "item.started" ? "item>" : "item<", what);
  }
  if (ev.type === "turn.completed" || ev.type === "turn.failed") say(t, "end", ev.type);
}
for (const r of rows) console.log(`${r.t.padStart(8)} ${r.kind.padEnd(6)} ${r.text}`);
const rollout = join(dir, "codex-rollout.jsonl");
if (existsSync(rollout)) {
  console.log("--- Codex rollout: hook contexts and stops");
  for (const raw of readFileSync(rollout, "utf8").split("\n").filter(Boolean)) {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      continue;
    }
    const text = JSON.stringify(ev);
    if (/SQUEAL|Squeal policy|hook/i.test(text)) console.log(`${ev.timestamp ?? ""} ${one(text, 1200)}`);
  }
}
