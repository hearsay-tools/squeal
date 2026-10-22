// How long a reader's busy handler waits on a file another connection locks exclusively.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const path = join(mkdtempSync(join(tmpdir(), "handler-")), "x.sqlite");
const a = new DatabaseSync(path);
a.exec("CREATE TABLE t (x)");
a.exec("PRAGMA locking_mode = EXCLUSIVE");
a.exec("BEGIN EXCLUSIVE");
const out = {};
for (const ms of [1, 3, 10, 100, 500, 999, 1000, 1500]) {
  const b = new DatabaseSync(path);
  b.exec(`PRAGMA busy_timeout = ${ms}`);
  const t = performance.now();
  try { b.prepare("SELECT count(*) FROM t").get(); out[ms] = "read"; } catch (e) { out[ms] = `${e.errcode} after ${Math.round(performance.now() - t)} ms`; }
  b.close();
}
console.log(process.version, process.versions.sqlite, JSON.stringify(out));
