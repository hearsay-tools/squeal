// throwaway (row 018-25): joins the manual Vitest runs of storable shape (extract.mjs) with
// the daemon's runs of the same test file at the same content, from copies of the stores.
// "Same content" = no change to the file's closure (test_files.closure_paths), the test
// file, or its project's environment files between the daemon run's revision and the
// manual run. Changes come from the store's `revisions` for worktrees still registered
// ("store" mode, exact by revision) and from the transcripts' edit timeline for removed
// worktrees ("transcript" mode, by time). Store copies only; read-only.
//   node join.mjs <runs.json> <stores dir> <from day> <to day> [--pairs out.json]
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [runsFile, storesDir, fromDay, toDay] = process.argv.slice(2);
const pairsOut = process.argv.includes("--pairs") ? process.argv[process.argv.indexOf("--pairs") + 1] : null;
const FROM = Date.parse(`${fromDay}T00:00:00Z`), TO = Date.parse(`${toDay}T00:00:00Z`);
const DELTA = Number(process.env.DELTA_MS ?? 2000); // ms from an edit to a daemon revision that holds it (calibrated below)
// GLOBAL=strict: a git rewrite, install or path-less formatter run counts as a change to every
// closure (lower bound on same-content matches); GLOBAL=ignore: only edits with paths count.
const GLOBAL = process.env.GLOBAL ?? "strict";
const QUIET_MS = 2 * 3600e3; // a manual run with no daemon run anywhere in the store within 2 h is set apart
const { runs, edits } = JSON.parse(fs.readFileSync(runsFile, "utf8"));
const VITEST_PROJECTS = { squeal: [""], cezar: ["server", "contract", "api-client", "web"] };
// Flags that change no keyed field (018-22 `local-capture.md` 3); --project is kept apart.
const ALLOWED = /^--(?:maxWorkers|reporter|silent|outputFile(?:\.\w+)?|run|no-color|color|project)$/;
const idOf = (root) => crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
const fk = (project, path) => `${project}\0${path}`;
const out = [];
const allPairs = [];

/** Why a run cannot be stored at the daemon's key, or null when its shape can be. */
function unstorable(r) {
  if (r.runner === "node:test") return "node:test";
  if (r.repo === "cezar" && r.runner === "npm-script" && !/npm\s+(?:run\s+)?test(?:\s|$)/.test(r.segment)) return "other script";
  if (r.namePattern) return "name filter (-t)";
  if (r.update) return "-u";
  if (r.coverage || r.otherFlags.some((f) => f.startsWith("--coverage"))) return "coverage";
  if (r.elsewhere || r.otherFlags.some((f) => /^--(?:config|root|dir|workspace|prefix)$/.test(f.replace(/=.*/, "")))) return "other config or directory";
  if (r.watch || r.otherFlags.includes("-w")) return "watch";
  const bad = r.otherFlags.map((f) => f.replace(/=.*/, "")).filter((f) => !ALLOWED.test(f));
  if (bad.length) return "keyed or untested flag";
  if (r.background || r.t1 == null) return "end unknown (background)";
  return null;
}

for (const repo of ["squeal", "cezar"]) {
  const db = new DatabaseSync(`${storesDir}/${repo}/store.sqlite`, { readOnly: true });
  const projects = VITEST_PROJECTS[repo];
  // Test files and closures (the store keeps the newest closure list per file).
  const files = new Map();
  for (const row of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) {
    if (!projects.includes(row.project)) continue;
    files.set(fk(row.project, row.path), { project: row.project, path: row.path, closure: new Set([...JSON.parse(row.closure_paths), row.path]) });
  }
  // Environment files per project: the newest walk's files plus package manifests.
  const env = new Map();
  for (const p of projects) {
    const w = db.prepare("SELECT files FROM environment_walks WHERE project = ? ORDER BY recorded_at DESC LIMIT 1").get(p);
    env.set(p, new Set([...(w ? JSON.parse(w.files) : []), "package.json", "pnpm-lock.yaml", "package-lock.json", "squeal.config.json"]));
  }
  const touches = (f, paths) => paths.some((p) => f.closure.has(p) || env.get(f.project).has(p) || /^packages\/[^/]+\/package\.json$/.test(p));
  // File checks and their results.
  const checkOf = new Map();
  for (const c of db.prepare("SELECT id, project, test_path FROM checks WHERE kind = 'file'").all()) checkOf.set(fk(c.project, c.test_path), c.id);
  const resultByRun = new Map(); const meanMs = new Map();
  for (const r of db.prepare("SELECT check_id, run_id, duration_ms, outcome FROM results WHERE check_id IN (SELECT id FROM checks WHERE kind = 'file')").all()) {
    resultByRun.set(`${r.check_id}\0${r.run_id}`, r);
    const m = meanMs.get(r.check_id) ?? [0, 0]; m[0] += r.duration_ms; m[1]++; meanMs.set(r.check_id, m);
  }
  const msOf = (key, runId) => { const c = checkOf.get(key); if (c === undefined) return null; const d = resultByRun.get(`${c}\0${runId}`); if (d != null) return { ms: d.duration_ms, exact: true, outcome: d.outcome }; const m = meanMs.get(c); return m ? { ms: m[0] / m[1], exact: false } : null; };
  // Daemon runs per worktree.
  const daemon = new Map();
  for (const r of db.prepare("SELECT id, worktree_id, revision, test_files, started_at, ended_at, end_state FROM runs WHERE started_at >= ?").all(FROM - 2 * 864e5)) {
    const list = daemon.get(r.worktree_id) ?? []; daemon.set(r.worktree_id, list);
    list.push({ id: r.id, rev: r.revision, files: new Set(JSON.parse(r.test_files).map((t) => fk(t.project, t.path))), start: r.started_at, end: r.ended_at ?? Infinity, state: r.end_state });
  }
  const knownTime = new Map(); // worktree -> revision -> first run start
  for (const [w, list] of daemon) { const m = new Map(); for (const r of list) m.set(r.rev, Math.min(m.get(r.rev) ?? Infinity, r.start)); knownTime.set(w, m); }
  // Revisions of registered worktrees.
  const revs = new Map();
  for (const r of db.prepare("SELECT worktree_id, number, created_at, changes FROM revisions ORDER BY worktree_id, number").all()) {
    const list = revs.get(r.worktree_id) ?? []; revs.set(r.worktree_id, list);
    list.push({ n: r.number, t: r.created_at, paths: JSON.parse(r.changes).map((c) => c.path) });
  }
  // Transcript edits per worktree root.
  const editsOf = new Map();
  for (const e of edits) if (e.root.includes(`/projects/${repo}`) && (repo === "cezar" ? true : !e.root.includes("/projects/cezar"))) {
    const list = editsOf.get(e.root) ?? []; editsOf.set(e.root, list); list.push(e);
  }
  for (const l of editsOf.values()) l.sort((a, b) => a.t - b.t);

  // Calibration: lag from a transcript edit of a path to the first revision that names it.
  const lags = [];
  for (const [root, list] of editsOf) {
    const rv = revs.get(idOf(root)); if (!rv) continue;
    for (const e of list) if (e.kind === "tool") for (const p of e.paths) {
      const hit = rv.find((r) => r.t >= e.t - 5000 && r.paths.includes(p)); if (hit && hit.t - e.t < 60000) lags.push(hit.t - e.t);
    }
  }
  lags.sort((a, b) => a - b);

  // Manual runs of this repo in the window, by storable shape.
  const mine = runs.filter((r) => r.repo === repo && r.t0 >= FROM && r.t0 < TO && r.runner !== "node:test" && !(r.repo === "cezar" && r.runner === "npm-script" && !/npm\s+(?:run\s+)?test(?:\s|$)/.test(r.segment)));
  const why = {}; const storable = [];
  const starts = [...daemon.values()].flat().map((d) => d.start).sort((a, b) => a - b);
  const active = (t) => { let lo = 0, hi = starts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] < t - QUIET_MS) lo = m + 1; else hi = m; } return lo < starts.length && starts[lo] <= t + QUIET_MS; };
  for (const r of mine) { const u = unstorable(r) ?? (active(r.t0) ? null : "no daemon run in the store within 2 h"); if (u) why[u] = (why[u] ?? 0) + 1; else storable.push(r); }

  const cat = {}; const runCat = {}; const secs = {}; const saved = new Map(); let manualMs = 0, unresolved = 0, noDaemonEver = 0;
  const agree = { same: 0, differ: 0, matrix: {} };
  const add = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; };
  for (const r of storable) {
    const w = idOf(r.root);
    let projs = projects;
    const pm = [...r.rest.matchAll(/--project[=\s]+(\S+)/g)].map((m) => m[1]); if (pm.length) projs = projs.filter((p) => pm.includes(p));
    const filters = r.files.map((f) => f.replace(r.root + "/", "").replace(/^\.\//, "").replace(/["']/g, ""));
    const hit = [...files.values()].filter((f) => projs.includes(f.project) && (r.scope === "full" || filters.some((x) => f.path.includes(x))));
    if (hit.length === 0) { unresolved++; continue; }
    const runCats = new Set();
    for (const f of hit) {
      const key = fk(f.project, f.path);
      const dRuns = (daemon.get(w) ?? []).filter((d) => d.files.has(key));
      const price = msOf(key, null); manualMs += price?.ms ?? 0;
      if (!daemon.has(w)) noDaemonEver++;
      let meta = {};
      const classify = (mode) => {
        let same, stable;
        if (mode === "store") {
          const rv = revs.get(w);
          const changes = rv.filter((x) => touches(f, x.paths));
          const prev = changes.filter((x) => x.t <= r.t0).at(-1), next = changes.find((x) => x.t > r.t0);
          stable = !next || next.t >= r.t1;
          const lo = prev ? prev.n : -Infinity, hi = next ? next.n : Infinity;
          same = dRuns.filter((d) => d.rev >= lo && d.rev < hi);
        } else {
          const ev = (editsOf.get(r.root) ?? []).filter((e) => (e.kind.startsWith("global") ? GLOBAL === "strict" : touches(f, e.paths)));
          const prev = ev.filter((e) => e.t <= r.t0).at(-1), next = ev.find((e) => e.t > r.t0);
          stable = !next || next.t >= r.t1;
          const lo = prev ? prev.t + DELTA : -Infinity, hi = next ? next.t + DELTA : Infinity;
          const kt = knownTime.get(w);
          same = dRuns.filter((d) => { const t = kt.get(d.rev); return t >= lo && t < hi; });
          meta = { prev: prev ? `${prev.kind} ${((r.t0 - prev.t) / 1000).toFixed(0)}s` : "none", next: next ? `${next.kind} +${((next.t - r.t0) / 1000).toFixed(0)}s` : "none" };
        }
        if (!stable) return { c: "changed during the run" };
        const done = same.filter((d) => d.state === "completed");
        if (done.some((d) => d.end <= r.t0)) return { c: "daemon ran it before the run" };
        if (done.some((d) => d.start < r.t1 && d.end <= r.t1)) return { c: "daemon finished it during the run" };
        if (done.some((d) => d.start < r.t1)) return { c: "daemon started it during the run, ended after" };
        const later = done.filter((d) => d.start >= r.t1).sort((a, b) => a.start - b.start)[0];
        if (later) return { c: "daemon ran it after the run", d: later };
        return { c: dRuns.length || daemon.has(w) ? "daemon never ran that content here" : "no daemon runs in this worktree" };
      };
      const mode = revs.has(w) ? "store" : "transcript";
      const res = classify(mode);
      if (mode === "store" && editsOf.has(r.root)) {
        const alt = classify("transcript"); add(agree, alt.c === res.c ? "same" : "differ"); add(agree.matrix, `${res.c} | transcript: ${alt.c}`);
      }
      add(cat, `${mode}: ${res.c}`); add(cat, `all: ${res.c}`); add(secs, res.c, (price?.ms ?? 0) / 1000);
      runCats.add(res.c);
      if (res.d) { const s = msOf(key, res.d.id); if (!saved.has(`${key}\0${res.d.id}`)) saved.set(`${key}\0${res.d.id}`, { ms: s?.ms ?? 0, exact: s?.exact, outcome: s?.outcome, gap: res.d.start - r.t1 }); }
      allPairs.push({ repo, harness: r.harness, root: r.root, t0: r.t0, t1: r.t1, mode, file: f.path, c: res.c, scope: r.scope, project: pm.length > 0, filters, ...meta, daemonRuns: dRuns.map((d) => [d.rev, Math.round((d.start - r.t0) / 1000), Math.round((d.end - r.t0) / 1000)]) });
    }
    const notYet = ["daemon started it during the run, ended after", "daemon ran it after the run", "daemon never ran that content here", "no daemon runs in this worktree"];
    add(runCat, [...runCats].every((c) => c === "daemon ran it before the run" || c === "daemon finished it during the run") ? "every file already run by the run's end" : [...runCats].some((c) => notYet.includes(c)) ? "at least one file not yet run by the run's end" : "only changed-during files otherwise");
  }
  const sv = [...saved.values()]; const gaps = sv.map((s) => s.gap / 1000).sort((a, b) => a - b);
  const days = (TO - FROM) / 864e5;
  out.push(`\n## ${repo} (${days} days, ${fromDay} to ${toDay})`,
    `edit-to-revision lag (tool edits in registered worktrees): n ${lags.length}, p50 ${lags[lags.length >> 1]} ms, p90 ${lags[Math.floor(lags.length * 0.9)]} ms; DELTA ${DELTA} ms; GLOBAL ${GLOBAL}`,
    `manual Vitest runs: ${mine.length}; storable shape: ${storable.length}; not storable: ${JSON.stringify(why)}`,
    `storable runs with --project: ${storable.filter((r) => /--project/.test(r.rest)).length}; full-suite (no path filter): ${storable.filter((r) => r.scope === "full").length}; filters matching no test file: ${unresolved}`,
    `storable runs by worktree record: store revisions ${storable.filter((r) => revs.has(idOf(r.root))).length}, transcript edits ${storable.filter((r) => !revs.has(idOf(r.root))).length}`,
    `file-runs (run x test file): ${Object.entries(cat).filter(([k]) => k.startsWith("all:")).reduce((a, [, v]) => a + v, 0)}`,
    ...Object.entries(cat).sort().map(([k, v]) => `  ${k}: ${v}`),
    `file-seconds of the manual file-runs (store mean per file) by class: ${Object.entries(secs).map(([k, v]) => `${k} ${v.toFixed(0)}`).join("; ")}; total ${(manualMs / 1000).toFixed(0)}`,
    `runs by class: ${JSON.stringify(runCat)}`,
    `daemon runs a capture would have saved (distinct file x daemon run): ${sv.length}, file-seconds ${(sv.reduce((a, s) => a + s.ms, 0) / 1000).toFixed(0)} (${(sv.reduce((a, s) => a + s.ms, 0) / 1000 / days).toFixed(0)} a day), exact durations ${sv.filter((s) => s.exact).length}; daemon outcome there: ${JSON.stringify(sv.reduce((o, s) => ((o[s.outcome ?? "row replaced"] = (o[s.outcome ?? "row replaced"] ?? 0) + 1), o), {}))}, file-seconds of the passes ${(sv.filter((s) => s.outcome === "pass").reduce((a, s) => a + s.ms, 0) / 1000).toFixed(0)}; daemon start after the manual run ended: p50 ${gaps[gaps.length >> 1]?.toFixed(0)} s, p90 ${gaps[Math.floor(gaps.length * 0.9)]?.toFixed(0)} s`,
    `validation in registered worktrees (store mode vs transcript mode on the same pairs): same ${agree.same}, differ ${agree.differ}`,
    ...Object.entries(agree.matrix).filter(([k]) => { const [a, b] = k.split(" | transcript: "); return a !== b; }).map(([k, v]) => `  ${k}: ${v}`),
  );
}
console.log(out.join("\n"));
if (pairsOut) fs.writeFileSync(pairsOut, JSON.stringify(allPairs));
