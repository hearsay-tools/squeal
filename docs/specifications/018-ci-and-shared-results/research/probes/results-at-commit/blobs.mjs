// Throwaway (results-at-commit, question 2). Squeal's stored file hash per
// path (`file_hashes`) against `git ls-tree` of the worktree's HEAD: equal,
// different (edited or converted), only in git, only on disk (untracked or
// ignored files a key may hold). Read-only on the store and the repository.
// Usage: node blobs.mjs <store.sqlite> [max-worktrees]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { blobsOf } from "./tree-of.mjs";
const [store, maxArg] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const wts = db.prepare(`select w.id, w.root, r.head, r.dirty from worktrees w
  join revisions r on r.worktree_id = w.id
  where r.number = (select max(number) from revisions where worktree_id = w.id)`).all();
let done = 0;
for (const w of wts) {
  if (done >= Number(maxArg ?? 5) || w.head === null || !existsSync(w.root)) continue;
  const tree = blobsOf(w.root, w.head);
  if (tree === null) continue;
  const n = { equal: 0, differ: 0, onlyGit: 0, onlyDisk: 0, onlyDiskInNodeModules: 0 };
  const seen = new Set();
  for (const row of db.prepare("select path, hash from file_hashes where worktree_id = ?").iterate(w.id)) {
    seen.add(row.path);
    const blob = tree.get(row.path);
    if (blob === undefined) {
      if (row.path.includes("node_modules/")) n.onlyDiskInNodeModules++;
      else n.onlyDisk++;
    } else if (blob === row.hash) n.equal++;
    else n.differ++;
  }
  for (const p of tree.keys()) if (!seen.has(p)) n.onlyGit++;
  console.log(JSON.stringify({ worktree: w.id, head: w.head.slice(0, 9), dirty: w.dirty, ...n }));
  done++;
}
