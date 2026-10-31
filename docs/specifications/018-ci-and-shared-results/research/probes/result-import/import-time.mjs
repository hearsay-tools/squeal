// Throwaway (topic result-import): time applying one export (gunzip, parse, insert) into an empty
// store with the same schema. Reads a COPIED store; writes only <out dir>.
// node import-time.mjs <store copy> <worktree id> <out dir>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
const [path, worktree, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const src = new DatabaseSync(path, { readOnly: true });
const keys = src.prepare("SELECT project, path, key FROM test_file_keys WHERE worktree_id = ? AND key IS NOT NULL").all(worktree);
const want = new Set(keys.map((k) => k.key));
const results = src.prepare("SELECT * FROM results").iterate();
const picked = [];
for (const r of results) if (want.has(r.key)) picked.push(r);
const ids = new Set(picked.map((r) => r.check_id));
const checks = src.prepare("SELECT * FROM checks").all().filter((c) => ids.has(c.id));
const files = new Set(keys.map((k) => `${k.project}\0${k.path}`));
const closures = src.prepare("SELECT * FROM test_files").all().filter((t) => files.has(`${t.project}\0${t.path}`));
const schema = src.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all().map((r) => r.sql);
const file = join(out, "export.json.gz");
writeFileSync(file, gzipSync(JSON.stringify({ results: picked, checks, closures })));
const times = [];
for (let i = 0; i < 3; i++) {
  const db0 = join(out, `fresh-${i}.sqlite`);
  rmSync(db0, { force: true });
  const db = new DatabaseSync(db0);
  db.exec("PRAGMA journal_mode = WAL");
  for (const sql of schema) db.exec(sql);
  const t0 = performance.now();
  const data = JSON.parse(gunzipSync(readFileSync(file)).toString());
  const t1 = performance.now();
  db.exec("BEGIN IMMEDIATE");
  const insert = (table, rows) => {
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const st = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    for (const row of rows) st.run(...cols.map((c) => row[c]));
  };
  insert("checks", data.checks);
  insert("test_files", data.closures);
  insert("results", data.results);
  db.exec("COMMIT");
  const t2 = performance.now();
  db.close();
  times.push({ parseMs: Math.round(t1 - t0), insertMs: Math.round(t2 - t1) });
  rmSync(db0, { force: true }); rmSync(`${db0}-wal`, { force: true }); rmSync(`${db0}-shm`, { force: true });
}
console.log(JSON.stringify({ results: picked.length, checks: checks.length, closures: closures.length, gzipBytes: readFileSync(file).length, times }));
