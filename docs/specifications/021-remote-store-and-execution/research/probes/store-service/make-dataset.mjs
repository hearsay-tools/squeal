// Throwaway (021-01). Builds the benchmark data from a COPY of a Squeal store.
// node make-dataset.mjs <store copy> <out dir> <import id> <worktree id>
// Writes: preload.ndjson (every imported result: the server's standing content),
//         import.ndjson (one main commit's export: the bulk-import operation),
//         lookup-keys.json (one worktree's current keys: the batched-lookup operation),
//         lookup-rows.ndjson (the local results at those keys, preloaded too).
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
const [store, out, importId, worktree] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const db = new DatabaseSync(store);
const cols = `r.key, c.project, c.test_path testPath, c.kind, c.full_name fullName, r.outcome, r.duration_ms durationMs,
  r.location_path locationPath, r.location_line locationLine, r.location_column locationColumn, r.commit_sha "commit", r.recorded_at recordedAt`;
const dump = (file, sql, ...args) => {
  const rows = db.prepare(sql).all(...args);
  writeFileSync(`${out}/${file}`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(file, rows.length, "rows", new Set(rows.map((r) => r.key)).size, "keys");
};
dump("preload.ndjson", `select ${cols} from results r join checks c on c.id = r.check_id where r.worktree_id like 'import:%' and r.worktree_id != ?`, `import:${importId}`);
dump("import.ndjson", `select ${cols} from results r join checks c on c.id = r.check_id where r.worktree_id = ?`, `import:${importId}`);
const keys = db.prepare("select key from test_file_keys where worktree_id = ? and key is not null").all(worktree).map((r) => r.key);
writeFileSync(`${out}/lookup-keys.json`, JSON.stringify(keys));
console.log("lookup-keys.json", keys.length, "keys");
db.exec("create temp table k(key text primary key)");
const ins = db.prepare("insert or ignore into k values (?)");
for (const k of keys) ins.run(k);
dump("lookup-rows.ndjson", `select ${cols} from results r join checks c on c.id = r.check_id where r.key in (select key from k) and r.worktree_id not like 'import:%'`);
