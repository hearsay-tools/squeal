// Throwaway (row 021-06). Worktree removal times from copies of Cezar's task databases (runs.db), read only, keyed by
// Squeal's worktree id (first 16 hex of sha256 over the root path, `worktreeIdOfRealPath`, src/core/fs/git-layout.ts).
// A removed root cannot be resolved, so the path is hashed as written; Cezar writes real paths here.
// Usage: node removals.mjs <runs.db copy>... > removals.jsonl
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
for (const path of process.argv.slice(2)) {
  const db = new DatabaseSync(path, { readOnly: true });
  for (const r of db.prepare("SELECT id, worktree_path, data FROM runs WHERE worktree_path IS NOT NULL").iterate()) {
    let d = {};
    try { d = JSON.parse(r.data); } catch { /* none */ }
    const at = d.delegation?.destroy?.requestedAt ? Date.parse(d.delegation.destroy.requestedAt) : null;
    const wt = createHash("sha256").update(r.worktree_path).digest("hex").slice(0, 16);
    console.log(JSON.stringify({ task: r.id, root: r.worktree_path, wt, removedAt: at }));
  }
}
