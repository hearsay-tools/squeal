// PROBE 001-201 (throwaway): cost of checking and writing claims on a copy of cezar's store,
// idle and beside writers that hold BEGIN IMMEDIATE like a tier's commit.
import { DatabaseSync } from "node:sqlite";
import { fork } from "node:child_process";
const [file, mode] = process.argv.slice(2);
if (mode === "writer") {
  const db = new DatabaseSync(file); db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000");
  const wt = db.prepare("SELECT worktree_id w FROM known_states GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").get().w;
  const upd = db.prepare("UPDATE known_states SET observed_at = ? WHERE worktree_id = ? AND check_id % 8 = ?");
  const keys = db.prepare("UPDATE test_file_keys SET revision = revision WHERE worktree_id = ?");
  let held = [];
  const end = Date.now() + Number(process.argv[4]);
  let i = 0;
  while (Date.now() < end) {
    const t = performance.now(); db.exec("BEGIN IMMEDIATE");
    upd.run(Date.now(), wt, i++ % 8); keys.run(wt); db.exec("COMMIT"); held.push(performance.now() - t);
    const until = Date.now() + 150; while (Date.now() < until) {} // busy gap like a tier's work between commits
  }
  held.sort((a, b) => a - b);
  process.send({ commits: held.length, p50: held[held.length >> 1], max: held.at(-1) });
  process.exit(0);
}
const db = new DatabaseSync(file); db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000");
db.exec(`CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, worktree_id TEXT NOT NULL, daemon_started_at INTEGER NOT NULL,
  pid INTEGER NOT NULL, claimed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT`);
const keys = db.prepare("SELECT DISTINCT key FROM test_file_keys WHERE key IS NOT NULL LIMIT 651").all().map((r) => r.key);
const me = "probe-worktree";
const derived = db.prepare(`SELECT 1 AS one FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
  WHERE k.key = ? AND k.pending = 'running' AND k.worktree_id <> ? AND w.daemon_heartbeat_at >= ? - 2 * COALESCE(w.daemon_heartbeat_interval_ms, 5000) LIMIT 1`);
const metaGet = db.prepare("SELECT value FROM meta WHERE key = ?");
const metaPut = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
const metaDel = db.prepare("DELETE FROM meta WHERE key = ?");
const tGet = db.prepare("SELECT worktree_id, expires_at FROM claims WHERE key = ?");
const tPut = db.prepare("INSERT OR REPLACE INTO claims VALUES (?, ?, ?, ?, ?, ?)");
const tDel = db.prepare("DELETE FROM claims WHERE key = ? AND worktree_id = ?");
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
const tx = (fn) => { db.exec("BEGIN IMMEDIATE"); try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
function round(label) {
  const r = {};
  const tier = keys.slice(0, 200);
  r.checkDerived651 = time(() => { for (const k of keys) derived.get(k, me, Date.now()); });
  r.checkMeta651 = time(() => { for (const k of keys) metaGet.get("claim:" + k); });
  r.checkTable651 = time(() => { for (const k of keys) tGet.get(k); });
  const v = JSON.stringify({ worktree: me, daemonStartedAt: 1, pid: 1, claimedAt: Date.now(), expiresAt: Date.now() + 1e6 });
  r.claimMeta200 = time(() => tx(() => { for (const k of tier) metaPut.run("claim:" + k, v); }));
  r.releaseMeta200 = time(() => tx(() => { for (const k of tier) metaDel.run("claim:" + k); }));
  r.claimTable200 = time(() => tx(() => { for (const k of tier) tPut.run(k, me, 1, 1, Date.now(), Date.now() + 1e6); }));
  r.releaseTable200 = time(() => tx(() => { for (const k of tier) tDel.run(k, me); }));
  r.claimTable4 = time(() => tx(() => { for (const k of tier.slice(0, 4)) tPut.run(k, me, 1, 1, Date.now(), Date.now() + 1e6); }));
  r.releaseTable4 = time(() => tx(() => { for (const k of tier.slice(0, 4)) tDel.run(k, me); }));
  console.log(label, Object.fromEntries(Object.entries(r).map(([k, x]) => [k, +x.toFixed(2)])));
}
for (let i = 0; i < 3; i++) round("idle");
const writers = [0, 1, 2].map(() => fork(new URL(import.meta.url).pathname, [file, "writer", "20000"]));
const stats = writers.map((w) => new Promise((r) => w.on("message", r)));
await new Promise((r) => setTimeout(r, 1000));
for (let i = 0; i < 5; i++) { round("load"); await new Promise((r) => setTimeout(r, 500)); }
console.log("writers", await Promise.all(stats));
