// 011-148 probe (throwaway): do the results of removed worktrees that remain sit under a live key? (prune evidence)
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const end = db.prepare("SELECT max(started_at) m FROM runs").get().m; const since = end - 72 * 3600e3;
const q = (s, ...a) => db.prepare(s).all(...a);
console.log(q(`SELECT (r.worktree_id IN (SELECT id FROM worktrees)) live,
  count(*) n,
  sum(r.key IN (SELECT key FROM test_file_keys WHERE key IS NOT NULL)) underLiveKey,
  sum(r.worktree_id IN (SELECT id FROM worktrees WHERE is_main=1)) onMain
  FROM results r JOIN runs u ON u.id = r.run_id WHERE u.started_at >= ? GROUP BY 1`, since));
// runs of removed worktrees in the window: how many survive, and with how many files stored
console.log(q(`SELECT (worktree_id IN (SELECT id FROM worktrees)) live, count(*) runs,
  sum((SELECT count(*) FROM results r WHERE r.run_id = runs.id) = 0) runsWithNoResult FROM runs WHERE started_at >= ? AND ended_at IS NOT NULL GROUP BY 1`, since));
