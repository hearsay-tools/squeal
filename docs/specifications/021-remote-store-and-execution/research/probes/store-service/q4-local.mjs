// Throwaway (021-01). The local store's lookup of one worktree's keys, on a COPY of a store,
// with ResultRepo.byKey's query shape (per key) and as one batched query.
// node q4-local.mjs <store copy> <worktree id> [repeats]
import { DatabaseSync } from "node:sqlite";
const [store, worktree, rep] = process.argv.slice(2);
const db = new DatabaseSync(store);
const keys = db.prepare("select key from test_file_keys where worktree_id = ? and key is not null").all(worktree).map((r) => r.key);
const total = db.prepare("select count(*) n from results").get().n;
const one = db.prepare(`SELECT r.*, c.kind, c.project, c.test_path, c.full_name FROM results r JOIN checks c ON c.id = r.check_id WHERE r.key = ?`);
const t = () => process.hrtime.bigint();
const ms = (a) => (Number(t() - a) / 1e6).toFixed(0);
for (let i = 0; i < Number(rep ?? 3); i++) {
  let a = t(); let n = 0; for (const k of keys) n += one.all(k).length; const perKey = ms(a);
  a = t(); db.exec("create temp table if not exists k(key text primary key); delete from k");
  const ins = db.prepare("insert or ignore into k values (?)"); for (const k of keys) ins.run(k);
  const m = db.prepare("SELECT r.*, c.kind, c.project, c.test_path, c.full_name FROM results r JOIN checks c ON c.id = r.check_id WHERE r.key IN (SELECT key FROM k)").all().length;
  console.log(`run ${i + 1}: ${keys.length} keys over ${total} result rows: per key ${perKey} ms (${n} rows), batched ${ms(a)} ms (${m} rows)`);
}
