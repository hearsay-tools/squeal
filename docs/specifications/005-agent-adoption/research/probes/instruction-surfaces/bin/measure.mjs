// Throwaway: one row per subject session from /tmp/r52/logs/<label>.*.
//   node measure.mjs <label>... [--json] [--final]
// Claude Code: stream-json (tool_use to tool_result, hook outputs, cost).
// Codex: `exec --json` events (command_execution items, usage) and its rollout
// under the scratch CODEX_HOME for the SQUEAL texts the model received.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const R = "/tmp/r52";
const args = process.argv.slice(2);
const labels = args.filter((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const showFinal = args.includes("--final");

const TEST = /(^|[\s;&|(])(npx\s+vitest|vitest\s+run|npm\s+(run\s+)?test|node_modules\/\.bin\/vitest)\b/;
const SQUEAL = /(^|[\s;&|("'])(squeal|[^\s"']*squeal\.mjs["']?)\s+(status|why|run|start)\b/;

function scope(cmd) {
  if (/\s-t\s|--testNamePattern/.test(cmd)) return "name";
  // The words after `vitest [run]` up to the first pipe, redirect or chain.
  const tail = (cmd.split(/vitest(?:\s+run)?|npm\s+(?:run\s+)?test(?:\s+--)?/)[1] ?? "").split(/[|;&]|\d?>/)[0];
  const rest = tail.replace(/["']/g, " ").trim().split(/\s+/).filter((a) => a && !a.startsWith("-") && a !== "run");
  return rest.length ? `files:${rest.length}` : "full";
}

function classify(cmd) {
  const out = [];
  if (SQUEAL.test(cmd)) {
    const sub = cmd.match(SQUEAL)[3];
    out.push(/--wait/.test(cmd) ? `squeal ${sub} wait` : `squeal ${sub}`);
  }
  if (TEST.test(cmd) && !/squeal/.test(cmd.split(TEST)[0] ?? "")) out.push(`test ${scope(cmd)}`);
  if (/skills\/squeal\/SKILL\.md|references\/(commands|reports|policy)\.md/.test(cmd)) out.push("skill read");
  return out;
}

const lines = (f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

function claude(label) {
  const ev = lines(join(R, "logs", `${label}.events.jsonl`));
  const calls = new Map();
  const rows = [];
  let squealTexts = 0, result = null, hooks = [];
  for (const e of ev) {
    if (e.type === "assistant") for (const c of e.message.content) {
      if (c.type !== "tool_use") continue;
      const cmd = c.name === "Bash" ? c.input.command : c.name === "Skill" ? `skill:${c.input.skill ?? c.input.command}` : c.name === "Read" ? `read ${c.input.file_path}` : c.name;
      calls.set(c.id, { t: e.t, tool: c.name, cmd });
    }
    if (e.type === "user" && Array.isArray(e.message?.content)) for (const c of e.message.content) {
      if (c.type !== "tool_result" || !calls.has(c.tool_use_id)) continue;
      const k = calls.get(c.tool_use_id); k.ms = e.t - k.t; rows.push(k);
      const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      if (c.is_error && /permission|approv|not allowed|denied/i.test(text)) k.denied = true;
    }
    if (e.type === "system" && e.subtype === "hook_response" && /SQUEAL ·|Squeal runs/.test(e.output ?? "")) {
      squealTexts++; hooks.push(`${e.hook_name}@${e.t}`);
    }
    if (e.type === "result") result = e;
  }
  for (const k of calls.values()) if (k.ms === undefined) rows.push(k);
  return { calls: rows, squealTexts, hooks, cost: result?.total_cost_usd ?? null, final: result?.result ?? "", turns: result?.num_turns };
}

function rollout(thread) {
  const base = join(R, "codex", "sessions");
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)]);
  return walk(base).filter((f) => f.includes(thread));
}

function codex(label) {
  const ev = lines(join(R, "logs", `${label}.events.jsonl`));
  const open = new Map(); const rows = []; let usage = null, final = "", thread = null;
  for (const e of ev) {
    if (e.type === "thread.started") thread = e.thread_id;
    const i = e.item;
    if (i?.type === "command_execution") {
      if (e.type === "item.started") open.set(i.id, { t: e.t, tool: "shell", cmd: i.command });
      if (e.type === "item.completed") { const k = open.get(i.id) ?? { t: e.t, tool: "shell", cmd: i.command }; k.ms = e.t - k.t; k.exit = i.exit_code; rows.push(k); open.delete(i.id); }
    }
    if (i?.type === "file_change" && e.type === "item.completed") rows.push({ t: e.t, tool: "apply_patch", cmd: "apply_patch", ms: 0 });
    if (i?.type === "agent_message") final = i.text;
    if (e.type === "turn.completed") usage = e.usage;
  }
  let squealTexts = 0; const hooks = [];
  for (const f of thread ? rollout(thread) : []) for (const e of lines(f)) {
    const p = e.payload ?? {};
    if (p.type === "message" && p.role === "developer") for (const c of p.content ?? [])
      if (/SQUEAL ·|Squeal runs/.test(c.text ?? "")) { squealTexts++; hooks.push((c.text.match(/SQUEAL · [^\n]*/) ?? ["primer"])[0].slice(0, 40)); }
  }
  return { calls: rows.sort((a, b) => a.t - b.t), squealTexts, hooks, usage, final, thread };
}

function truth(label) {
  const f = join(R, "logs", `${label}.truth.txt`);
  if (!existsSync(f)) return null;
  const t = readFileSync(f, "utf8");
  const m = t.match(/^\s+Tests\s+(.*)$/m);
  return m ? m[1].replace(/\s*\(\d+\)$/, "").trim() : t.slice(-80);
}

const out = [];
for (const label of labels) {
  const isCodex = readFileSync(join(R, "logs", `${label}.events.jsonl`), "utf8").includes('"thread.started"');
  const s = isCodex ? codex(label) : claude(label);
  const t0 = Number(readFileSync(join(R, "logs", `${label}.t0`), "utf8"));
  const t1 = Number(readFileSync(join(R, "logs", `${label}.t1`), "utf8"));
  const tagged = s.calls.map((c) => ({ ...c, tags: classify(c.cmd ?? "").concat(c.tool === "Skill" && /squeal/.test(c.cmd) ? ["skill load"] : [], c.tool === "Read" && /skills\/squeal/.test(c.cmd) ? ["skill read"] : []) }));
  const tests = tagged.filter((c) => c.tags.some((x) => x.startsWith("test")));
  const sq = tagged.filter((c) => c.tags.some((x) => x.startsWith("squeal")));
  const row = {
    label, harness: isCodex ? "codex" : "claude",
    wallS: +((t1 - t0) / 1000).toFixed(1),
    tests: tests.map((c) => `${c.tags.find((x) => x.startsWith("test")).slice(5)} ${((c.ms ?? 0) / 1000).toFixed(1)}s${c.denied ? " DENIED" : ""}`),
    squeal: sq.map((c) => `${c.tags.find((x) => x.startsWith("squeal")).slice(7)} ${((c.ms ?? 0) / 1000).toFixed(1)}s${c.denied ? " DENIED" : ""}${c.exit ? ` exit ${c.exit}` : ""}`),
    skill: tagged.filter((c) => c.tags.some((x) => x.startsWith("skill"))).length,
    squealTexts: s.squealTexts,
    cost: s.cost ?? null, usage: s.usage ?? null,
    truth: truth(label),
    final: s.final,
  };
  out.push(row);
}
if (asJson) console.log(JSON.stringify(out, null, 2));
else for (const r of out) {
  console.log(`${r.label}\t${r.harness}\twall ${r.wallS}s\ttests [${r.tests.join(", ")}]\tsqueal [${r.squeal.join(", ")}]\tskill ${r.skill}\ttexts ${r.squealTexts}\t${r.cost !== null ? "$" + r.cost.toFixed(3) : "tok " + (r.usage?.input_tokens ?? "?") + "/" + (r.usage?.output_tokens ?? "?")}\ttruth: ${r.truth}`);
  if (showFinal) console.log("   FINAL: " + r.final.slice(-700).replace(/\n+/g, " ⏎ ") + "\n");
}
