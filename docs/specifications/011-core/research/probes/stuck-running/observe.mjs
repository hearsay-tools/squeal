// Samples a fixture's Squeal store read-only, for row 011-394 (throwaway).
// Usage: node observe.mjs <git-common-dir> <out.jsonl> <seconds> [interval-ms=2000]
// Each line: time, load, per worktree its heartbeat age, open runs (start, files,
// age), counts of test_file_keys.pending, and the newest ended runs.
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [commonDir, out, seconds, every = "2000"] = process.argv.slice(2);
const file = join(commonDir, "squeal", "store.sqlite");
for (let i = 0; i < 300 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 1000));
const db = new DatabaseSync(file, { readOnly: true });
db.exec("PRAGMA busy_timeout = 2000");
const end = Date.now() + Number(seconds) * 1000;
let lastEnded = 0;
function sample() {
  const now = Date.now();
  const load = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).map(Number);
  const worktrees = db.prepare(
    "SELECT id, root, daemon_started_at s, daemon_heartbeat_at h FROM worktrees").all()
    .map((w) => ({ id: w.id, root: w.root.split("/").pop(), daemonStartedAt: w.s,
      heartbeatAgeMs: w.h === null ? null : now - Number(w.h),
      revision: db.prepare("SELECT max(number) n FROM revisions WHERE worktree_id = ?").get(w.id)?.n ?? null,
      refined: db.prepare("SELECT value FROM meta WHERE key LIKE ? AND key LIKE ?").get("%refined%", `%${w.id}%`)?.value ?? null }));
  const open = db.prepare(
    "SELECT id, worktree_id w, revision r, test_files f, started_at s FROM runs WHERE ended_at IS NULL").all()
    .map((r) => ({ id: r.id.slice(0, 8), w: r.w.slice(0, 6), rev: r.r,
      files: JSON.parse(r.f).length, ageMs: now - Number(r.s) }));
  const pending = Object.fromEntries(db.prepare(
    "SELECT worktree_id w, coalesce(pending,'none') p, count(*) n FROM test_file_keys GROUP BY 1,2").all()
    .map((x) => [`${x.w.slice(0, 6)}:${x.p}`, x.n]));
  const ended = db.prepare(
    "SELECT id, worktree_id w, test_files f, started_at s, ended_at e, end_state st FROM runs WHERE ended_at > ? ORDER BY ended_at").all(lastEnded)
    .map((r) => { lastEnded = Math.max(lastEnded, Number(r.e));
      return { id: r.id.slice(0, 8), w: r.w.slice(0, 6), files: JSON.parse(r.f).length,
        ms: Number(r.e) - Number(r.s), end: r.st }; });
  appendFileSync(out, JSON.stringify({ t: new Date(now).toISOString(), load, worktrees, open, pending, ended }) + "\n");
}
const timer = setInterval(() => { try { sample(); } catch (e) { appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), error: String(e) }) + "\n"); }
  if (Date.now() > end) { clearInterval(timer); db.close(); } }, Number(every));
sample();
