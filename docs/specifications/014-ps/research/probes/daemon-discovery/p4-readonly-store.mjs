// Throwaway probe P4 (014-01): what a read-only connection does to a WAL store
// that a writer holds, on a scratch store under the directory given. Node's
// node:sqlite with { readOnly: true }; no Squeal code.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const role = process.argv[3];
const db = join(dir, "store.sqlite");
const digest = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12) : "absent");

if (role === "writer") {
  // Holds BEGIN IMMEDIATE (the write lock) for 3 s, as a long tier commit would.
  const w = new DatabaseSync(db);
  w.exec("PRAGMA busy_timeout = 5000");
  w.exec("BEGIN IMMEDIATE");
  w.prepare("INSERT INTO meta VALUES (?, ?)").run(`k${Date.now()}`, "x");
  process.send("locked");
  setTimeout(() => { w.exec("COMMIT"); w.close(); process.exit(0); }, 3000);
} else {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const setup = new DatabaseSync(db);
  setup.exec("PRAGMA journal_mode = WAL");
  setup.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; PRAGMA user_version = 1");
  setup.prepare("INSERT INTO meta VALUES ('a','b')").run();
  setup.close(); // last close checkpoints and removes -wal and -shm
  const before = { db: digest(db), wal: digest(`${db}-wal`), shm: existsSync(`${db}-shm`) };
  const out = { load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], before };

  // 1. No WAL files present, no writer: does a read-only open work and write nothing?
  try {
    const r = new DatabaseSync(db, { readOnly: true });
    out.t1 = { userVersion: r.prepare("PRAGMA user_version").get().user_version, rows: r.prepare("SELECT count(*) n FROM meta").get().n };
    try { r.exec("INSERT INTO meta VALUES ('c','d')"); out.t1.write = "accepted"; } catch (e) { out.t1.write = e.message; }
    r.close();
  } catch (e) { out.t1 = { error: e.message }; }
  out.after1 = { db: digest(db), wal: digest(`${db}-wal`), shm: existsSync(`${db}-shm`) };

  // 2. A writer holds the write lock for 3 s: how long does a read-only read wait?
  const child = fork(process.argv[1], [dir, "writer"]);
  await new Promise((res) => child.once("message", res));
  const r2 = new DatabaseSync(db, { readOnly: true });
  r2.exec("PRAGMA busy_timeout = 100");
  const t = performance.now();
  out.t2 = { rows: r2.prepare("SELECT count(*) n FROM meta").get().n, ms: +(performance.now() - t).toFixed(2) };
  r2.close();
  await new Promise((res) => child.once("exit", res));

  // 3. A newer user_version: a read-only reader sees it and touches nothing.
  const bump = new DatabaseSync(db);
  bump.exec("PRAGMA user_version = 99");
  bump.close();
  const before3 = digest(db);
  const r3 = new DatabaseSync(db, { readOnly: true });
  out.t3 = { userVersion: r3.prepare("PRAGMA user_version").get().user_version };
  r3.close();
  out.t3.dbUnchanged = digest(db) === before3;
  console.log(JSON.stringify(out, null, 1));
  rmSync(dir, { recursive: true, force: true });
}
