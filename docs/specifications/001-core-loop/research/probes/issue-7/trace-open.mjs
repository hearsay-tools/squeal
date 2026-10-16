// Throwaway probe for issue 7. Replays the statements `openStore(..., { create:
// false, busyTimeoutMs: 1000 })` runs on an existing store (src/core/store/open.ts
// connect(), at 23f276c2) one by one, printing each one's time and SQLite error.
// Usage: node trace-open.mjs <store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
const step = (label, fn) => {
  const t = Date.now();
  try {
    const v = fn();
    console.log(`ok   ${label} ${Date.now() - t} ms ${v === undefined ? "" : JSON.stringify(v)}`);
  } catch (e) {
    console.log(`FAIL ${label} ${Date.now() - t} ms errcode=${e.errcode} errstr=${e.errstr} ${e.message}`);
  }
};
step("PRAGMA busy_timeout = 1000", () => db.exec("PRAGMA busy_timeout = 1000"));
step("PRAGMA user_version", () => db.prepare("PRAGMA user_version").get());
step("PRAGMA page_count", () => db.prepare("PRAGMA page_count").get());
step("PRAGMA journal_mode = WAL", () => db.prepare("PRAGMA journal_mode = WAL").get());
step("PRAGMA journal_mode", () => db.prepare("PRAGMA journal_mode").get());
step("PRAGMA synchronous = NORMAL", () => db.exec("PRAGMA synchronous = NORMAL"));
step("BEGIN; SELECT count(*) FROM sqlite_master; COMMIT", () => {
  db.exec("BEGIN");
  const r = db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
  db.exec("COMMIT");
  return r;
});
db.close();
