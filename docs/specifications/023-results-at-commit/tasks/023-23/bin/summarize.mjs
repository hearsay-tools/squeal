#!/usr/bin/env node
// Throwaway probe for 023-23. Not product code. Runs on the VM over <work>/logs:
//
//   node summarize.mjs <logs dir>
//
// Per session with a stream.jsonl: logs/<id>/summary.json (the Squeal commands run, the skill
// files read, the commands and edits that can swap versions in the clone, the clone's state after
// the session, wall time, usage and cost, the final answer) and timeline.txt (023-10's
// timeline.mjs); and logs/summary.tsv, one line per session. The answer's rightness is judged by
// reading, not here.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const logs = process.argv[2];
const swap =
  /\bgit\s+(checkout|restore|switch|stash|reset|worktree\s+add|revert|cherry-pick|apply)\b|\bgit\s+show\s+[^|]*>|\bcp\b|\bmv\b|\bpatch\b/;
const rows = [];
for (const id of readdirSync(logs).sort()) {
  const dir = join(logs, id);
  const f = join(dir, "stream.jsonl");
  if (!existsSync(f)) continue;
  const meta = existsSync(join(dir, "meta.json")) ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) : {};
  const s = { id, loadStart: meta.loadStart, exit: meta.exit, wallSeconds: meta.wallSeconds, squeal: [], skill: [], swaps: [], edits: [] };
  for (const raw of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const tab = raw.indexOf("\t");
    const { t } = JSON.parse(raw.slice(0, tab));
    let ev;
    try {
      ev = JSON.parse(raw.slice(tab + 1));
    } catch {
      continue;
    }
    if (ev.type === "assistant")
      for (const c of ev.message?.content ?? []) {
        if (c.type !== "tool_use") continue;
        const i = c.input ?? {};
        if (c.name === "Skill") s.skill.push(`${t.toFixed(0)}s Skill ${i.skill ?? i.command ?? ""}`);
        if (c.name === "Bash") {
          const cmd = String(i.command ?? "");
          if (/\bsqueal\b/.test(cmd)) s.squeal.push(`${t.toFixed(0)}s ${cmd}`);
          if (/skills\/squeal/.test(cmd)) s.skill.push(`${t.toFixed(0)}s Bash ${cmd.slice(0, 200)}`);
          if (swap.test(cmd)) s.swaps.push(`${t.toFixed(0)}s ${cmd}`);
        }
        if (c.name === "Read" && /skills\/squeal/.test(String(i.file_path ?? ""))) s.skill.push(`${t.toFixed(0)}s Read ${i.file_path}`);
        if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(c.name)) s.edits.push(`${t.toFixed(0)}s ${c.name} ${i.file_path ?? ""}`);
      }
    if (ev.type === "result") {
      // A background task's notification starts another turn with its own result event;
      // total_cost_usd and modelUsage are cumulative over the session, usage is the last turn's.
      s.results = (s.results ?? 0) + 1;
      s.turns = (s.turns ?? 0) + (ev.num_turns ?? 0);
      s.costUsd = ev.total_cost_usd;
      const m = Object.values(ev.modelUsage ?? {});
      s.usage = {
        cache_creation_input_tokens: m.reduce((a, x) => a + (x.cacheCreationInputTokens ?? 0), 0),
        cache_read_input_tokens: m.reduce((a, x) => a + (x.cacheReadInputTokens ?? 0), 0),
        output_tokens: m.reduce((a, x) => a + (x.outputTokens ?? 0), 0),
      };
      s.firstFinal ??= ev.result;
      s.final = ev.result;
    }
  }
  const after = existsSync(join(dir, "after-stop.txt")) ? readFileSync(join(dir, "after-stop.txt"), "utf8") : "";
  s.statusAfter = /## status\n([\s\S]*?)\n## stash/.exec(after)?.[1].trim() ?? "?";
  s.stashAfter = /## stash\n([\s\S]*?)\n## reflog/.exec(after)?.[1].trim() ?? "?";
  s.worktreesAfter = (/## worktrees\n([\s\S]*?)\n## checkouts/.exec(after)?.[1].match(/^worktree /gm) ?? []).length;
  s.usedAt = s.squeal.some((c) => /status\s[^|;&]*--at\b/.test(c));
  s.usedProof = s.squeal.some((c) => /\bsqueal\s+proof\b/.test(c));
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(s, null, 2)}\n`);
  execFileSync("node", [join(here, "timeline.mjs"), dir], { stdio: "ignore" });
  const u = s.usage ?? {};
  rows.push(
    [
      id,
      s.loadStart,
      s.exit,
      s.wallSeconds?.toFixed(0),
      s.usedAt ? "at" : "",
      s.usedProof ? "proof" : "",
      s.skill.length ? "skill" : "",
      s.swaps.length,
      s.edits.length,
      s.results,
      JSON.stringify(s.statusAfter),
      s.worktreesAfter,
      u.cache_creation_input_tokens,
      u.cache_read_input_tokens,
      u.output_tokens,
      s.costUsd?.toFixed(3),
    ].join("\t"),
  );
}
const head = "id\tload\texit\twall_s\tat\tproof\tskill\tswap_cmds\tedits\tresults\tstatus_after\tworktrees\tcache_w\tcache_r\tout\tusd";
writeFileSync(join(logs, "summary.tsv"), `${[head, ...rows].join("\n")}\n`);
console.log([head, ...rows].join("\n"));
