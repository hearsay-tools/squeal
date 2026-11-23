#!/usr/bin/env node
// Throwaway probe for 023-75 (023-28's summarize.mjs). Not product code. Runs on the VM over
// <work>/logs:
//
//   node summarize.mjs <logs dir>
//
// Per session with a stream.jsonl: logs/<id>/summary.json (the Squeal commands run, the skill
// files read, the commands and edits that can swap versions in the clone, the clone's state after
// the session, wall time, usage and cost, the final answer; for 023-28 also whether `--run` was
// passed, the `--at` calls that name HEAD itself, and the tool calls past Claude Code's 120 s
// limit: moved to the background by it, or 120 s and longer; for 023-44 also the processes left
// after the session, from meta.json; for 023-44 also the --at calls that returned with work still
// running or setting up, the later --at --wait calls that join it, and the commit stop lines; for
// 023-63 also each time estimate line an --at call printed, with its second, for V2; for 023-75
// `lines9`, each line of any squeal call's result that names "not comparable", the named browser
// file, "queued by a request", "waiting for `squeal run" or a batch that holds a file (023-64 to
// 023-68), and `hooks9`, each hook or system event that holds "waiting for `squeal run" or
// "queued by a request" (023-67); for 023-75 `lines10`, each line of any squeal call's result that
// names the round 10 fixes' words: "queued at", "still running at", "waiting for", "not started",
// "time unknown", "as it was at", "run in the commit's worktree" (023-71, 023-73), and `hooks10`, as
// hooks9) and timeline.txt (023-10's
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
// Each `squeal status ... --at <rev>` in a command line, with its rev and whether it passes --run.
// A rev that names HEAD itself (not HEAD~1, HEAD^) is HEAD or the session's HEAD commit.
const atCalls = (cmd) =>
  [...cmd.matchAll(/squeal\s+status\b([^|;&\n]*)/g)]
    .map((m) => ({ args: m[1], rev: /--at[ =](\S+)/.exec(m[1])?.[1] }))
    .filter((c) => c.rev)
    .map((c) => ({ ...c, run: /--run\b/.test(c.args), head: /^(HEAD|8be977a\w*|20f03a4\w*)$/.test(c.rev) }));
const rows = [];
for (const id of readdirSync(logs).sort()) {
  const dir = join(logs, id);
  const f = join(dir, "stream.jsonl");
  if (!existsSync(f)) continue;
  const meta = existsSync(join(dir, "meta.json")) ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) : {};
  const s = { id, lines9: [], hooks9: [], lines10: [], leftover: meta.leftover, commitStop: meta.commitStop, stillRunning: [], joins: [], estimates: [], lines8: [], loadStart: meta.loadStart, exit: meta.exit, wallSeconds: meta.wallSeconds, squeal: [], skill: [], swaps: [], edits: [], overruns: [], long: [] };
  const calls = new Map(); // tool_use id -> { t, name, cmd, background }
  for (const raw of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const tab = raw.indexOf("\t");
    const { t } = JSON.parse(raw.slice(0, tab));
    let ev;
    try {
      ev = JSON.parse(raw.slice(tab + 1));
    } catch {
      continue;
    }
    if (ev.type !== "assistant" && ev.type !== "user" && /waiting for `squeal run|queued by a request/.test(raw)) {
      const m = /.{0,160}(waiting for `squeal run|queued by a request).{0,160}/.exec(raw.replace(/\\n/g, " "));
      s.hooks9.push(`${t.toFixed(0)}s ${ev.type}/${ev.subtype ?? ""} ${m?.[0] ?? ""}`);
    }
    if (ev.type === "assistant")
      for (const c of ev.message?.content ?? []) {
        if (c.type !== "tool_use") continue;
        const i = c.input ?? {};
        calls.set(c.id, { t, name: c.name, cmd: String(i.command ?? i.skill ?? i.file_path ?? "").slice(0, 300), background: i.run_in_background === true });
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
    if (ev.type === "user")
      for (const c of ev.message?.content ?? []) {
        if (c.type !== "tool_result" || !calls.has(c.tool_use_id)) continue;
        const call = calls.get(c.tool_use_id);
        const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x) => x.text ?? "").join("");
        const took = t - call.t;
        if (/\bsqueal\b/.test(call.cmd))
          for (const line of text.split("\n"))
            if (/not comparable|thread-scroll|queued by a request|waiting for `squeal run|batch (that holds|of \d+)|cut out/.test(line))
              s.lines9.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${line.trim().slice(0, 300)}`);
        if (/\bsqueal\b/.test(call.cmd))
          for (const line of text.split("\n"))
            if (/queued at|still running at|waiting for|not started|time unknown|as it was at|run in the commit's worktree/.test(line))
              s.lines10.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${line.trim().slice(0, 300)}`);
        if (/squeal\s+status\b[^|;&]*--at\b/.test(call.cmd)) {
          if (/still running|still setting up|call again with `?--wait/.test(text)) s.stillRunning.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${call.cmd}`);
          for (const line of text.split("\n")) if (/\babout [\d.]+( to [\d.]+)? ?(min|h|s)\b|time unknown/.test(line)) s.estimates.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${line.trim().slice(0, 300)}`);
          for (const line of text.split("\n")) if (/open\.test\.ts|not selected/.test(line)) s.lines8.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${line.trim().slice(0, 300)}`);
          if (/--wait\b/.test(call.cmd)) s.joins.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${call.cmd}`);
        }
        if (!call.background && /^Command running in background with ID|moved to the background/.test(text))
          s.overruns.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${call.cmd}`);
        else if (took >= 120) s.long.push(`${call.t.toFixed(0)}s +${took.toFixed(0)}s ${call.name} ${call.cmd}`);
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
  const at = s.squeal.flatMap(atCalls);
  s.usedRun = at.some((c) => c.run);
  s.atCalls = at.length;
  s.atHeadCalls = at.filter((c) => c.head).length;
  s.atRevs = at.map((c) => `${c.rev}${c.run ? " --run" : ""}`);
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
      s.usedRun ? "run" : "",
      s.atCalls,
      s.atHeadCalls,
      s.overruns.length,
      s.long.length,
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
      s.leftover,
      s.stillRunning.length,
      s.joins.length,
      s.estimates.length,
    ].join("\t"),
  );
}
const head = "id\tload\texit\twall_s\tat\tproof\trun\tat_calls\tat_head\toverruns\tlong_calls\tskill\tswap_cmds\tedits\tresults\tstatus_after\tworktrees\tcache_w\tcache_r\tout\tusd\tleftover\tstill_running\tjoins\testimates";
writeFileSync(join(logs, "summary.tsv"), `${[head, ...rows].join("\n")}\n`);
console.log([head, ...rows].join("\n"));
