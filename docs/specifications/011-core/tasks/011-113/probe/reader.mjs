// Repeats the status read's open sequence beside writers and names the step that gave up early.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [seconds = "10", mode = "ckpt,vacuum,churn", writers = "1", timeout = "1000"] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "busy-probe-"));
const path = join(dir, "store.sqlite");
{
  const db = new DatabaseSync(path);
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v BLOB)");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("PRAGMA user_version = 3");
  db.close();
}
const children = [];
for (let i = 0; i < Number(writers); i++) {
  children.push(spawn(process.execPath, [new URL("./writer.mjs", import.meta.url).pathname, path, seconds, mode], { stdio: "inherit" }));
}
const isBusy = (e) => typeof e?.errcode === "number" && [5, 6].includes(e.errcode & 0xff);
const tally = new Map();
let reads = 0;
const end = Date.now() + Number(seconds) * 1000;
await new Promise((r) => setTimeout(r, 200));
while (Date.now() < end) {
  reads++;
  const started = Date.now();
  let step = "open";
  let db;
  try {
    db = new DatabaseSync(path);
    step = "busy_timeout";
    db.exec(`PRAGMA busy_timeout = ${timeout}`);
    step = "user_version";
    db.prepare("PRAGMA user_version").get();
    step = "page_count";
    db.prepare("PRAGMA page_count").get();
    step = "journal_mode";
    db.prepare("PRAGMA journal_mode = WAL").get();
    step = "synchronous";
    db.exec("PRAGMA synchronous = NORMAL");
    step = "migrate";
    db.prepare("PRAGMA user_version").get();
    step = "begin";
    db.exec("BEGIN");
    step = "select";
    db.prepare("SELECT count(*), sum(length(v)) FROM t").get();
    db.prepare("SELECT value FROM meta WHERE key = 'x'").get();
    step = "commit";
    db.exec("COMMIT");
    step = "close";
    db.close();
    db = undefined;
  } catch (error) {
    const ms = Date.now() - started;
    const key = `${step} ${isBusy(error) ? `errcode=${error.errcode}` : String(error)} ${ms < Number(timeout) / 2 ? "EARLY" : "late"}`;
    const entry = tally.get(key) ?? { count: 0, ms: [] };
    entry.count++;
    if (entry.ms.length < 8) entry.ms.push(ms);
    tally.set(key, entry);
    try { db?.close(); } catch {}
  }
}
await Promise.all(children.map((c) => new Promise((r) => c.on("exit", r))));
console.log(JSON.stringify({ node: process.version, sqlite: process.versions.sqlite, reads, mode, writers, failures: Object.fromEntries(tally) }, null, 1));
