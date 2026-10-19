// THROWAWAY probe (011-core/research/catch-up.md). For each worktree of cezar's store copy: its
// test files, how many hold no current state (known_states not `current` for any check of the
// file, or no state at all), and how many of those have results stored at their own key, which a
// lookup would adopt now. Also times the lookups a re-look-up pass would make. Read-only.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2] ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const wts = db.prepare("select id, root, daemon_heartbeat_at hb from worktrees").all();
const latestHb = Math.max(...wts.map((w) => w.hb ?? 0));
const keysOf = db.prepare("select project, path, key, pending from test_file_keys where worktree_id = ?");
const statesOf = db.prepare("select c.project, c.test_path, k.validity, k.origin_kind, k.origin_worktree from known_states k join checks c on c.id = k.check_id where k.worktree_id = ?");
const byKey = db.prepare("select r.worktree_id, r.outcome, r.recorded_at from results r where r.key = ?");
const out = [];
for (const w of wts) {
  const keys = keysOf.all(w.id);
  const states = new Map();
  for (const s of statesOf.all(w.id)) {
    const id = `${s.project}\0${s.test_path}`;
    const e = states.get(id) ?? { current: 0, other: 0, inherited: 0 };
    if (s.validity === "current") e.current++; else e.other++;
    if (s.origin_kind === "inherited") e.inherited++;
    states.set(id, e);
  }
  let notCurrent = 0, adoptable = 0, adoptableFail = 0, queued = 0, inherited = 0;
  const t0 = performance.now();
  let lookups = 0;
  for (const k of keys) {
    const s = states.get(`${k.project}\0${k.path}`);
    if (s?.inherited) inherited++;
    if (k.key === null || (s && s.current > 0 && s.other === 0)) continue;
    notCurrent++;
    if (k.pending !== null) queued++;
    lookups++;
    const hits = byKey.all(k.key);
    if (hits.length > 0) { adoptable++; if (hits.some((h) => h.outcome === "fail")) adoptableFail++; }
  }
  const ms = performance.now() - t0;
  out.push({ wt: w.id.slice(0, 8), root: w.root.split("/").pop().slice(0, 8), live: (latestHb - (w.hb ?? 0)) < 120_000,
    files: keys.length, notCurrent, queued, adoptable, adoptableFail, inherited, lookups, lookupMs: Math.round(ms) });
}
out.sort((a, b) => b.adoptable - a.adoptable);
console.table(out);
writeFileSync("results/adoptable.json", JSON.stringify(out, null, 1));
