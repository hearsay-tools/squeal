// Throwaway, read-only: what the slow tier did in one repository's shared Squeal store.
// Opens the store readOnly. Usage: node store-slow.mjs <store.sqlite> <groups.json>
// groups.json: { "<group>": { "tests": "<SQL LIKE on test_path>", "inputs": ["<glob>", ...] } }
// Prints, as JSON:
//  revisions: per worktree, how many revisions re-key each slow group (a changed path matches
//    the group's declared inputs or its own test directory) and how many re-key none;
//  runs: per group, file-level results recorded (each one a run) and their summed minutes;
//  inherited: per group, file-level known states whose origin is another worktree, and minutes;
//  reruns: per group, consecutive own runs of one file in one worktree at different keys, and
//    how many changed any test's outcome (the ground truth an advisory is scored against);
//  transitions: every slow-check transition with whether its previous result was the
//    worktree's own run, inherited, or none.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const [store, groupsFile] = process.argv.slice(2);
const groups = JSON.parse(readFileSync(groupsFile, "utf8"));
const db = new DatabaseSync(store, { readOnly: true });
const glob = (g) => new RegExp(`^${g.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\{([^}]*)\}/g, (_, a) => `(${a.split(",").join("|")})`).replace(/\*\*\//g, "\0").replace(/\*\*/g, "\x01").replace(/\*/g, "[^/]*").replace(/\0/g, "(.*/)?").replace(/\x01/g, ".*")}$`);
const matchers = Object.fromEntries(Object.entries(groups).map(([g, d]) => [g, d.inputs.map(glob)]));
const wtName = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root.replace(/.*\//, "")]));
const out = { revisions: {}, runs: {}, inherited: {}, reruns: {}, transitions: [] };

// Revisions.
for (const r of db.prepare("SELECT worktree_id, number, changes FROM revisions ORDER BY worktree_id, number").all()) {
  const paths = JSON.parse(r.changes).map((c) => c.path);
  const hit = Object.keys(groups).filter((g) => paths.some((p) => matchers[g].some((m) => m.test(p))));
  const w = (out.revisions[wtName.get(r.worktree_id)] ??= { total: 0, none: 0, docsOnly: 0 });
  w.total++;
  if (!hit.length) w.none++;
  if (paths.every((p) => /\.(md|txt)$/.test(p) || p.startsWith("docs/"))) w.docsOnly++;
  for (const g of hit) w[g] = (w[g] ?? 0) + 1;
}

for (const [g, d] of Object.entries(groups)) {
  const files = db.prepare("SELECT id, test_path FROM checks WHERE kind = 'file' AND test_path LIKE ?").all(d.tests);
  const runs = { results: 0, minutes: 0, files: files.length };
  const inh = { states: 0, minutes: 0 };
  const rr = { reruns: 0, changed: 0, examples: [] };
  for (const f of files) {
    const rows = db.prepare("SELECT key, outcome, duration_ms, worktree_id, revision, run_id, recorded_at FROM results WHERE check_id = ? ORDER BY recorded_at").all(f.id);
    runs.results += rows.length;
    runs.minutes += rows.reduce((s, r) => s + r.duration_ms, 0) / 60000;
    for (const k of db.prepare("SELECT duration_ms FROM known_states WHERE check_id = ? AND origin_kind = 'inherited'").all(f.id)) {
      inh.states++;
      inh.minutes += (k.duration_ms ?? 0) / 60000;
    }
    // Test-level outcomes per run of this file.
    const outcomes = (runId) =>
      new Map(db.prepare("SELECT c.full_name, r.outcome FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ? AND c.test_path = ? AND c.kind != 'file'").all(runId, f.test_path).map((x) => [x.full_name, x.outcome]));
    const byWt = new Map();
    for (const r of rows) (byWt.get(r.worktree_id) ?? byWt.set(r.worktree_id, []).get(r.worktree_id)).push(r);
    for (const [wt, rs] of byWt) for (let i = 1; i < rs.length; i++) {
      if (rs[i].key === rs[i - 1].key) continue;
      rr.reruns++;
      const a = outcomes(rs[i - 1].run_id), b = outcomes(rs[i].run_id);
      const changed = [...b].some(([n, o]) => a.has(n) && a.get(n) !== o) || rs[i].outcome !== rs[i - 1].outcome;
      if (changed) {
        rr.changed++;
        rr.examples.push(`${wtName.get(wt)} ${f.test_path} r${rs[i - 1].revision}->r${rs[i].revision} ${rs[i - 1].outcome}->${rs[i].outcome}`);
      }
    }
  }
  out.runs[g] = { ...runs, minutes: +runs.minutes.toFixed(1) };
  out.inherited[g] = { ...inh, minutes: +inh.minutes.toFixed(1) };
  out.reruns[g] = rr;

  // Transitions on this group's checks, and the result each started from.
  for (const t of db.prepare("SELECT t.worktree_id, t.check_id, t.kind, t.revision, t.at, c.test_path, c.full_name FROM transitions t JOIN checks c ON c.id = t.check_id WHERE c.test_path LIKE ? AND t.kind != 'to-unknown' ORDER BY t.at").all(d.tests)) {
    const prev = db.prepare("SELECT worktree_id, revision, outcome FROM results WHERE check_id = ? AND recorded_at < ? ORDER BY recorded_at DESC LIMIT 1").get(t.check_id, t.at - 1000);
    out.transitions.push({
      group: g, at: new Date(t.at).toISOString().slice(5, 16), worktree: wtName.get(t.worktree_id), kind: t.kind, revision: t.revision,
      file: t.test_path.replace(/.*\//, ""), test: t.full_name.slice(0, 70),
      previous: prev ? `${prev.worktree_id === t.worktree_id ? "own" : "other worktree"} r${prev.revision} ${prev.outcome}` : "none",
    });
  }
}
console.log(JSON.stringify(out, null, 1));
