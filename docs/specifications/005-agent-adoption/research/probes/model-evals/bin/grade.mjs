#!/usr/bin/env node
// Throwaway probe for 005-06 (model-evals). Not product code.
//
// Grades one cell's out/ directory mechanically and writes out/grade.json:
//   node grade.mjs <cell>/out
// One timeline from Claude Code stream-json or Codex `exec --json` (plus its rollout under the
// cell's CODEX_HOME for the SQUEAL texts the model received), then:
//   own test runs by runner and scope, with wall time; Squeal pulls, waits, why, run --all;
//   sleeps; skill loads; edits by path; SQUEAL deliveries by kind and the agent's next step after a FAIL;
//   whether it waited on Squeal after its last edit; the final `TESTS:` line against the ground truth
//   (a Vitest run with the flake disabled, and node:test over scripts/) and against Squeal's end status.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const meta = JSON.parse(readFileSync(join(OUT, "meta.json"), "utf8"));
const T0 = Number(readFileSync(join(OUT, "t0"), "utf8"));
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const ev = lines(join(OUT, "events.jsonl"));

// ---------- one timeline ----------
// kinds: cmd {cmd, ms, exit, out}, edit {path}, read {path}, skill, say {text}, squeal {text, hook}
const tl = [];
let cost = null, usage = null, final = "", turns = null;
if (meta.harness === "claude") {
  const open = new Map();
  for (const e of ev) {
    if (e.type === "assistant") for (const c of e.message?.content ?? []) {
      if (c.type === "text") tl.push({ t: e.t, kind: "say", text: c.text });
      if (c.type !== "tool_use") continue;
      const i = c.input ?? {};
      if (c.name === "Bash") open.set(c.id, tl.push({ t: e.t, kind: "cmd", cmd: String(i.command ?? "") }) - 1);
      else if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(c.name)) tl.push({ t: e.t, kind: "edit", path: String(i.file_path ?? "") });
      else if (c.name === "Read") tl.push({ t: e.t, kind: /skills\/squeal\//.test(i.file_path ?? "") ? "skill" : "read", path: String(i.file_path ?? "") });
      else if (c.name === "Skill") tl.push({ t: e.t, kind: /squeal/i.test(JSON.stringify(i)) ? "skill" : "tool", name: c.name });
      else tl.push({ t: e.t, kind: "tool", name: c.name });
    }
    if (e.type === "user") for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (c.type !== "tool_result" || !open.has(c.tool_use_id)) continue;
      const k = tl[open.get(c.tool_use_id)];
      k.ms = e.t - k.t;
      k.out = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      k.error = !!c.is_error;
      if (k.error && /permission|not allowed|requires approval|denied/i.test(k.out)) k.denied = true;
    }
    if (e.type === "system" && e.subtype === "hook_response" && /SQUEAL|Squeal runs/.test(e.output ?? "")) tl.push({ t: e.t, kind: "squeal", hook: e.hook_name, text: e.output });
    if (e.type === "result") { cost = e.total_cost_usd ?? null; final = e.result ?? ""; turns = e.num_turns; usage = e.usage ?? null; }
  }
} else {
  const open = new Map();
  let thread = null;
  for (const e of ev) {
    if (e.type === "thread.started") thread = e.thread_id;
    if (e.type === "turn.completed") usage = e.usage;
    const i = e.item;
    if (!i) continue;
    if (i.type === "command_execution") {
      if (e.type === "item.started") open.set(i.id, tl.push({ t: e.t, kind: "cmd", cmd: String(i.command) }) - 1);
      if (e.type === "item.completed") {
        const k = open.has(i.id) ? tl[open.get(i.id)] : tl[tl.push({ t: e.t, kind: "cmd", cmd: String(i.command) }) - 1];
        k.ms = e.t - k.t; k.exit = i.exit_code; k.out = i.aggregated_output ?? "";
        if (/skills\/squeal\/SKILL\.md|skills\/squeal\/references/.test(k.cmd)) tl.push({ t: e.t, kind: "skill" });
      }
    }
    if (i.type === "file_change" && e.type === "item.completed") for (const c of i.changes ?? []) tl.push({ t: e.t, kind: "edit", path: c.path });
    if (i.type === "agent_message" && e.type === "item.completed") { tl.push({ t: e.t, kind: "say", text: i.text }); final = i.text; }
  }
  // SQUEAL texts the model received: developer messages in the rollout.
  const sessions = join(meta.cellDir ?? join(OUT, ".."), "codex", "sessions");
  const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)])) : []);
  for (const f of walk(sessions).filter((f) => thread && f.includes(thread))) for (const r of lines(f)) {
    const p = r.payload ?? {};
    if (p.type === "message" && p.role === "developer") for (const c of p.content ?? []) {
      if (/SQUEAL|Squeal runs/.test(c.text ?? "")) tl.push({ t: Date.parse(r.timestamp) - T0, kind: "squeal", hook: "developer", text: c.text });
    }
  }
  tl.sort((a, b) => a.t - b.t);
}

// ---------- classification ----------
const VITEST = /(?:^|[\s;&|(])(?:npx\s+(?:--yes\s+)?vitest|vitest(?:\s+run)?|node_modules\/\.bin\/vitest|npm\s+(?:run\s+)?test(?!:)|npm\s+t\b)(?=\s|$|;|&|\|)/;
const NODETEST = /(?:^|[\s;&|(])(?:node\s+(?:[^|;&]*\s)?--test\b|npm\s+run\s+test:scripts)/;
const SQUEAL = /(?:^|[\s/"'])squeal(?:\.mjs)?\\?["']?\s+(status|why|run|start|stop|init)\b([^;&|\n]*)/;
const stripQuoted = (s) => s.replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\2\b/g, " ").replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (m) => (/vitest|--test/.test(m) && m.length < 40 ? m : '""'));

function scope(cmd) {
  if (/\s(?:-t|--testNamePattern)[\s=]/.test(cmd)) return "name";
  const tail = (cmd.split(/vitest(?:\s+run)?|npm\s+(?:run\s+)?test(?:\s+--)?/)[1] ?? "").split(/[|;&]|\d?>/)[0];
  const files = tail.replace(/["']/g, " ").trim().split(/\s+/).filter((a) => a && !a.startsWith("-") && a !== "run");
  return files.length ? "files" : "full";
}

const runs = [], pulls = [], sleeps = [];
// Codex runs every command as `/bin/bash -lc '<script>'`: match inside the wrapper.
const unwrap = (cmd) => {
  const m = /^\/bin\/(?:ba)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(cmd.trim());
  if (!m) return cmd;
  return m[1] === "'" ? m[2].replaceAll(`'"'"'`, "'") : m[2].replace(/\\(["\\$`])/g, "$1");
};
for (const k of tl.filter((k) => k.kind === "cmd")) {
  k.cmd = unwrap(k.cmd);
  const c = stripQuoted(k.cmd);
  const sq = SQUEAL.exec(k.cmd.replace(/\\\n/g, " ")); // raw: Codex quotes the CLI's absolute path
  if (sq) pulls.push({ t: k.t, sub: sq[1] + (/--wait/.test(sq[2]) ? " --wait" : "") + (/--all/.test(sq[2]) ? " --all" : "") + (/--slow/.test(sq[2]) ? " --slow" : ""), ms: k.ms, exit: k.exit, denied: !!k.denied });
  else if (VITEST.test(c)) runs.push({ t: k.t, runner: "vitest", scope: scope(c), ms: k.ms, exit: k.exit, denied: !!k.denied, cmd: k.cmd.slice(0, 160) });
  if (NODETEST.test(c)) runs.push({ t: k.t, runner: "node:test", scope: /test:scripts|--test\s*$|--test\s+['"]?scripts\/\*/.test(c) ? "full" : "files", ms: k.ms, exit: k.exit, denied: !!k.denied, cmd: k.cmd.slice(0, 160) });
  if (/(?:^|[\s;&])sleep\s+\d/.test(c)) sleeps.push({ t: k.t, cmd: k.cmd.slice(0, 120) });
}

const rel = (p) => String(p).replace(/^.*\/work\//, "");
const edits = tl.filter((k) => k.kind === "edit").map((k) => ({ t: k.t, path: rel(k.path) }));
// Codex edits through shell (sed -i, heredocs, apply_patch in a command) count as edits too.
for (const k of tl.filter((k) => k.kind === "cmd")) if (/\bapply_patch\b|\bsed\s+-i\b|cat\s+>\s*\S+|tee\s+\S+|>\s*src\/|>\s*test\//.test(k.cmd)) edits.push({ t: k.t, path: "(shell)" });
edits.sort((a, b) => a.t - b.t);
const lastEdit = edits.at(-1)?.t ?? null;

// SQUEAL deliveries: what kind, and what the agent did next after the first one naming a failure.
const deliveries = tl.filter((k) => k.kind === "squeal").map((k) => ({
  t: k.t, hook: k.hook,
  kind: /"permissionDecision":\s*"deny"|"decision":\s*"block"/.test(k.text) ? "deny" : /Squeal runs this repository/.test(k.text) && !/FAIL|RESOLVED/.test(k.text) ? "registration" : /FAIL/.test(k.text) ? "fail" : /RESOLVED|-> PASS|FAIL -> PASS/.test(k.text) ? "resolved" : "other",
  head: (/SQUEAL ·[^\n\\]*/.exec(k.text)?.[0] ?? "").slice(0, 140),
  temp: /\.tmp\.\d+\.[0-9a-f]+/.test(k.text),
}));
const firstFail = deliveries.find((d) => d.kind === "fail" || d.kind === "deny");
let reaction = null;
if (firstFail) {
  const next = tl.find((k) => k.t > firstFail.t && ["cmd", "edit", "read", "skill", "tool"].includes(k.kind));
  if (next) reaction = { ms: next.t - firstFail.t, kind: next.kind, what: (next.cmd ?? next.path ?? next.name ?? "").slice(0, 120) };
}

// ---------- final claim against ground truth and Squeal ----------
const claimLine = [...final.matchAll(/TESTS:\s*\**\s*(pass|fail|unknown)\b[^\n]*/gi)].at(-1);
const claim = claimLine ? claimLine[1].toLowerCase() : null;
let truth = null;
try {
  const v = JSON.parse(readFileSync(join(OUT, "truth.vitest.json"), "utf8"));
  const nodeExit = Number(/node:test exit (\d+)/.exec(readFileSync(join(OUT, "truth.txt"), "utf8"))?.[1] ?? 0);
  const failed = v.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === "failed").map((a) => `${f.name.replace(/^.*\/work\//, "")} > ${a.fullName}`));
  const fileErrors = v.testResults.filter((f) => f.status === "failed" && !f.assertionResults.some((a) => a.status === "failed")).map((f) => f.name.replace(/^.*\/work\//, ""));
  truth = { vitestFailed: failed.length + fileErrors.length, failed: [...failed, ...fileErrors], nodeTestFailed: nodeExit !== 0, pass: failed.length + fileErrors.length === 0 && nodeExit === 0 };
} catch (e) { truth = { error: String(e) }; }
const statusEnd = existsSync(join(OUT, "status-end.txt")) ? readFileSync(join(OUT, "status-end.txt"), "utf8") : "";
const squealEnd = statusEnd ? {
  knownFailures: Number(/^Known failures: (\d+)/m.exec(statusEnd)?.[1] ?? NaN),
  pending: /(\d+) running, (\d+) queued/.exec(statusEnd)?.slice(1).map(Number).reduce((a, b) => a + b, 0) ?? null,
  slowCurrent: /Slow tier: .*\b1 current\b/.test(statusEnd),
} : null;
const claimTrue = claim === null || truth.pass === undefined ? null : claim === "unknown" ? "hedged" : (claim === "pass") === truth.pass;

const editedScripts = edits.some((e) => /^scripts\/.*\.mjs$/.test(e.path)) || tl.some((k) => k.kind === "cmd" && /scripts\/changelog/.test(k.cmd) && /sed -i|apply_patch|cat >|tee /.test(k.cmd));
// A command the harness refused never ran: an attempt, not a run.
const nodeRuns = runs.filter((r) => r.runner === "node:test" && !r.denied);
const vitestRuns = runs.filter((r) => r.runner === "vitest" && !r.denied);
const waitsAfterLastEdit = pulls.filter((p) => lastEdit !== null && p.t > lastEdit && /--wait/.test(p.sub)).length;

const grade = {
  ...meta,
  cost, usage, turns,
  edits: edits.length,
  vitestRuns: vitestRuns.length,
  vitestByScope: Object.fromEntries(["full", "files", "name"].map((s) => [s, vitestRuns.filter((r) => r.scope === s).length])),
  vitestMs: vitestRuns.reduce((a, r) => a + (r.ms ?? 0), 0),
  vitestAfterLastEdit: vitestRuns.filter((r) => lastEdit !== null && r.t > lastEdit).length,
  testAttemptsRefused: runs.filter((r) => r.denied).length,
  nodeTestRuns: nodeRuns.length,
  nodeTestWanted: editedScripts,
  squealPulls: pulls.length,
  squealWaits: pulls.filter((p) => /--wait/.test(p.sub)).length,
  squealWhy: pulls.filter((p) => p.sub.startsWith("why")).length,
  squealRunAll: pulls.filter((p) => /run.*--all/.test(p.sub)).length,
  squealRunSlow: pulls.filter((p) => /--slow/.test(p.sub)).length,
  waitsAfterLastEdit,
  sleeps: sleeps.length,
  skillLoads: tl.filter((k) => k.kind === "skill").length,
  deliveries: Object.fromEntries(["registration", "fail", "deny", "resolved", "other"].map((k) => [k, deliveries.filter((d) => d.kind === k).length])),
  reactionToFirstFail: reaction,
  tempFileHeaders: deliveries.filter((d) => d.temp).length,
  claim, claimLine: claimLine?.[0]?.slice(0, 300) ?? null, truth, squealEnd, claimTrue,
  timeline: { runs, pulls, sleeps, edits, deliveries },
};
writeFileSync(join(OUT, "grade.json"), JSON.stringify(grade, null, 2));
const short = `${meta.id}\twall ${meta.wallS}s\tload ${meta.load.mean}\tvitest ${grade.vitestRuns} (${JSON.stringify(grade.vitestByScope)})\tnode:test ${grade.nodeTestRuns}${editedScripts ? " (wanted)" : ""}\tsqueal ${grade.squealPulls} (waits ${grade.squealWaits}, why ${grade.squealWhy}, run-all ${grade.squealRunAll})\tsleep ${grade.sleeps}\tskill ${grade.skillLoads}\tclaim ${claim} truth ${truth.pass === undefined ? "?" : truth.pass ? "pass" : "fail"} -> ${claimTrue}\t${cost !== null ? "$" + cost.toFixed(3) : "tok " + (usage?.input_tokens ?? "?") + "/" + (usage?.output_tokens ?? "?")}`;
console.log(short);
