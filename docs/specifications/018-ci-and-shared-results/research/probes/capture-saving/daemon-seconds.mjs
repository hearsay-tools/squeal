// throwaway (row 018-25): the daemon's own file-seconds in the window (file-level results
// recorded there; a low bound, one row per check and key), its runs, and the hours with no
// daemon run anywhere in the store. Store copies only. Usage: node daemon-seconds.mjs <stores dir> <from> <to>
import { DatabaseSync } from "node:sqlite";
const [dir, from, to] = process.argv.slice(2);
const A = Date.parse(`${from}T00:00:00Z`), B = Date.parse(`${to}T00:00:00Z`), days = (B - A) / 864e5;
for (const repo of ["squeal", "cezar"]) {
  const db = new DatabaseSync(`${dir}/${repo}/store.sqlite`, { readOnly: true });
  const f = db.prepare("SELECT sum(duration_ms) / 1000 s, count(*) n FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.recorded_at >= ? AND r.recorded_at < ?").get(A, B);
  const r = db.prepare("SELECT count(*) n, count(DISTINCT worktree_id) w, min(started_at) first FROM runs WHERE started_at >= ? AND started_at < ?").get(A, B);
  const oldest = db.prepare("SELECT min(started_at) t FROM runs WHERE started_at >= ?").get(A - 3 * 864e5).t;
  const hours = new Set(db.prepare("SELECT started_at FROM runs WHERE started_at >= ? AND started_at < ?").all(A, B).map((x) => Math.floor(x.started_at / 3600e3)));
  const gaps = []; let start = null;
  for (let h = A / 3600e3; h <= B / 3600e3; h++) { const quiet = !hours.has(h) && h < B / 3600e3; if (quiet && start === null) start = h; if (!quiet && start !== null) { if (h - start >= 6) gaps.push(`${new Date(start * 3600e3).toISOString().slice(0, 13)}Z..${new Date(h * 3600e3).toISOString().slice(0, 13)}Z (${h - start} h)`); start = null; } }
  console.log(`${repo}: file-level results ${f.n}, ${Math.round(f.s)} file-seconds (${Math.round(f.s / days)} a day); daemon runs ${r.n} in ${r.w} worktrees; oldest run kept since ${new Date(A - 3 * 864e5).toISOString().slice(0, 10)}: ${new Date(oldest).toISOString()}; gaps of 6 h or more with no daemon run: ${gaps.join(", ") || "none"}`);
}
