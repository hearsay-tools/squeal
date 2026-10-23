// Task 011-122: the latency of a SQLite WAL commit with synchronous=FULL, as long-writer.ts commits, N times.
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
const dir = mkdtempSync(join(process.argv[2] ?? "/tmp", "fsync-"));
const db = new DatabaseSync(join(dir, "s.sqlite"));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)");
const ms = [];
for (let i = 0; i < Number(process.argv[3] ?? 20); i++) {
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT OR REPLACE INTO t VALUES ('k', ?)").run(String(i));
  const t0 = performance.now();
  db.exec("COMMIT");
  ms.push(performance.now() - t0);
}
db.close();
rmSync(dir, { recursive: true, force: true });
ms.sort((a, b) => a - b);
console.log(JSON.stringify({ n: ms.length, min: ms[0].toFixed(2), median: ms[ms.length >> 1].toFixed(2), max: ms.at(-1).toFixed(2) }));
