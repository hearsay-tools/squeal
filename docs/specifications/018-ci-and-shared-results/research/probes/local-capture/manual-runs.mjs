// throwaway (row 018-22): test runs agents started themselves, from session records.
// Reads Claude Code transcripts (main and subagent files) and Codex rollouts; writes nothing
// but its --json output. The classifier is copied from 005's adoption-baseline/metric.mjs
// (classifyTest, segments) so the two counts compare. Usage:
//   node manual-runs.mjs --from 2026-11-02 --to 2026-11-09 --json out.json --skip <session id>
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : process.argv[i + 1]; };
const FROM = Date.parse(arg("--from") + "T00:00:00Z"), TO = Date.parse(arg("--to") + "T00:00:00Z");
const SKIP = arg("--skip", "none");
const HOME = process.env.HOME;
const repoOf = (cwd) => /\/projects\/squeal(\/|$)/.test(cwd ?? "") ? "squeal" : /\/projects\/cezar(\/|$)/.test(cwd ?? "") ? "cezar" : null;

// ---- copied from adoption-baseline/metric.mjs ----
const SQUEAL_CLI = /(?:^|[\s/"'])squeal(?:\.mjs)?["']?\s+(status|why|run|start|stop|init|remove)\b([^;&|\n]*)/;
const TEST_SEGMENT = /(?:^|\s)(?:npx\s+(?:--yes\s+)?vitest|vitest|npm\s+(?:run\s+)?test(?::[\w:-]+)?|npm\s+t\b|pnpm\s+(?:run\s+)?test|yarn\s+test|node\s+(?:[^|;&]*\s)?--test\b|node_modules\/\.bin\/vitest)/;
function segments(cmd) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  let masked = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?(?:\n\2\b|$)/g, (m) => m.slice(0, 2) + blank(m.slice(2)));
  masked = masked.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (m) => m[0] + blank(m.slice(1, -1)) + m[m.length - 1]);
  const out = []; const re = /&&|\|\||;|\n|\|/g; let from = 0, m;
  while ((m = re.exec(masked + "\n"))) { const seg = masked.slice(from, m.index); if (seg.trim()) out.push({ masked: seg, text: cmd.slice(from, m.index) }); from = m.index + m[0].length; }
  return out;
}
function classifyTest(cmd) {
  for (const { masked, text: seg } of segments(cmd)) {
    const m = masked.match(TEST_SEGMENT); if (!m) continue;
    const before = masked.slice(0, m.index);
    if (/\b(?:grep|rg|cat|sed|echo|printf|git|ps|pgrep|pkill|kill|which|ls)\b/.test(before)) continue;
    if (/^\s*(?:#|\/\/)/.test(masked) || SQUEAL_CLI.test(seg)) continue;
    // added for 018-22: the runner word must be the command, after wrappers only
    if (!/^\s*\(?\s*(?:(?:timeout(?:\s+-[\w=-]+)*\s+\d+[smh]?|nice(?:\s+-n\s*\d+)?|env(?:\s+-u\s+\w+)*|time|nohup|stdbuf\s+\S+|[A-Za-z_][A-Za-z0-9_]*=\S*)\s+)*(?:(?:pnpm\s+exec|pnpm|npm\s+exec|npx(?:\s+--no-install|\s+--yes)?|yarn)\s+)?$/.test(before + " ")) continue;
    // node:test only when no script comes before --test (cezar's check.mjs takes a --test flag)
    if (/--test\b/.test(m[0]) && scriptBeforeTest(m[0])) continue;
    const runner = /--test\b/.test(m[0]) ? "node:test" : /vitest/.test(m[0]) ? "vitest" : "npm-script";
    const rest = seg.slice(m.index + m[0].length);
    if (runner === "vitest" && /^\s*(?:list|bench|typecheck|--version|-v\b|--help)/.test(rest)) continue;
    const pattern = /(?:^|\s)(?:-t|--testNamePattern|--test-name-pattern)(?:[=\s])/.test(rest);
    const args = rest.replace(/(?:^|\s)(?:-t|--testNamePattern|--test-name-pattern)(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g, " ").replace(/(?:^|\s)--[\w-]+(?:=\S+)?/g, " ").replace(/(?:^|\s)-\w\b/g, " ").replace(/(?:^|\s)(?:run|related)\b/, " ").replace(/\d?>&?\d?\s*\S+/g, " ").trim();
    const files = args.split(/\s+/).filter((a) => a && /[/.]/.test(a) && !/^-/.test(a) && !/^\d+$/.test(a));
    const unlisted = /(?:^|\s)["']?\$/.test(args);
    const scope = pattern ? "pattern" : files.length || unlisted ? "files" : "full";
    return { runner, scope, files, segment: seg.trim(), rest };
  }
  return null;
}
// ---- end of copy ----
function scriptBeforeTest(text) {
  const words = text.trim().split(/\s+/).slice(1);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "--test") return false;
    if (/^(?:--import|-r|--require|--loader|--experimental-loader|--env-file)$/.test(w)) { i++; continue; }
    if (!w.startsWith("-")) return true;
  }
  return false;
}

/** The form the run took and the traits that decide capture and storage. */
function traits(cmd, t) {
  const s = t.segment;
  const form = /pnpm\s+exec\s+vitest/.test(s) ? "pnpm exec vitest" : /npx\s+(?:--yes\s+)?vitest/.test(s) ? "npx vitest"
    : /node_modules\/\.bin\/vitest/.test(s) ? "node_modules/.bin/vitest" : /(?:^|\s)vitest/.test(s) ? "vitest (bare)"
    : /--test\b/.test(s) ? "node --test" : /pnpm\s/.test(s) ? "pnpm script" : /npm\s/.test(s) ? "npm script" : "other";
  return {
    form,
    pipeOrChain: segments(cmd).length > 1 || /[<>]/.test(cmd.replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*/, "")),
    namePattern: t.scope === "pattern",
    update: /(?:^|\s)(?:-u|--update)\b/.test(t.rest),
    watch: /(?:^|\s)(?:--watch|-w)\b/.test(t.rest) || (/vitest/.test(form) && !/^\s*run\b/.test(t.rest) && !/--run\b/.test(t.rest) && !/related/.test(t.rest)),
    coverage: /--coverage/.test(t.rest),
    elsewhere: /(?:^|[;&|(]\s*)cd\s+["']?(?:\/(?!home\/agent\/projects\/(?:squeal|cezar)\/\.ai\/cezar\/worktrees\/)|\$|~|\.\.)/.test(cmd) || /--(?:root|dir)[=\s]/.test(t.rest),
    lineFilter: /:\d+(?:-\d+)?(?:\s|$)/.test(t.rest),
    otherFlags: [...t.rest.matchAll(/(?:^|\s)(--?[A-Za-z][\w.-]*)/g)].map((m) => m[1]).filter((f) => !/^(-t|--testNamePattern|-u|--update|--run|--reporter|--silent|--coverage)$/.test(f)),
  };
}

/** Vitest's summary: wall Duration and the summed worker parts, in seconds; node:test's duration_ms. */
function durations(text) {
  const sec = (v, u) => (u === "ms" ? Number(v) / 1000 : u === "m" ? Number(v) * 60 : Number(v));
  const out = { vitestWall: null, vitestParts: null, outcome: null };
  const d = [...text.matchAll(/Duration\s+([\d.]+)(ms|s|m)\s*\(transform ([\d.]+)(ms|s|m), setup ([\d.]+)(ms|s|m),(?: collect ([\d.]+)(ms|s|m),)? (?:import ([\d.]+)(ms|s|m), )?tests ([\d.]+)(ms|s|m), environment ([\d.]+)(ms|s|m)/g)].pop();
  if (d) {
    out.vitestWall = sec(d[1], d[2]);
    out.vitestParts = sec(d[3], d[4]) + sec(d[5], d[6]) + (d[7] ? sec(d[7], d[8]) : 0) + (d[9] ? sec(d[9], d[10]) : 0) + sec(d[11], d[12]) + sec(d[13], d[14]);
  }
  const files = [...text.matchAll(/Test Files\s+(?:(\d+) failed)?[ |]*(?:(\d+) passed)?/g)].pop();
  if (files) out.outcome = files[1] ? "fail" : "pass";
  const nt = [...text.matchAll(/# fail (\d+)/g)].pop(); if (nt) out.outcome = nt[1] === "0" ? "pass" : "fail";
  return out;
}

async function* lines(file) { const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity }); for await (const l of rl) { if (l) { try { yield JSON.parse(l); } catch {} } } }
function* walk(dir) { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith(".jsonl")) yield p; } }

const runs = []; const sessions = new Map();
async function claude(file) {
  if (file.includes(SKIP)) return;
  if (fs.statSync(file).mtimeMs < FROM) return;
  const pending = new Map(); let cwd = null, squealSeen = false;
  for await (const j of lines(file)) {
    if (j.cwd) cwd ??= j.cwd;
    const s = JSON.stringify(j.message?.content ?? j.attachment ?? "");
    if (!squealSeen && s.includes("SQUEAL ·")) squealSeen = true;
    const t = j.timestamp ? Date.parse(j.timestamp) : null;
    if (j.type === "assistant" && Array.isArray(j.message?.content)) for (const c of j.message.content) if (c.type === "tool_use" && c.name === "Bash") pending.set(c.id, { t, cmd: String(c.input?.command ?? ""), bg: !!c.input?.run_in_background });
    if (j.type === "user" && Array.isArray(j.message?.content)) for (const c of j.message.content) if (c.type === "tool_result" && pending.has(c.tool_use_id)) {
      const p = pending.get(c.tool_use_id); pending.delete(c.tool_use_id);
      const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      add("claude-code", file, cwd, p.t, t, p.cmd, text, p.bg, squealSeen);
    }
  }
}
async function codex(file) {
  if (fs.statSync(file).mtimeMs < FROM) return;
  const pending = new Map(); let cwd = null, squealSeen = false;
  for await (const j of lines(file)) {
    if (j.type === "session_meta") cwd = j.payload?.cwd;
    if (repoOf(cwd) === null) return;
    const t = j.timestamp ? Date.parse(j.timestamp) : null;
    const p = j.payload ?? {};
    if (!squealSeen && JSON.stringify(p).includes("SQUEAL ·")) squealSeen = true;
    if (j.type === "event_msg" && p.type === "item_completed" && p.item?.type === "CommandExecution") {
      const i = p.item; const cmd = Array.isArray(i.command) ? i.command[i.command.length - 1] : String(i.command);
      const dur = typeof i.duration === "object" && i.duration ? (i.duration.secs ?? 0) * 1000 + (i.duration.nanos ?? 0) / 1e6 : typeof i.duration === "number" ? i.duration : null;
      const end = p.completed_at_ms ?? t;
      add("codex", file, cwd, dur != null ? end - dur : end, end, cmd, String(i.aggregated_output ?? i.stdout ?? ""), false, squealSeen);
      continue;
    }
    if (j.type === "response_item" && p.type === "function_call" && /^(?:shell|exec_command|local_shell)$/.test(p.name)) {
      let cmd = ""; try { const a = JSON.parse(p.arguments); cmd = Array.isArray(a.command) ? a.command.join(" ") : a.cmd ?? a.command ?? ""; } catch {}
      pending.set(p.call_id, { t, cmd });
    }
    if (j.type === "response_item" && p.type === "function_call_output" && pending.has(p.call_id)) {
      const q = pending.get(p.call_id); pending.delete(p.call_id);
      add("codex", file, cwd, q.t, t, q.cmd, typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? ""), false, squealSeen);
    }
  }
}
function add(harness, file, cwd, t0, t1, cmd, text, bg, squealSeen) {
  const repo = repoOf(cwd); if (repo === null || t0 === null || t0 < FROM || t0 >= TO) return;
  const key = file; const s = sessions.get(key) ?? { harness, repo, runs: 0, cmds: 0 }; s.cmds++; sessions.set(key, s);
  const c = classifyTest(cmd); if (c === null) return; s.runs++;
  runs.push({ harness, repo, session: path.basename(file, ".jsonl"), subagent: file.includes("/subagents/"), t: new Date(t0).toISOString(), wallS: t1 && !bg ? (t1 - t0) / 1000 : null, background: bg, squealSeen, runner: c.runner, scope: c.scope, nFiles: c.files.length, cmd: cmd.slice(0, 400), segment: c.segment.slice(0, 240), ...traits(cmd, c), ...durations(text) });
}

for (const d of fs.readdirSync(path.join(HOME, ".claude/projects"))) {
  if (!/^-home-agent-projects-(squeal|cezar)(-|$)/.test(d)) continue;
  for (const f of walk(path.join(HOME, ".claude/projects", d))) await claude(f);
}
for (const day of ["2026/11/01","2026/11/02","2026/11/03","2026/11/04","2026/11/05","2026/11/06","2026/11/07","2026/11/08","2026/11/09"]) for (const f of walk(path.join(HOME, ".codex/sessions", day))) await codex(f);
fs.writeFileSync(arg("--json"), JSON.stringify({ from: arg("--from"), to: arg("--to"), sessions: [...sessions.values()], runs }, null, 1));
console.log(`sessions with a shell command: ${sessions.size}; runs: ${runs.length}`);
