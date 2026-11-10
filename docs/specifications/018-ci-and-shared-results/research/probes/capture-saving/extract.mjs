// throwaway (row 018-25): manual test runs plus every file change agents made, per worktree.
// Copied from ../local-capture/manual-runs.mjs (row 018-22; classifier from 005's
// adoption-baseline/metric.mjs), extended with: the worktree each command ran in (the
// command's own cwd, or a leading `cd <worktree>`), start and end in ms, and an edit
// timeline (Claude Code Edit/Write/MultiEdit/NotebookEdit, Codex FileChange items, and
// shell commands that write: see writes()). Reads transcripts only; writes its --json output.
//   node extract.mjs --from 2026-11-03 --to 2026-11-10 --json out.json --skip <session id>
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

const ROOT_RE = /\/home\/agent\/projects\/(squeal|cezar)(\/\.ai\/cezar\/worktrees\/[0-9a-f-]{36})?/;
/** The worktree root a path or cwd lies in, or null outside both repositories. */
function rootOf(p) { const m = String(p ?? "").replace(/^file:\/\//, "").match(ROOT_RE); return m ? m[0] : null; }
/** A leading `cd <dir>` in a command moves it to that worktree. */
function cdRoot(cmd) { const m = cmd.match(/^\s*cd\s+["']?([^\s"'&;|]+)/); return m ? rootOf(m[1]) : null; }

/**
 * What a shell command changes in the worktree, per segment at command position (quotes and
 * heredoc bodies masked, as segments() does): `global` for a git operation that rewrites the
 * tree (checkout or switch to another commit, merge, rebase, pull, cherry-pick, am, revert,
 * apply, stash push/pop/apply, reset --hard, restore of the worktree), an install, or a
 * fix-mode formatter without paths; else the paths it writes: redirect and tee targets, the
 * operands of sed -i, perl -i, cp, mv, rm, touch, truncate, patch, the path literals of a
 * heredoc script that writes (open(...,'w'), write_text, writeFileSync), apply_patch headers.
 */
const PATH_RE = /(?:\/home\/agent\/projects\/[^\s"';|&)<>]+|(?:\.\/)?[\w@.-]+\/[\w@./-]*\.\w+|[\w@.-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|snap|yaml|yml|md))/g;
const pathsIn = (text) => (text.match(PATH_RE) ?? []).filter((p) => !p.startsWith("/tmp/") && !/^\d/.test(p));
function writes(cmd) {
  const paths = []; let global = null;
  for (const { masked, text } of segments(cmd)) {
    const m = masked.replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\(\s*)?/, "");
    const g = m.match(/^git\s+(?:-C\s+\S+\s+)?([\w-]+)(.*)$/);
    if (g) {
      const [, sub, rest] = g;
      if (/^(?:merge|rebase|pull|cherry-pick|am|revert|apply)$/.test(sub) && !/--check|--stat|--numstat/.test(rest)) global ??= "git";
      else if (sub === "stash" && !/^\s*(?:list|show)\b/.test(rest)) global ??= "git";
      else if (sub === "reset" && /--hard|--merge|--keep/.test(rest)) global ??= "git";
      else if ((sub === "checkout" || sub === "switch") && !/^\s*(?:-b|-c|-B|-C)\s+\S+\s*$/.test(rest)) { if (/\s--\s/.test(rest)) paths.push(...pathsIn(text.slice(text.indexOf(" -- ")))); else global ??= "git"; }
      else if (sub === "restore" && !/--staged/.test(rest)) paths.push(...pathsIn(rest).length ? pathsIn(text) : [""]);
      continue;
    }
    if (/^(?:pnpm|npm|yarn)\s+(?:install|i|ci|add|remove|update|up)\b/.test(m)) { global ??= "install"; continue; }
    if (/^(?:(?:pnpm|npm)\s+(?:exec\s+|run\s+)?|npx\s+)?(?:biome|prettier|eslint|oxlint)\b.*(?:--write|--fix)|^(?:pnpm|npm)\s+(?:run\s+)?(?:format|lint:fix|fix)\b/.test(m)) { const ps = pathsIn(text); if (ps.length) paths.push(...ps); else global ??= "formatter"; continue; }
    if (/^(?:sed\s+(?:-\w+\s+)*-i|perl\s+-\w*i|cp|mv|rm|touch|truncate|patch)\b/.test(m)) { const ps = pathsIn(text); paths.push(...(/^cp\b/.test(m) ? ps.slice(-1) : ps)); }
    for (const r of masked.matchAll(/(?:^|[^<>&\d])>>?\s*(\S+)/g)) { const t = text.slice(r.index).match(/>>?\s*(\S+)/)?.[1]; if (t && t !== "/dev/null" && !t.startsWith("&")) paths.push(...pathsIn(t)); }
    if (/\btee\s/.test(masked)) paths.push(...pathsIn(text.slice(text.search(/\btee\s/))));
  }
  for (const h of cmd.matchAll(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\2\b/g)) {
    const body = h[3];
    if (/\*\*\* (?:Begin Patch|Update File|Add File)/.test(body)) { for (const f of body.matchAll(/\*\*\* (?:Update|Add|Delete) File: (\S+)|\*\*\* Move to: (\S+)/g)) paths.push(f[1] ?? f[2]); continue; }
    if (/open\([^)]*["'][wa]|write_text|writeFileSync|\.write\(|replace_in_file/.test(body)) paths.push(...pathsIn(body));
  }
  if (global) return { global: true, why: global };
  return paths.length ? { paths: paths.filter(Boolean), why: "shell" } : null;
}

async function* lines(file) { const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity }); for await (const l of rl) { if (l) { try { yield JSON.parse(l); } catch {} } } }
function* walk(dir) { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith(".jsonl")) yield p; } }

const runs = []; const edits = []; const sessions = new Map();
const MARGIN = 864e5; // edits from a day before the window, so the first runs see earlier changes
function edit(root, t, paths, kind, session, cmd) {
  if (!root || t === null || t < FROM - MARGIN || t >= TO + MARGIN) return;
  edits.push({ root, t, kind, session, cmd: cmd ? cmd.slice(0, 160) : undefined, paths: paths.map((p) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p.replace(/^\.\//, ""))) });
}
function shellEdit(root, t, cmd, session) {
  const w = writes(cmd); if (!w) return;
  if (w.global) edit(root, t, [], `global:${w.why}`, session, cmd); else if (w.paths.length) edit(root, t, w.paths, "shell", session, cmd);
}
async function claude(file) {
  if (file.includes(SKIP)) return;
  if (fs.statSync(file).mtimeMs < FROM - MARGIN) return;
  const pending = new Map(); let cwd = null; const session = path.basename(file, ".jsonl");
  for await (const j of lines(file)) {
    if (j.cwd) cwd = j.cwd;
    const t = j.timestamp ? Date.parse(j.timestamp) : null;
    if (j.type === "assistant" && Array.isArray(j.message?.content)) for (const c of j.message.content) if (c.type === "tool_use") pending.set(c.id, { t, name: c.name, input: c.input ?? {}, cwd });
    if (j.type === "user" && Array.isArray(j.message?.content)) for (const c of j.message.content) if (c.type === "tool_result" && pending.has(c.tool_use_id)) {
      const p = pending.get(c.tool_use_id); pending.delete(c.tool_use_id);
      if (/^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(p.name)) { const fp = p.input.file_path ?? p.input.notebook_path; edit(rootOf(fp), t, [fp], "tool", session); continue; }
      if (p.name !== "Bash") continue;
      const cmd = String(p.input.command ?? "");
      const root = cdRoot(cmd) ?? rootOf(p.cwd);
      shellEdit(root, t, cmd, session);
      const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      add("claude-code", file, root, p.t, t, cmd, text, !!p.input.run_in_background);
    }
  }
}
async function codex(file) {
  if (fs.statSync(file).mtimeMs < FROM - MARGIN) return;
  let meta = null; const session = path.basename(file, ".jsonl");
  for await (const j of lines(file)) {
    const p = j.payload ?? {};
    if (j.type === "session_meta") { meta = p.cwd; if (repoOf(meta) === null) return; continue; }
    if (j.type !== "event_msg" || p.type !== "item_completed") continue;
    const i = p.item ?? {}; const end = p.completed_at_ms ?? (j.timestamp ? Date.parse(j.timestamp) : null);
    if (i.type === "FileChange") { for (const fp of Object.keys(i.changes ?? {})) edit(rootOf(fp), end, [fp], "tool", session); continue; }
    if (i.type !== "CommandExecution") continue;
    const cmd = Array.isArray(i.command) ? i.command[i.command.length - 1] : String(i.command);
    const dur = typeof i.duration === "object" && i.duration ? (i.duration.secs ?? 0) * 1000 + (i.duration.nanos ?? 0) / 1e6 : typeof i.duration === "number" ? i.duration : p.started_at_ms != null ? end - p.started_at_ms : null;
    const root = cdRoot(cmd) ?? rootOf(i.cwd ?? meta);
    shellEdit(root, end, cmd, session);
    add("codex", file, root, dur != null ? end - dur : end, end, cmd, String(i.aggregated_output ?? i.stdout ?? ""), false);
  }
}
function add(harness, file, root, t0, t1, cmd, text, bg) {
  const repo = repoOf(root); if (repo === null || t0 === null || t0 < FROM || t0 >= TO) return;
  const s = sessions.get(file) ?? { harness, repo, runs: 0, cmds: 0 }; s.cmds++; sessions.set(file, s);
  const c = classifyTest(cmd); if (c === null) return; s.runs++;
  runs.push({ harness, repo, root, session: path.basename(file, ".jsonl"), t0, t1: bg ? null : t1, wallS: t1 && !bg ? (t1 - t0) / 1000 : null, background: bg, runner: c.runner, scope: c.scope, files: c.files, segment: c.segment.slice(0, 400), rest: c.rest.slice(0, 400), ...traits(cmd, c), ...durations(text) });
}

for (const d of fs.readdirSync(path.join(HOME, ".claude/projects"))) {
  if (!/^-home-agent-projects-(squeal|cezar)(-|$)/.test(d)) continue;
  for (const f of walk(path.join(HOME, ".claude/projects", d))) await claude(f);
}
for (let t = FROM - MARGIN; t < TO + MARGIN; t += 864e5) { const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "/"); for (const f of walk(path.join(HOME, ".codex/sessions", day))) await codex(f); }
fs.writeFileSync(arg("--json"), JSON.stringify({ from: arg("--from"), to: arg("--to"), sessions: [...sessions.values()], runs, edits }));
console.log(`sessions with a shell command: ${sessions.size}; runs: ${runs.length}; edits: ${edits.length}`);
