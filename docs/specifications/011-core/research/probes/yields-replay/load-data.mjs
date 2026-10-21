// THROWAWAY probe (011-core/research/yields-replay.md, row 011-68). Read-only loading of cezar's
// store copy, run logs and the named waits (waits.mjs), shared by replay.mjs and observe.mjs.
// Follows ../running-tier-yields/mid-tier.mjs; adds per-run store estimates (sum of results, as
// `durationOf`), per-run walls, and cumulative changes per tier.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";

export const STORE = process.env.STORE ?? "/tmp/r68/cezar-store.sqlite";
export const WAITS = process.env.WAITS ?? "/tmp/r68/waits.json";
const db = new DatabaseSync(STORE, { readOnly: true });
export { db };

const NODE_TEST = new Set(["test:unit", "root:test:unit"]);
const slow = (p) => /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/.test(p);
export const vitestFast = (f) => !NODE_TEST.has(f.project) && !slow(f.path);
// Cezar's environment inputs of the Vitest lane (configs, e2e's globalSetup closure, manifests).
export const RECREATE = /(^|\/)vitest\.config\.[cm]?[jt]s$|^packages\/web\/e2e\/(environment|workspace-registry|agent-browser)\.ts$|^\.ai\/scripts\/resolve-browser-launch\.mjs$|(^|\/)package\.json$|^pnpm-lock\.yaml$/;
export const id = (f) => `${f.project}\0${f.path}`;

// Closures (today's, so approximate for older revisions).
export const byPath = new Map();
export const testFiles = [];
for (const t of db.prepare("select project, path, closure_paths from test_files").all()) {
  const f = { project: t.project, path: t.path };
  if (!vitestFast(f)) continue;
  testFiles.push(f);
  for (const p of [t.path, ...JSON.parse(t.closure_paths)]) {
    if (!byPath.has(p)) byPath.set(p, new Set());
    byPath.get(p).add(id(f));
  }
}
export const reach = (changes) => {
  const out = new Set();
  for (const c of changes) for (const f of byPath.get(c.path) ?? []) out.add(f);
  return out;
};
export const keyedCount = (changes) => changes.filter((c) => byPath.has(c.path)).length;

// The scheduler's estimate per run and file: the sum of the file's results (`durationOf`).
const estimate = new Map(); // run id -> Map(file id -> ms)
for (const r of db.prepare("select r.run_id, c.project, c.test_path, sum(r.duration_ms) ms from results r join checks c on c.id = r.check_id group by 1, 2, 3").all()) {
  if (!estimate.has(r.run_id)) estimate.set(r.run_id, new Map());
  estimate.get(r.run_id).set(`${r.project}\0${r.test_path}`, r.ms / 1000);
}

export const runs = [];
for (const r of db.prepare("select id, worktree_id wt, revision, test_files, checkpoint_id, log_dir, started_at s, ended_at e, end_state from runs where ended_at is not null order by started_at").all()) {
  const files = JSON.parse(r.test_files);
  if (!files.length || !vitestFast(files[0])) continue;
  let rep = null;
  const p = `${r.log_dir}/report.json`;
  if (existsSync(p)) try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch {}
  const dur = new Map((rep?.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs / 1000]));
  runs.push({
    id: r.id, wt: r.wt, revision: r.revision, s: r.s, e: r.e, end: r.end_state, cp: r.checkpoint_id !== null,
    files: files.map(id), dur, est: estimate.get(r.id) ?? new Map(),
    completed: new Set((rep?.completedFiles ?? []).map(id)),
    cancelled: /cancel/i.test(rep?.failure ?? ""), failure: rep?.failure ?? null, report: rep !== null,
    // Tier kind is not stored: more than `tierSize` files or a checkpoint's is taken as a backlog tier.
    backlog: files.length > 4 || r.checkpoint_id !== null,
  });
}
export const runsOf = new Map();
for (const r of runs) { if (!runsOf.has(r.wt)) runsOf.set(r.wt, []); runsOf.get(r.wt).push(r); }
export const inFlight = (wt, t) => (runsOf.get(wt) ?? []).find((r) => r.s <= t && t < r.e);
export const revsOf = new Map();
for (const r of db.prepare("select worktree_id wt, number, created_at t, changes from revisions order by created_at").all()) {
  if (!revsOf.has(r.wt)) revsOf.set(r.wt, []);
  revsOf.get(r.wt).push({ number: r.number, t: r.t, changes: JSON.parse(r.changes) });
}
export const roots = db.prepare("select id, root, daemon_version, daemon_started_at from worktrees").all().sort((a, b) => b.root.length - a.root.length);

// The run's fixed cost: its wall minus its longest module.
export const overhead = (r) => Math.max(0, (r.e - r.s) / 1000 - Math.max(0, ...r.dur.values()));

// Per file, its runs in end order with three durations: the store's estimate, Vitest's module
// duration, and a wall time. The run log has no per-file times, so the wall is a one-file run's
// wall (run end less start), and in a run of several the estimate plus FIXED_S, the p90 of a
// one-file run's wall less its estimate (replay.txt). `oneWall` keeps one-file walls only.
export const FIXED_S = Number(process.env.FIXED_S ?? 1.1);
const hist = new Map();
for (const r of runs) {
  if (!r.report) continue;
  for (const f of r.files) {
    const module = r.dur.get(f);
    const est = r.est.get(f) ?? null;
    if (module === undefined && est === null) continue;
    const oneWall = r.files.length === 1 ? (r.e - r.s) / 1000 : null;
    const wall = oneWall ?? (est !== null ? est + FIXED_S : null);
    if (!hist.has(f)) hist.set(f, []);
    hist.get(f).push({ e: r.e, est, module: module ?? null, wall, oneWall, one: r.files.length === 1 });
  }
}
for (const xs of hist.values()) xs.sort((a, b) => a.e - b.e);
export { hist };
/** The file's duration from its latest run that ended before `before`, any worktree; `null` if none. */
export function lastKnown(f, before, source = "est") {
  const xs = hist.get(f);
  if (!xs) return null;
  let lo = 0, hi = xs.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m].e < before) { at = m; lo = m + 1; } else hi = m - 1; }
  for (let i = at; i >= 0; i--) { const v = xs[i][source]; if (v !== null && v !== undefined) return v; }
  return null;
}

export const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
export const stats = (xs) => xs.length ? { n: xs.length, p50: +q(xs, 0.5).toFixed(1), p90: +q(xs, 0.9).toFixed(1), max: +Math.max(...xs).toFixed(1), sum: +xs.reduce((a, b) => a + b, 0).toFixed(0) } : { n: 0 };

// The host's one-minute load (sysstat, 10-minute samples, local time UTC+2).
import { execFileSync } from "node:child_process";
const samples = [];
for (const day of ["14", "15", "16", "17", "18", "19", "20", "21"]) {
  let out = "";
  try { out = execFileSync("sar", ["-q", "-f", `/var/log/sysstat/sa${day}`], { env: { ...process.env, LC_ALL: "C" } }).toString(); } catch { continue; }
  for (const line of out.split("\n")) {
    const m = /^(\d\d):(\d\d):(\d\d)\s+\d+\s+\d+\s+([\d.]+)/.exec(line);
    if (m) samples.push({ t: Date.parse(`2026-10-${day}T${m[1]}:${m[2]}:${m[3]}+02:00`), l1: +m[4] });
  }
}
export const loadAt = (t) => samples.length ? samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).l1 : null;
export { samples };

// Named waits on fast Vitest files, as mid-tier.mjs: the paths resolved against the listed files.
const known = new Set(testFiles.map((f) => f.path));
const expand = (p) => {
  const m = /^(.*)\{([^}]*)\}(.*)$/.exec(p);
  if (m) return m[2].split(",").flatMap((x) => expand(m[1] + x + m[3]));
  if (!p.includes("*")) return [p];
  const re = new RegExp("^" + p.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
  return [...known].filter((k) => re.test(k));
};
export const waits = [];
for (const w of JSON.parse(readFileSync(WAITS, "utf8"))) {
  if (!w.cwd || !w.paths.length) continue;
  const root = roots.find((x) => w.cwd === x.root || w.cwd.startsWith(x.root + "/"));
  if (!root) continue;
  const sub = w.cwd.slice(root.root.length + 1);
  const paths = [...new Set(w.paths.flatMap(expand).map((p) => (known.has(p) || !sub ? p : `${sub}/${p}`)).filter((p) => known.has(p)))];
  if (paths.length) waits.push({ ...w, wt: root.id, paths });
}
