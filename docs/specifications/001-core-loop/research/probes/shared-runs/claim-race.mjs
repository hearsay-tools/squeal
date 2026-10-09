// PROBE 001-201 (throwaway): four processes claim 600 keys in tiers of 10, in the same order.
// "inside": check and claim in one BEGIN IMMEDIATE. "outside": check, then claim in its own transaction.
import { DatabaseSync } from "node:sqlite";
import { fork } from "node:child_process";
import { rmSync } from "node:fs";
const [mode, file, who] = process.argv.slice(2);
const open = (p = file) => { const db = new DatabaseSync(p); db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000"); return db; };
if (who !== undefined) {
  const db = open();
  const free = db.prepare("SELECT key FROM keys WHERE key NOT IN (SELECT key FROM claims) ORDER BY key LIMIT 10");
  const put = db.prepare("INSERT INTO claims_log (key, who) VALUES (?, ?)");
  const claim = db.prepare("INSERT OR IGNORE INTO claims (key, who) VALUES (?, ?)");
  let tiers = 0;
  for (;;) {
    let picked;
    if (mode === "inside") {
      db.exec("BEGIN IMMEDIATE");
      picked = free.all().map((r) => r.key);
      for (const k of picked) { claim.run(k, who); put.run(k, who); }
      db.exec("COMMIT");
    } else {
      picked = free.all().map((r) => r.key);
      const until = performance.now() + 2; while (performance.now() < until) {} // the selection's own work
      db.exec("BEGIN IMMEDIATE");
      for (const k of picked) { claim.run(k, who); put.run(k, who); }
      db.exec("COMMIT");
    }
    if (picked.length === 0) break;
    tiers++;
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 5)); // the tier runs
  }
  process.send(tiers); process.exit(0);
}
for (const m of ["inside", "outside"]) {
  const path = `/tmp/sr201/race-${m}.sqlite`; rmSync(path, { force: true }); rmSync(path + "-wal", { force: true }); rmSync(path + "-shm", { force: true });
  const db = open(path);
  db.exec("CREATE TABLE keys (key TEXT PRIMARY KEY); CREATE TABLE claims (key TEXT PRIMARY KEY, who TEXT); CREATE TABLE claims_log (key TEXT, who TEXT)");
  const ins = db.prepare("INSERT INTO keys VALUES (?)");
  db.exec("BEGIN"); for (let i = 0; i < 600; i++) ins.run(String(i).padStart(4, "0")); db.exec("COMMIT");
  const kids = [0, 1, 2, 3].map((w) => fork(new URL(import.meta.url).pathname, [m, path, `w${w}`]));
  const tiers = await Promise.all(kids.map((k) => new Promise((r) => k.on("message", r))));
  const dup = db.prepare("SELECT count(*) n FROM (SELECT key FROM claims_log GROUP BY key HAVING count(*) > 1)").get().n;
  const total = db.prepare("SELECT count(*) n FROM claims_log").get().n;
  const per = db.prepare("SELECT who, count(*) n FROM claims_log GROUP BY who ORDER BY who").all().map((r) => `${r.who}=${r.n}`).join(" ");
  console.log(`${m}: tiers ${tiers.join("/")}, keys taken ${total} for 600, keys taken twice or more ${dup}, per process ${per}`);
}
