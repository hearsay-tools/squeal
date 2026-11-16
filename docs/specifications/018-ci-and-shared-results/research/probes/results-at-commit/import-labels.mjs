// Throwaway (results-at-commit, question 1, imports). For each import of a
// store (018 D3), the files it stored and what the store holds now at each
// file's key: rows labelled the import's commit, rows whose label another run
// replaced (INSERT OR REPLACE at the same key), or no rows (pruned).
// Usage: node import-labels.mjs <store.sqlite> <dump.jsonl>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [store, dump] = process.argv.slice(2);
const byKey = new Map();
for (const line of readFileSync(dump, "utf8").split("\n")) {
  if (line === "") continue;
  const g = JSON.parse(line);
  const list = byKey.get(g.k) ?? [];
  list.push(g);
  byKey.set(g.k, list);
}
const db = new DatabaseSync(store, { readOnly: true });
const imports = db
  .prepare("select id, json_extract(header,'$.commit') c, imported_at at from imports order by imported_at")
  .all();
const total = { files: 0, sameLabel: 0, otherLabel: 0, otherLabelLive: 0, otherFromImport: 0, otherFromWorktree: 0, none: 0 };
const rows = [];
for (const imp of imports) {
  const n = { files: 0, sameLabel: 0, otherLabel: 0, otherLabelLive: 0, otherFromImport: 0, otherFromWorktree: 0, none: 0 };
  for (const f of db.prepare("select key from import_files where import_id = ?").all(imp.id)) {
    n.files++;
    const groups = byKey.get(f.key) ?? [];
    if (groups.length === 0) n.none++;
    else if (groups.some((g) => g.c === imp.c)) n.sameLabel++;
    else {
      n.otherLabel++;
      if (groups.some((g) => !g.wt.startsWith("import:") && g.origin === "live")) n.otherLabelLive++;
      if (groups.every((g) => g.wt.startsWith("import:"))) n.otherFromImport++;
      else n.otherFromWorktree++;
    }
  }
  for (const k of Object.keys(total)) total[k] += n[k];
  rows.push({ import: imp.id, commit: imp.c.slice(0, 9), importedAt: new Date(imp.at).toISOString(), ...n });
}
for (const r of rows) console.log(JSON.stringify(r));
console.log(JSON.stringify({ summary: true, imports: imports.length, ...total }));
