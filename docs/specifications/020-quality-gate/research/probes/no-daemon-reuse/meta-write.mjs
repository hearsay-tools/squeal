// Throwaway (row 020-38): the cost of one merge write of the shared observed rows,
// as `SharedPaths.write` does it (src/core/keys/observed.ts): in one transaction,
// read the row, parse it, add the new paths, sort, format and write it back.
// Reads the rows from <store> read-only; writes only to a scratch database <scratch>
// in WAL mode with synchronous NORMAL, as the store opens. Prints JSON.
// node meta-write.mjs <store.sqlite> <scratch.sqlite> [iterations]
import { DatabaseSync } from "node:sqlite";
import { rmSync, statSync } from "node:fs";
const [store, scratch, n = "15"] = process.argv.slice(2);
const src = new DatabaseSync(store, { readOnly: true });
const rows = src.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed%.'").all();
src.close();
for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`]) rmSync(f, { force: true });
const db = new DatabaseSync(scratch);
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
const put = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
for (const { key, value } of rows) put.run(key, value);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const get = db.prepare("SELECT value FROM meta WHERE key = ?");
const out = { rows: rows.map((r) => ({ key: r.key, bytes: Buffer.byteLength(r.value) })), writes: [] };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const { key } of rows) {
  const times = [];
  const wal = [];
  for (let i = 0; i < Number(n); i++) {
    const before = statSync(`${scratch}-wal`).size;
    const t = process.hrtime.bigint();
    db.exec("BEGIN IMMEDIATE");
    const stored = JSON.parse(get.get(key).value);
    const entry = Object.keys(stored)[i % Object.keys(stored).length] ?? "";
    stored[entry] = [...new Set([...(stored[entry] ?? []), `ndr/probe-${i}.txt`])].sort();
    const sorted = Object.fromEntries(Object.entries(stored).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    put.run(key, JSON.stringify(sorted));
    db.exec("COMMIT");
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
    wal.push(statSync(`${scratch}-wal`).size - before);
    if (i % 5 === 4) db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  out.writes.push({ key, medianMs: +median(times).toFixed(2), maxMs: +Math.max(...times).toFixed(2), medianWalBytes: median(wal.filter((b) => b > 0)) });
}
out.load1m = Number((await import("node:fs")).readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
db.close();
console.log(JSON.stringify(out, null, 1));
