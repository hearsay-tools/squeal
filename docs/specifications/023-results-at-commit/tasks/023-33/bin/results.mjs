#!/usr/bin/env node
// Throwaway probe for 023-33 (023-28's results.mjs, unchanged). Not product code. Runs in the
// sandbox over <work>/logs:
//
//   node results.mjs <logs dir>
//
// Per session with a stream.jsonl: logs/<id>/squeal-results.txt, each Bash call that names
// squeal (or reads a background output file) with its second, its duration and its whole result,
// then every text the agent said, in order. The stream is already redacted by session.mjs. This
// is the reading copy the judgements are made from.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const logs = process.argv[2];
for (const id of readdirSync(logs).sort()) {
  const f = join(logs, id, "stream.jsonl");
  if (!existsSync(f)) continue;
  const calls = new Map();
  const out = [];
  for (const raw of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const tab = raw.indexOf("\t");
    const { t } = JSON.parse(raw.slice(0, tab));
    let ev;
    try {
      ev = JSON.parse(raw.slice(tab + 1));
    } catch {
      continue;
    }
    for (const c of ev.message?.content ?? []) {
      if (ev.type === "assistant" && c.type === "text" && c.text.trim()) out.push(`## ${t.toFixed(0)}s SAY\n${c.text}`);
      if (ev.type === "assistant" && c.type === "tool_use" && c.name === "Bash") {
        const cmd = String(c.input?.command ?? "");
        if (/\bsqueal\b|tasks\/\w+\.output/.test(cmd)) calls.set(c.id, { t, cmd, bg: c.input?.run_in_background === true });
      }
      if (ev.type === "user" && c.type === "tool_result" && calls.has(c.tool_use_id)) {
        const call = calls.get(c.tool_use_id);
        const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x) => x.text ?? "").join("");
        out.push(`## ${call.t.toFixed(0)}s +${(t - call.t).toFixed(0)}s ${call.bg ? "(background) " : ""}$ ${call.cmd}\n${text}`);
      }
    }
  }
  writeFileSync(join(logs, id, "squeal-results.txt"), `${out.join("\n\n")}\n`);
}
