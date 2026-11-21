// Throwaway probe (row 018-69): in a COPY of the reporter's store, for each
// revision of one worktree that ran test files, how many of the files it ran
// had, at the key it ran them at, a result in some import of that revision's
// HEAD (any worktree's import, import_files.key). Those runs an import of the
// new HEAD's export would have saved had it arrived before they started.
// Usage: node reporter.mjs <store-copy.sqlite> <worktree-id>
import { DatabaseSync } from "node:sqlite";

const [file, w] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const heads = new Map(db.prepare("select number, head, created_at from revisions where worktree_id = ?").all(w).map((r) => [r.number, r]));
const runs = db.prepare("select id, revision, started_at s, ended_at e, test_files tf from runs where worktree_id = ? order by started_at").all(w);
const keyOf = db.prepare("select distinct key from results where run_id = ? and check_id in (select id from checks where project = ? and test_path = ?)");
const importsOf = db.prepare("select id, imported_at at from imports where json_extract(header,'$.commit') = ?");
const inImport = db.prepare("select 1 from import_files where import_id = ? and project = ? and path = ? and key = ? limit 1");
const anyImport = db.prepare("select 1 from import_files where import_id = ? and project = ? and path = ? limit 1");
const byRev = new Map();
for (const run of runs) {
  const rev = heads.get(run.revision);
  const imps = importsOf.all(rev.head);
  const row = byRev.get(run.revision) ?? { revision: run.revision, head: rev.head.slice(0, 8), revisionAt: new Date(rev.created_at).toISOString(),
    firstImportOfHead: imps.length ? new Date(Math.min(...imps.map((i) => i.at))).toISOString() : null,
    files: 0, fileMinutes: 0, sameKeyInHeadExport: 0, sameKeyMinutes: 0, inExportOtherKey: 0, notInExport: 0, noStoredKey: 0 };
  const files = JSON.parse(run.tf);
  const share = (run.e - run.s) / 60000 / files.length;
  for (const f of files) {
    row.files++; row.fileMinutes += share;
    const keys = keyOf.all(run.id, f.project, f.path).map((k) => k.key);
    if (keys.length === 0) { row.noStoredKey++; continue; }
    if (imps.some((i) => keys.some((k) => inImport.get(i.id, f.project, f.path, k)))) { row.sameKeyInHeadExport++; row.sameKeyMinutes += share; }
    else if (imps.some((i) => anyImport.get(i.id, f.project, f.path))) row.inExportOtherKey++;
    else row.notInExport++;
  }
  byRev.set(run.revision, row);
}
for (const r of byRev.values()) { r.fileMinutes = +r.fileMinutes.toFixed(1); r.sameKeyMinutes = +r.sameKeyMinutes.toFixed(1); console.log(JSON.stringify(r)); }
