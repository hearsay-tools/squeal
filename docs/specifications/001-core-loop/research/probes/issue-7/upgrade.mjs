// Throwaway probe for issue 7. Against a store another process holds the write
// lock on (hold.mjs immediate), compares a no-row UPDATE (the statement
// `results.byKey` runs, src/core/store/repos/results.ts:31) run on its own with
// the same UPDATE run inside a read transaction, both at busy_timeout 1000.
// Usage: node upgrade.mjs <store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
db.exec("PRAGMA busy_timeout = 1000");
const UPDATE = "UPDATE results SET last_used_at = 0 WHERE key = 'none' AND last_used_at < 0";
const time = (label, fn) => {
  const t = Date.now();
  try { fn(); console.log(`ok   ${label} ${Date.now() - t} ms`); }
  catch (e) { console.log(`FAIL ${label} after ${Date.now() - t} ms: errcode=${e.errcode} ${e.message}`); }
  try { db.exec("ROLLBACK"); } catch {}
};
time("SELECT inside BEGIN", () => { db.exec("BEGIN"); db.prepare("SELECT count(*) FROM results").get(); });
time("no-row UPDATE, autocommit", () => db.prepare(UPDATE).run());
time("no-row UPDATE inside BEGIN after a SELECT", () => {
  db.exec("BEGIN"); db.prepare("SELECT count(*) FROM results").get(); db.prepare(UPDATE).run();
});
time("no-row UPDATE as the first statement inside BEGIN", () => { db.exec("BEGIN"); db.prepare(UPDATE).run(); });
db.close();
