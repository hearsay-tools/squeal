// Throwaway probe (row 018-39). For each worktree that still has rows and ran
// a daemon after the first import: its test files by the origin of their
// current known states now, when the imported ones were adopted (revision 0 =
// the daemon's start keying; a later revision = after a change while it ran),
// and its local runs since it registered.
// Read-only: `readOnly: true`.
// Usage: node worktrees.mjs <store.sqlite> <local.json> <cutoff-iso>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [storePath, localPath, cutoffIso] = process.argv.slice(2);
const cutoff = Date.parse(cutoffIso);
const local = JSON.parse(readFileSync(localPath, "utf8"));
const medians = local.medianFileMs;
const db = new DatabaseSync(storePath, { readOnly: true });
const FIRST_IMPORT = Date.parse("2026-11-10T21:49:00Z");
const wts = db
  .prepare(
    "select id, root, is_main, registered_at reg, daemon_version v, daemon_heartbeat_at hb from worktrees where daemon_heartbeat_at >= ? order by registered_at",
  )
  .all(FIRST_IMPORT);
const states = db.prepare(`
  select c.project, c.test_path path, k.validity, k.observed_at rev, k.duration_ms ms,
    case when k.origin_kind is null and k.origin_worktree like 'import:%' then 'imported'
         when k.origin_kind is null then 'none' else k.origin_kind end origin
  from known_states k join checks c on c.id = k.check_id
  where k.worktree_id = ? and c.kind != 'setup'`);
const revs = db.prepare("select number, created_at at, trigger, head, changes from revisions where worktree_id = ?");
const closures = new Map(
  db.prepare("select project, path, closure_paths cp from test_files").all().map((r) => [`${r.project}\0${r.path}`, new Set(JSON.parse(r.cp))]),
);
const runs = db.prepare(
  "select count(*) n, min(started_at) first from runs where worktree_id = ? and started_at < ?",
);
console.log(
  [
    "worktree", "registered", "daemon", "files", "current", "imported", "inherited", "own", "notCurrent",
    "imp@rev0", "imp@rev>0", "imp@rev>0 medSec", "imp medSec", "imp@startRev", "imp reached", "reached medSec", "local runs", "local fileRuns", "local fileSec",
  ].join("\t"),
);
const total = {};
for (const w of wts) {
  const revChanges = new Map(
    revs.all(w.id).map((x) => [x.number, { trigger: x.trigger, paths: JSON.parse(x.changes).map((c) => c.path) }]),
  );
  const files = new Map();
  for (const s of states.all(w.id)) {
    const id = `${s.project}\0${s.path}`;
    const f = files.get(id) ?? { origins: new Set(), current: true, rev: 0 };
    if (s.validity !== "current") f.current = false;
    f.origins.add(s.origin);
    if (s.origin === "imported") f.rev = Math.max(f.rev, s.rev ?? 0);
    files.set(id, f);
  }
  const c = { files: files.size, current: 0, imported: 0, inherited: 0, own: 0, notCurrent: 0, rev0: 0, revN: 0, revNSec: 0, impSec: 0, reached: 0, reachedSec: 0, startRev: 0 };
  for (const [id, f] of files) {
    if (!f.current) { c.notCurrent++; continue; }
    c.current++;
    const only = f.origins.size === 1 ? [...f.origins][0] : "mixed";
    if (only === "imported") {
      c.imported++;
      const sec = (medians[id] ?? 0) / 1000;
      c.impSec += sec;
      if (f.rev === 0) c.rev0++;
      else { c.revN++; c.revNSec += sec; }
      // Saved only when the adoption revision's changes reach the file's
      // static closure while the daemon ran (a start's misses are not run
      // under lookup-only, bootstrap.ts).
      const rc = revChanges.get(f.rev);
      const closure = closures.get(id);
      if (rc?.trigger === "start") c.startRev++;
      else if (rc && closure && rc.paths.some((p) => closure.has(p))) { c.reached++; c.reachedSec += sec; }
    } else if (only === "inherited") c.inherited++;
    else if (only === "own") c.own++;
  }
  let fileRuns = 0, fileSec = 0;
  for (const [k, d] of Object.entries(local.days)) {
    if (k.startsWith(`${w.id}\t`)) { fileRuns += d.fileRuns; fileSec += d.fileSec; }
  }
  const r = runs.get(w.id, cutoff);
  for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v;
  console.log(
    [
      w.id.slice(0, 8) + (w.is_main ? " (main)" : ""), new Date(w.reg).toISOString().slice(0, 16), w.v,
      c.files, c.current, c.imported, c.inherited, c.own, c.notCurrent, c.rev0, c.revN, Math.round(c.revNSec), Math.round(c.impSec), c.startRev, c.reached, Math.round(c.reachedSec),
      r.n, fileRuns, fileSec,
    ].join("\t"),
  );
  const moved = revs.all(w.id).filter((x) => x.number > 0);
  if (moved.length) {
    const heads = new Set(moved.map((x) => x.head));
    console.log(`   revisions ${moved.length}, heads ${heads.size}, triggers ${[...new Set(moved.map((x) => x.trigger))].join(",")}`);
  }
}
console.log("TOTAL", JSON.stringify(Object.fromEntries(Object.entries(total).map(([k, v]) => [k, Math.round(v)]))));
