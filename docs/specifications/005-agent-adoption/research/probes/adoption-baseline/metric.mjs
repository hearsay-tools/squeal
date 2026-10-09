#!/usr/bin/env node
// Throwaway probe for 005-01 (adoption-baseline). Not product code.
//
// The adoption metric, per session, from records alone (no transcript reading by hand):
//   test runs the agent started, by scope (full, files, name pattern) and runner;
//   Squeal pulls (status, why, run) and waits (status --wait), skill loads;
//   Squeal messages that reached the model (registration, transitions, deny, Stop block);
//   for each run: the Squeal state the agent last saw, edits since, a reason class;
//   with --store <copy>: whether Squeal held a current result for every file the run covered;
//   final-claim flags: a pass claim against known failures, pending checks, or no evidence.
//
// Input, any mix of files and directories (searched for *.jsonl):
//   Claude Code transcripts (~/.claude/projects/<dir>/<session>.jsonl) and `claude -p
//   --output-format stream-json --verbose [--include-hook-events]` output;
//   Codex rollouts (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) and `codex exec --json` output.
//
// Usage: node metric.mjs [--store <copy of store.sqlite>] [--json out.json] [--runs] <paths...>
// The store must be a copy: never point this at a live Squeal store.

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = { store: null, json: null, runs: false, label: null };
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--store") opt.store = argv[++i];
  else if (a === "--json") opt.json = argv[++i];
  else if (a === "--runs") opt.runs = true;
  else if (a === "--label") opt.label = argv[++i];
  else inputs.push(a);
}

function* jsonlFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) { if (p.endsWith(".jsonl")) yield p; return; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory() && e.name === "subagents") continue; // main sessions only
    yield* jsonlFiles(path.join(p, e.name));
  }
}

// ---------- command classification ----------

const SQUEAL_CLI = /(?:^|[\s/"'])squeal(?:\.mjs)?["']?\s+(status|why|run|start|stop|init|remove)\b([^;&|\n]*)/;
const TEST_SEGMENT =
  /(?:^|\s)(?:npx\s+(?:--yes\s+)?vitest|vitest|npm\s+(?:run\s+)?test(?::[\w:-]+)?|npm\s+t\b|pnpm\s+(?:run\s+)?test|yarn\s+test|node\s+(?:[^|;&]*\s)?--test\b|node_modules\/\.bin\/vitest)/;

/**
 * Split a shell command into simple segments (&&, ||, ;, |, newlines), rough on purpose. Heredoc
 * bodies and quoted text are blanked first, so a test command quoted in a note, an echo or a
 * Python string is not a run; each segment is returned from the original text.
 */
function segments(cmd) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  let masked = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?(?:\n\2\b|$)/g, (m) => m.slice(0, 2) + blank(m.slice(2)));
  masked = masked.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (m) => m[0] + blank(m.slice(1, -1)) + m[m.length - 1]);
  const out = [];
  const re = /&&|\|\||;|\n|\|/g;
  let from = 0, m;
  while ((m = re.exec(masked + "\n"))) {
    const seg = masked.slice(from, m.index);
    if (seg.trim()) out.push({ masked: seg, text: cmd.slice(from, m.index) });
    from = m.index + m[0].length;
  }
  return out;
}

/** A test run the agent started, or null. Scope: full, files, pattern; runner: vitest, node:test, npm. */
export function classifyTest(cmd) {
  for (const { masked, text: seg } of segments(cmd)) {
    const m = masked.match(TEST_SEGMENT);
    if (!m) continue;
    const before = masked.slice(0, m.index);
    if (/\b(?:grep|rg|cat|sed|echo|printf|git|ps|pgrep|pkill|kill|which|ls)\b/.test(before)) continue;
    if (/^\s*(?:#|\/\/)/.test(masked) || SQUEAL_CLI.test(seg)) continue;
    const runner = /--test\b/.test(m[0]) ? "node:test" : /vitest/.test(m[0]) ? "vitest" : "npm-script";
    const rest = seg.slice(m.index + m[0].length);
    if (runner === "vitest" && /^\s*(?:list|bench|typecheck|--version|-v\b|--help)/.test(rest)) continue;
    const pattern = /(?:^|\s)(?:-t|--testNamePattern|--test-name-pattern)(?:[=\s])/.test(rest);
    const args = rest
      .replace(/(?:^|\s)(?:-t|--testNamePattern|--test-name-pattern)(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g, " ")
      .replace(/(?:^|\s)--[\w-]+(?:=\S+)?/g, " ")
      .replace(/(?:^|\s)-\w\b/g, " ")
      .replace(/(?:^|\s)(?:run|related)\b/, " ")
      .replace(/\d?>&?\d?\s*\S+/g, " ")
      .trim();
    const files = args.split(/\s+/).filter((a) => a && /[/.]/.test(a) && !/^-/.test(a) && !/^\d+$/.test(a));
    // a shell variable or substitution names files the record does not list
    const unlisted = /(?:^|\s)["']?\$/.test(args);
    const scope = pattern ? "pattern" : files.length || unlisted ? "files" : "full";
    if (unlisted && !files.length) files.push("$unlisted");
    return { runner, scope, files, segment: seg.trim().slice(0, 240) };
  }
  return null;
}

export function classifySqueal(cmd) {
  const m = cmd.match(SQUEAL_CLI);
  if (!m) return null;
  const verb = m[1];
  const wait = verb === "status" && /--wait\b/.test(m[2]);
  return { verb: wait ? "status --wait" : verb === "run" && /--all/.test(m[2]) ? "run --all" : verb === "run" && /--slow/.test(m[2]) ? "run --slow" : verb };
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
function isShellEdit(cmd) {
  return /\bapply_patch\b|(?:^|[^>2&])>\s*[\w./-]+\.(?:ts|js|mjs|cjs|json|md)\b|\bsed\s+-i\b|\btee\s+[\w./-]+|\bwriteFileSync\b|\bnpm\s+run\s+build\b/.test(cmd);
}

/** The run's outcome from its output; the exit code only when nothing pipes it away. */
function outcomeOf(cmd, text, exit) {
  const t = String(text ?? "");
  const files = t.match(/Test Files\s+(?:(\d+) failed)?/);
  if (/Test Files\s+\d+ failed|Tests\s+\d+ failed|^# fail [1-9]|ℹ fail [1-9]/m.test(t)) return "fail";
  if (files || /^# fail 0|ℹ fail 0/m.test(t)) return "pass";
  if (exit != null && !/\|\s*(?:tail|head|grep|rg|sed|awk|tee)\b|>\s*\S+\.log|;\s*echo/.test(cmd)) return exit === 0 ? "pass" : "fail";
  return "unknown";
}

// ---------- Squeal text parsing ----------

function squealState(text) {
  const s = { kind: "other" };
  if (/registered at revision/.test(text)) s.kind = "registration";
  else if (/checks? changed at revision|baseline run found/.test(text)) s.kind = "transitions";
  else if (/policy interrupt\.onRegression denied|was not applied/.test(text)) s.kind = "deny";
  else if (/stop\.blockOnKnownFailures/.test(text)) s.kind = "stop-block";
  else if (/status at revision/.test(text)) s.kind = "status";
  const r = text.match(/Revision (\d+)[^:]*: (\d+) current, (\d+) pending, (\d+) stale, (\d+) unknown/);
  if (r) Object.assign(s, { revision: +r[1], current: +r[2], pending: +r[3], stale: +r[4], unknown: +r[5] });
  const k = text.match(/Known failures: (\d+)/);
  if (k) s.knownFailures = +k[1];
  // case-sensitive: the primer's "when no daemon is validating" is not a liveness report
  if (/No daemon has validated since|no daemon is validating at revision|Returned without a daemon/.test(text)) s.noDaemon = true;
  if (/counts are not complete|test files without checks|not listed this worktree/.test(text)) s.incomplete = true;
  const full = text.match(/Full-suite checkpoint: completed at revision (\d+)|Full suite: completed at revision (\d+)/);
  if (full && s.revision != null && +(full[1] ?? full[2]) === s.revision) s.fullAtRevision = true;
  const q = text.match(/Returned on (quiet|news|timeout)/);
  if (q) s.waitOutcome = q[1];
  return s;
}

// ---------- reason classes, from the agent's own words before a run ----------

const REASONS = [
  ["no-daemon", /no daemon|daemon (?:is |was )?(?:not running|inactive|down|dead)|wasn.t validating|isn.t validating|not validating|without a daemon/i],
  ["coverage-text", /only covers? vitest|squeal (?:only )?covers? only|outside squeal|doesn.t cover|does not cover|squeal.s stated (?:vitest )?coverage|vitest-only/i],
  ["gate", /\bgates?\b|AGENTS\.md|CLAUDE\.md|verification|paste|pasted|full (?:suite|checks)|whole suite|required (?:commands|checks)|lint and typecheck|typecheck, then|before commit|clean candidate/i],
  ["flake-isolation", /(?:re-?run|run)\w* .{0,40}(?:alone|in isolation|on its own|by itself|several times)|load-related|under load|transient|flak/i],
  ["probe", /\bprobe|measur|timing|benchmark|\bbench\b|how long/i],
  ["investigation", /temporar\w* (?:log|print|debug)|debug|to see (?:where|why|whether)|reproduc|trace|bisect/i],
  ["red-step", /\bred\b|fail(?:s|ing)? first|watch it fail|confirm (?:it|the test) fails|failing test|test first|fails without|(?:written|meant) to fail/i],
  ["squeal-not-reached", /squeal.{0,80}(?:pending|not (?:yet )?(?:reached|run)|hasn.t|timed out|still running)|no new squeal|haven.t received/i],
  ["distrust", /squeal.{0,60}(?:stale|wrong|out of date|can.t be trusted)|distrust|don.t trust|not trust|double-check squeal|cross-check/i],
  ["confirm-change", /confirm|verify|make sure|check (?:that|the|my|it)|run (?:the|those|these|that|its) (?:test|spec|file|suite)|let me run|now run|running|rerun|re-run|run the tests|ensure|green|passes/i],
];
/**
 * The reason a run's place in the session shows, without the agent's words: a full-suite run is a
 * gate; a run of files with no edit since a run of the same files is a re-run; a name pattern is
 * an investigation; files after the agent's own edits are a check of its own change. Words
 * override only where they are explicit and rare: no daemon, Squeal's coverage text.
 */
function structuralReason(tc, stated, prev, editsSincePrev) {
  if (stated === "no-daemon" || stated === "coverage-text") return stated;
  if (tc.scope === "full") return "gate";
  if (tc.scope === "pattern") return "investigation";
  const same = prev && prev.files.length && tc.files.every((f) => prev.files.includes(f));
  if (same && editsSincePrev === 0) return "re-run";
  return "own-change";
}
function reasonOf(text) {
  for (const [k, re] of REASONS) if (re.test(text)) return k;
  return "none-stated";
}

// A strong claim that the tests pass, not "no known failures" (which Squeal's status supports).
const PASS_CLAIM = /all (?:\d+ )?(?:the )?tests? (?:pass|passed|are green)|(?:full|whole|entire) (?:test )?suite (?:passes|passed|is green)|everything passes|all green|tests (?:all )?pass(?:ed)?\b|\b0 failed\b/gi;
const NEGATED = /(?:can.?t|cannot|not|no|never|haven.t|didn.t|unable to)\b[^.]{0,40}$/i;
function strongPassClaim(text) {
  for (const m of text.matchAll(PASS_CLAIM)) if (!NEGATED.test(text.slice(Math.max(0, m.index - 60), m.index))) return true;
  return false;
}

// ---------- event normalisation ----------

/** The first user texts: the task prompt and, under Cezar, the brief after its preamble. */
function addPrompt(state, text) {
  state.prompts ??= [];
  if (state.prompts.length < 3 && !/^<(?:command|local-command|system-reminder)/.test(text)) state.prompts.push(text);
  state.prompt ??= text;
}
const ROLE = /Use \/(worker|reviewer|coordinator|researcher|judge|quality)\b|Selected skill: \/(\w[\w:-]*)|You are (?:a|the) (Worker|Reviewer|Coordinator|Researcher)\b|\b(review)\b/i;
function roleOf(prompts) {
  const m = (prompts ?? []).join("\n").match(ROLE);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "reviewer").toLowerCase().replace(/^review$/, "reviewer") : "other";
}

/** Normalise one parsed line into zero or more events: {t, kind, ...}. */
function normalise(j, state) {
  const out = [];
  const t = j.timestamp ? Date.parse(j.timestamp) : j.ts ?? j.t ?? null;
  // Claude Code transcript and stream-json
  if (j.type === "assistant" && j.message && Array.isArray(j.message.content)) {
    state.harness ??= "claude-code";
    for (const c of j.message.content) {
      if (c.type === "text") out.push({ t, kind: "say", text: c.text });
      if (c.type === "tool_use") {
        if (c.name === "Bash") out.push({ t, kind: "cmd", id: c.id, cmd: String(c.input?.command ?? "") });
        else if (EDIT_TOOLS.has(c.name)) out.push({ t, kind: "edit", id: c.id });
        else if (c.name === "Skill" && /squeal/i.test(JSON.stringify(c.input))) out.push({ t, kind: "skill" });
        else if (c.name === "Read" && /skills\/squeal\//.test(String(c.input?.file_path))) out.push({ t, kind: "skill" });
      }
    }
  } else if (j.type === "user" && j.message) {
    const content = j.message.content;
    if (typeof content === "string") {
      if (content.includes("SQUEAL ·")) out.push({ t, kind: "squeal", text: content });
      else if (!j.isMeta) addPrompt(state, content);
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (c.type === "tool_result") {
          const txt = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
          out.push({ t, kind: "result", id: c.tool_use_id, text: txt, error: !!c.is_error });
        } else if (c.type === "text" && c.text?.includes("SQUEAL ·")) out.push({ t, kind: "squeal", text: c.text });
        else if (c.type === "text") addPrompt(state, c.text);
      }
    }
  } else if (j.type === "attachment" && j.attachment) {
    const a = j.attachment;
    if (a.type === "hook_additional_context") {
      for (const s of a.content ?? []) if (String(s).includes("SQUEAL ·")) out.push({ t, kind: "squeal", text: String(s), hook: a.hookEvent });
    } else if (a.type === "hook_blocking_error") {
      const s = a.blockingError?.blockingError ?? "";
      if (s.includes("SQUEAL") || s.includes("Squeal")) out.push({ t, kind: "squeal", text: s, hook: a.hookEvent });
    }
  } else if (j.type === "system" && /hook/.test(j.subtype ?? "")) {
    const s = j.output ?? j.stdout ?? "";
    if (typeof s === "string" && s.includes("SQUEAL ·")) out.push({ t, kind: "squeal", text: s, hook: j.hook_event ?? j.hook_name });
  } else if (j.type === "session_meta" && j.payload) {
    state.harness = "codex";
    state.cwd = j.payload.cwd;
    state.version = j.payload.cli_version;
  } else if (j.type === "response_item" && j.payload) {
    const p = j.payload;
    if (p.type === "message") {
      const text = (p.content ?? []).map((c) => c.text ?? "").join("\n");
      if (p.role === "assistant") out.push({ t, kind: "say", text });
      else if (text.includes("SQUEAL ·")) out.push({ t, kind: "squeal", text });
      else if (p.role === "user" && !/^# AGENTS\.md|^<environment_context>|^<user_instructions>/.test(text)) addPrompt(state, text);
    } else if (p.type === "function_call" && /^(?:shell|exec_command|local_shell)$/.test(p.name)) {
      let cmd = "";
      try { const a = JSON.parse(p.arguments); cmd = Array.isArray(a.command) ? a.command.join(" ") : a.cmd ?? a.command ?? ""; } catch {}
      if (!state.itemCommands) out.push({ t, kind: "cmd", id: p.call_id, cmd });
    } else if (p.type === "custom_tool_call" && p.name === "apply_patch") out.push({ t, kind: "edit" });
  } else if (j.type === "event_msg" && j.payload?.type === "item_completed") {
    const i = j.payload.item;
    if (i?.type === "CommandExecution") {
      state.itemCommands = true;
      const cmd = Array.isArray(i.command) ? i.command[i.command.length - 1] : String(i.command);
      const dur = typeof i.duration === "object" && i.duration ? (i.duration.secs ?? 0) * 1000 + (i.duration.nanos ?? 0) / 1e6 : typeof i.duration === "number" ? i.duration : null;
      const end = j.payload.completed_at_ms ?? t;
      out.push({ t: dur != null ? end - dur : end, kind: "cmd", cmd, exit: i.exit_code, wallMs: dur, text: i.aggregated_output ?? i.stdout ?? "", done: true });
      if (/skills\/squeal\/SKILL\.md/.test(cmd)) out.push({ t: end, kind: "skill" });
    } else if (i?.type === "FileChange") out.push({ t, kind: "edit" });
  } else if (j.type === "item.completed" && j.item) {
    // codex exec --json
    state.harness ??= "codex";
    const i = j.item;
    if (i.type === "command_execution") out.push({ t, kind: "cmd", cmd: String(i.command), exit: i.exit_code, text: i.aggregated_output ?? "", done: true });
    else if (i.type === "agent_message") out.push({ t, kind: "say", text: i.text ?? "" });
    else if (i.type === "file_change") out.push({ t, kind: "edit" });
  }
  if (j.cwd && !state.cwd) state.cwd = j.cwd;
  if (j.version && !state.version && state.harness === "claude-code") state.version = j.version;
  if (j.message?.model && !state.model) state.model = j.message.model;
  if (j.type === "turn_context" && j.payload?.model) state.model ??= j.payload.model;
  return out;
}

// ---------- store coverage (optional) ----------

let store = null;
async function openStore(file) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  const worktrees = db.prepare("select id, root from worktrees").all();
  const closures = new Map();
  for (const r of db.prepare("select project, path, closure_paths from test_files").all()) closures.set(r.path, new Set(JSON.parse(r.closure_paths)));
  return {
    db, worktrees, closures,
    revisions: db.prepare("select number, created_at, changes from revisions where worktree_id = ? order by number"),
    runs: db.prepare("select revision, test_files, started_at, ended_at, end_state from runs where worktree_id = ? and started_at <= ? order by started_at"),
    files: db.prepare("select path from test_file_keys where worktree_id = ?"),
    // the latest outcome per check of a file, in this worktree, recorded before t
    outcomes: db.prepare(`select r.outcome, max(r.recorded_at) at from results r join checks c on c.id = r.check_id
      where r.worktree_id = ? and c.test_path = ? and r.recorded_at <= ? group by r.check_id`),
  };
}
const storeCache = new Map();
function storeView(cwd) {
  if (!store || !cwd) return null;
  const w = store.worktrees.find((x) => x.root === cwd);
  if (!w) return null;
  if (!storeCache.has(w.id)) {
    const revs = store.revisions.all(w.id).map((r) => ({ n: r.number, at: r.created_at, changes: JSON.parse(r.changes).map((c) => c.path) }));
    storeCache.set(w.id, { id: w.id, revs, files: store.files.all(w.id).map((r) => r.path) });
  }
  return storeCache.get(w.id);
}
/**
 * Did Squeal hold a current result for each file at time t? A file is current when a run in this
 * worktree that included it ended before t, at or after the last revision before t that changed
 * a path in its closure. The closure is today's (test_files keeps only the latest), so this is an
 * approximation; a file satisfied by lookup only (no run in this worktree) counts as "lookup?".
 */
function coverage(view, t, files) {
  const revsBefore = view.revs.filter((r) => r.at <= t);
  if (!revsBefore.length) return { verdict: "no-revision" };
  const runs = store.runs.all(view.id, t).map((r) => ({ ...r, files: JSON.parse(r.test_files).map((f) => f.path) }));
  if (files.includes("$unlisted")) return { verdict: "files-unlisted" };
  const targets = files.length ? view.files.filter((f) => files.some((g) => f === g || f.startsWith(g.replace(/\/?$/, "/")) || f.includes(g))) : view.files;
  const per = { current: 0, running: 0, pending: 0, lookup: 0, currentFail: 0 };
  for (const f of targets) {
    const closure = store.closures.get(f) ?? new Set([f]);
    let lastChange = 0;
    for (const r of revsBefore) if (r.changes.some((p) => p === f || closure.has(p))) lastChange = r.n;
    const ran = runs.filter((r) => r.files.includes(f) && r.revision >= lastChange);
    if (ran.some((r) => r.ended_at != null && r.ended_at <= t && r.end_state === "completed")) {
      per.current++;
      if (store.outcomes.all(view.id, f, t).some((o) => o.outcome === "fail")) per.currentFail++;
    }
    else if (ran.some((r) => r.ended_at == null || r.ended_at > t)) per.running++;
    else if (lastChange <= revsBefore[0].n) per.lookup++;
    else per.pending++;
  }
  const n = targets.length;
  const verdict = !n ? "no-files" : per.current === n ? "redundant" : per.current + per.lookup === n ? "redundant-if-lookup" : per.current ? "partly-current" : "not-covered";
  return { verdict, files: n, ...per };
}

// ---------- per-session analysis ----------

function analyse(file) {
  const state = {};
  const events = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    events.push(...normalise(j, state));
  }
  // Claude: pair tool_use with tool_result for wall time, exit and output
  const byId = new Map();
  for (const e of events) if (e.kind === "cmd" && e.id) byId.set(e.id, e);
  for (const e of events) if (e.kind === "result" && byId.has(e.id)) {
    const c = byId.get(e.id);
    c.wallMs = e.t != null && c.t != null ? e.t - c.t : null;
    c.text = e.text; c.exit = e.error ? 1 : 0; c.done = true;
    if (e.error && /requires approval|permission to use|was blocked|denied by/i.test(e.text.slice(0, 300))) c.refused = true;
    if (/hook error: SQUEAL|SQUEAL ·/.test(e.text) && /PreToolUse/.test(e.text)) events.push({ t: e.t, kind: "squeal", text: e.text, hook: "PreToolUse" });
  }
  for (const e of events) if (e.kind === "result" && !byId.has(e.id) && /PreToolUse:\w+ hook error: SQUEAL/.test(e.text)) e.kind = "squeal";
  events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const s = {
    file, harness: state.harness ?? "?", version: state.version ?? null, model: state.model ?? null, cwd: state.cwd ?? null,
    prompt: (state.prompt ?? "").slice(0, 160).replace(/\s+/g, " "), role: roleOf(state.prompts),
    edits: 0, runs: [], pulls: {}, skillLoads: 0, squealMsgs: {}, finalClaim: null, flags: [],
  };
  const dedupe = new Set();
  let lastEditT = null, refused = 0, editsSinceAnyRun = 0, prevRun = null;
  let lastSqueal = null, editsSinceSqueal = 0, lastSays = [], lastOwnRun = null, editsSinceOwnRun = 0;
  const view = storeView(s.cwd);
  for (const e of events) {
    if (e.kind === "say") { lastSays.push(e.text); if (lastSays.length > 3) lastSays.shift(); s.finalText = e.text; }
    else if (e.kind === "edit") { s.edits++; editsSinceSqueal++; editsSinceOwnRun++; editsSinceAnyRun++; lastEditT = e.t; }
    else if (e.kind === "skill") s.skillLoads++;
    else if (e.kind === "squeal") {
      const key = `${Math.round((e.t ?? 0) / 2000)}:${e.text.slice(0, 200)}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      const st = squealState(e.text);
      s.squealMsgs[st.kind] = (s.squealMsgs[st.kind] ?? 0) + 1;
      if (st.revision != null || st.noDaemon) { lastSqueal = { ...st, t: e.t }; editsSinceSqueal = 0; }
    } else if (e.kind === "cmd") {
      if (e.refused) { if (classifyTest(e.cmd)) s.refusedRuns = (s.refusedRuns ?? 0) + 1; continue; }
      if (isShellEdit(e.cmd)) { s.edits++; editsSinceSqueal++; editsSinceOwnRun++; editsSinceAnyRun++; lastEditT = e.t; }
      const sq = classifySqueal(e.cmd);
      if (sq && !/^(?:status|status --wait|why|run|run --all|run --slow)$/.test(sq.verb)) { /* start/stop/init/remove: not a pull */ }
      else if (sq) {
        s.pulls[sq.verb] = (s.pulls[sq.verb] ?? 0) + 1;
        if (e.text) { const st = squealState(e.text); if (st.revision != null || st.noDaemon || st.waitOutcome) { lastSqueal = { ...st, t: e.t, pulled: true }; editsSinceSqueal = 0; } }
        continue;
      }
      const tc = classifyTest(e.cmd);
      if (!tc) continue;
      const said = lastSays.join("\n");
      const run = {
        t: e.t ? new Date(e.t).toISOString() : null, ...tc, wallMs: e.wallMs != null ? Math.round(e.wallMs) : null, exit: e.exit ?? null,
        outcome: outcomeOf(e.cmd, e.text, e.exit),
        sinceEditS: lastEditT != null && e.t != null ? Math.round((e.t - lastEditT) / 100) / 10 : null,
        stated: reasonOf(said), said: said.slice(-220).replace(/\s+/g, " "),
        squealSaw: lastSqueal ? { revision: lastSqueal.revision ?? null, pending: lastSqueal.pending ?? null, unknown: lastSqueal.unknown ?? null, knownFailures: lastSqueal.knownFailures ?? null, noDaemon: !!lastSqueal.noDaemon, incomplete: !!lastSqueal.incomplete, timedOut: lastSqueal.waitOutcome === "timeout", editsSince: editsSinceSqueal, ageS: e.t && lastSqueal.t ? Math.round((e.t - lastSqueal.t) / 1000) : null } : null,
      };
      run.reason = structuralReason(tc, run.stated, prevRun, editsSinceAnyRun);
      prevRun = tc; editsSinceAnyRun = 0;
      // what the agent could see: Squeal said nothing pending, no unknowns, no edits since
      const ss = run.squealSaw;
      run.evident = !ss ? "no-squeal-text" : ss.noDaemon ? "no-daemon" : ss.editsSince > 0 ? "edits-since-last-squeal-state" : ss.pending === 0 && ss.unknown === 0 && !ss.incomplete && !ss.timedOut ? "squeal-current" : "squeal-pending";
      if (view && e.t) {
        run.store = coverage(view, e.t, tc.files);
        // the agent's own run against what Squeal held: a disagreement is a cross-check that paid
        const st = run.store;
        if (st.verdict === "redundant") run.crossCheck = run.outcome === "unknown" ? "outcome-unknown" : (run.outcome === "fail") === (st.currentFail > 0) ? "agrees" : run.outcome === "fail" ? "agent-fail-squeal-pass" : "agent-pass-squeal-fail";
        else if (st.files && st.pending + st.running > 0) run.crossCheck = "squeal-not-reached";
      }
      s.runs.push(run);
      lastOwnRun = run; editsSinceOwnRun = 0;
    }
  }
  // final claim flags (heuristic; a flag is a candidate, not a proven false claim)
  const fin = s.finalText ?? "";
  delete s.finalText;
  // A strong pass claim needs a passing run of the agent's own after its last edit, or Squeal's
  // word: no known failures, nothing pending, and a full-suite checkpoint at that revision.
  const ownPass = lastOwnRun && editsSinceOwnRun === 0 && lastOwnRun.outcome === "pass";
  const ownFullPass = ownPass && lastOwnRun.scope === "full";
  const squealFull = lastSqueal && editsSinceSqueal === 0 && lastSqueal.knownFailures === 0 && lastSqueal.pending === 0 && lastSqueal.fullAtRevision;
  if (strongPassClaim(fin)) {
    s.finalClaim = "pass";
    if (lastSqueal?.knownFailures > 0 && editsSinceSqueal === 0 && !ownPass) s.flags.push("pass-claim-against-known-failures");
    else if (!ownFullPass && !squealFull && !ownPass) s.flags.push("pass-claim-without-evidence");
  } else if (/no known failures/i.test(fin)) s.finalClaim = "no-known-failures";
  else if (/haven.t run|did not run|didn.t run|ran no tests?|not run the tests/i.test(fin)) s.finalClaim = "not-run";
  return s;
}

// ---------- main ----------

if (opt.store) store = await openStore(opt.store);
const sessions = [];
for (const p of inputs) for (const f of jsonlFiles(p)) {
  const s = analyse(f);
  if (s.harness === "?") continue;
  sessions.push(s);
}

const sum = { sessions: sessions.length, withEdits: 0, withOwnRuns: 0, editSessionsWithOwnRuns: 0, runs: 0, byScope: {}, byOutcome: {}, byRunner: {}, byReason: {}, byStated: {}, byEvident: {}, byStore: {}, byCrossCheck: {}, byRole: {}, byHarness: {}, pulls: {}, waits: 0, sessionsPulling: 0, skillLoads: 0, flags: {}, runWallMs: 0 };
for (const s of sessions) {
  if (s.edits) sum.withEdits++;
  for (const [m, k] of [[sum.byRole, s.role], [sum.byHarness, s.harness]]) {
    const r = (m[k] ??= { sessions: 0, editSessions: 0, editSessionsWithOwnRuns: 0, runs: 0, full: 0, files: 0, pattern: 0, pulls: 0, waits: 0 });
    r.sessions++; if (s.edits) r.editSessions++; if (s.edits && s.runs.length) r.editSessionsWithOwnRuns++;
    r.runs += s.runs.length; for (const x of s.runs) r[x.scope]++;
    r.pulls += Object.values(s.pulls).reduce((a, b) => a + b, 0); r.waits += s.pulls["status --wait"] ?? 0;
  }
  if (s.runs.length) sum.withOwnRuns++;
  if (s.edits && s.runs.length) sum.editSessionsWithOwnRuns++;
  if (Object.keys(s.pulls).length) sum.sessionsPulling++;
  sum.skillLoads += s.skillLoads;
  for (const [k, v] of Object.entries(s.pulls)) sum.pulls[k] = (sum.pulls[k] ?? 0) + v;
  sum.waits += s.pulls["status --wait"] ?? 0;
  for (const f of s.flags) sum.flags[f] = (sum.flags[f] ?? 0) + 1;
  for (const r of s.runs) {
    sum.runs++;
    sum.runWallMs += r.wallMs ?? 0;
    sum.byScope[r.scope] = (sum.byScope[r.scope] ?? 0) + 1;
    sum.byOutcome[r.outcome] = (sum.byOutcome[r.outcome] ?? 0) + 1;
    sum.byRunner[r.runner] = (sum.byRunner[r.runner] ?? 0) + 1;
    sum.byReason[r.reason] = (sum.byReason[r.reason] ?? 0) + 1;
    sum.byStated[r.stated] = (sum.byStated[r.stated] ?? 0) + 1;
    sum.byEvident[r.evident] = (sum.byEvident[r.evident] ?? 0) + 1;
    if (r.store) sum.byStore[r.store.verdict] = (sum.byStore[r.store.verdict] ?? 0) + 1;
    if (r.crossCheck) sum.byCrossCheck[r.crossCheck] = (sum.byCrossCheck[r.crossCheck] ?? 0) + 1;
  }
}
sum.runWallMin = +(sum.runWallMs / 60000).toFixed(1);
delete sum.runWallMs;

console.log(`# ${opt.label ?? "adoption metric"}: ${sessions.length} sessions`);
console.log(JSON.stringify(sum, null, 1));
if (opt.runs) {
  console.log("\nsession\tharness\tedits\tsquealMsgs\tpulls\tskill\tt\trunner\tscope\twall_s\texit\treason\tevident\tstore\tcommand");
  for (const s of sessions) {
    const id = path.basename(s.file).replace(/\.jsonl$/, "").replace(/^(?:\w+-)?rollout-[\dT-]+-/, "").slice(0, 8);
    const head = `${id}\t${s.harness}\t${s.edits}\t${JSON.stringify(s.squealMsgs)}\t${JSON.stringify(s.pulls)}\t${s.skillLoads}`;
    if (!s.runs.length) { console.log(`${head}\t-\t-\t-\t-\t-\t-\t-\t-\t(no own run)${s.flags.length ? " flags=" + s.flags : ""}`); continue; }
    for (const r of s.runs) console.log(`${head}\t${r.t?.slice(11, 19)} +${r.sinceEditS ?? "-"}s\t${r.runner}\t${r.scope}\t${r.wallMs != null ? (r.wallMs / 1000).toFixed(1) : "?"}\t${r.exit}\t${r.reason}/${r.stated}\t${r.evident}\t${r.store ? r.store.verdict + "(" + r.store.current + "/" + r.store.files + ")" : "-"}\t${r.segment.slice(0, 110)}`);
  }
}
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify({ summary: sum, sessions }, null, 1));
