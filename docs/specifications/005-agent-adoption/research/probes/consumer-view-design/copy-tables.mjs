// Throwaway (row 005-104). Copies the tables a consumer view touches from a live store into a new
// file in this task's scratch directory: one read transaction on a read-only connection, so the copy
// is one consistent snapshot and the live store gets no write. Tables: meta, worktrees, revisions,
// checks, known_states, transitions, consumers, consumer_views, with their indexes and the
// write-marker triggers on known_states (they fire on every state write). No ANALYZE: the live stores have no statistics.
// Usage: node copy-tables.mjs <live store.sqlite> <copy.sqlite>
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
const [from, to] = process.argv.slice(2);
if (!to.includes("/t/4a1288e6/")) throw new Error("copies go to this task's scratch only");
if (existsSync(to)) throw new Error("copy exists");
const TABLES = ["meta", "worktrees", "revisions", "checks", "known_states", "transitions", "consumers", "consumer_views"];
const src = new DatabaseSync(from, { readOnly: true });
src.exec("PRAGMA busy_timeout = 10000");
const dst = new DatabaseSync(to);
dst.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
const t0 = performance.now();
src.exec("BEGIN"); // one snapshot for every table
const ddl = src.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','trigger')").all()
  .filter((r) => TABLES.includes(r.tbl_name));
for (const r of ddl.filter((r) => r.type === "table")) dst.exec(r.sql);
const counts = {};
for (const t of TABLES) {
  const cols = src.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const ins = dst.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  dst.exec("BEGIN");
  let n = 0;
  for (const row of src.prepare(`SELECT ${cols.join(",")} FROM ${t}`).iterate()) { ins.run(...cols.map((c) => row[c])); n++; }
  dst.exec("COMMIT");
  counts[t] = n;
}
const userVersion = src.prepare("PRAGMA user_version").get().user_version;
src.exec("COMMIT");
for (const r of ddl.filter((r) => r.type !== "table")) dst.exec(r.sql);
dst.exec(`PRAGMA user_version = ${userVersion}`);
console.log(JSON.stringify({ from, to, userVersion, counts, ms: Math.round(performance.now() - t0) }));
src.close(); dst.close();
