// Throwaway probe (row 018-39). Per import: what the store holds today at each
// exported file's key, read through the file's `file` check.
//   used      the import's row is there and some daemon looked the key up
//             (`last_used_at` moved past the import time; `byKey` moves it)
//   unused    the import's row is there, never looked up
//   late      a local row recorded before the import (add-only import kept it)
//   rerun     a local row recorded after the import: a local run at the same
//             key replaced the import's row (`putMany` is INSERT OR REPLACE)
//   gone      no row at the key (pruned)
// Seconds: the file check's duration of the row there (CI's for used/unused,
// local for late/rerun), and the local median from local.mjs's output.
// Read-only: `readOnly: true`.
// Usage: node imports.mjs <store.sqlite> <local.json> <cutoff-iso> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [storePath, localPath, cutoffIso, outPath] = process.argv.slice(2);
const cutoff = Date.parse(cutoffIso);
const medians = JSON.parse(readFileSync(localPath, "utf8")).medianFileMs;
const db = new DatabaseSync(storePath, { readOnly: true });
const imports = db
  .prepare(
    "select id, imported_at at, json_extract(header,'$.squealVersion') v, json_extract(header,'$.commit') c from imports where imported_at < ? order by imported_at",
  )
  .all(cutoff);
const files = db.prepare("select project, path, key from import_files where import_id = ?");
const fileCheck = db.prepare("select id from checks where kind = 'file' and project = ? and test_path = ?");
const row = db.prepare(
  "select worktree_id wt, recorded_at rec, last_used_at used, duration_ms ms from results where check_id = ? and key = ?",
);
const out = [];
const byWorktree = new Map(); // late/rerun per local worktree
for (const imp of imports) {
  const mark = `import:${imp.id}`;
  const cats = {};
  const add = (cat, ms, med) => {
    const c = (cats[cat] ??= { files: 0, rowSec: 0, medianSec: 0 });
    c.files++;
    c.rowSec += (ms ?? 0) / 1000;
    c.medianSec += (med ?? ms ?? 0) / 1000;
  };
  for (const f of files.all(imp.id)) {
    const med = medians[`${f.project}\0${f.path}`];
    const check = fileCheck.get(f.project, f.path);
    const r = check ? row.get(check.id, f.key) : undefined;
    let cat;
    if (!r) cat = "gone";
    else if (r.wt === mark) cat = r.used > r.rec ? "used" : "unused";
    else if (r.wt.startsWith("import:")) cat = "otherImport";
    else if (r.rec < imp.at) cat = "late";
    else cat = "rerun";
    add(cat, r?.ms, med);
    if (cat === "late" || cat === "rerun") {
      const k = `${r.wt}\t${cat}`;
      const w = byWorktree.get(k) ?? { files: 0, sec: 0 };
      w.files++;
      w.sec += r.ms / 1000;
      byWorktree.set(k, w);
    }
  }
  for (const c of Object.values(cats)) {
    c.rowSec = Math.round(c.rowSec);
    c.medianSec = Math.round(c.medianSec);
  }
  out.push({ importedAt: new Date(imp.at).toISOString().slice(0, 16), ci: imp.v, commit: imp.c.slice(0, 8), ...cats });
}
writeFileSync(outPath, JSON.stringify({ cutoff: cutoffIso, imports: out, byWorktree: Object.fromEntries(byWorktree) }, null, 1));
const cols = ["used", "unused", "late", "rerun", "otherImport", "gone"];
console.log(["importedAt", "ci", "commit", ...cols.map((c) => `${c} files/medSec`)].join("\t"));
for (const o of out) console.log([o.importedAt, o.ci, o.commit, ...cols.map((c) => (o[c] ? `${o[c].files}/${o[c].medianSec}` : "-"))].join("\t"));
