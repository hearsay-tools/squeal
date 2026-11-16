// Throwaway (results-at-commit, question 2). Paths a worktree hashed that its
// HEAD's tree lacks (untracked or ignored files), grouped by top directory,
// and how many listed test files' store closures name one.
// Usage: node disk-only.mjs <store.sqlite> <worktree-id>
import { DatabaseSync } from "node:sqlite";
import { storeClosures } from "./lib.mjs";
import { blobsOf } from "./tree-of.mjs";
const [store, wt] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const w = db.prepare(`select w.root, r.head from worktrees w join revisions r on r.worktree_id = w.id
  where w.id = ? order by r.number desc limit 1`).get(wt);
const tree = blobsOf(w.root, w.head);
const only = db.prepare("select path from file_hashes where worktree_id = ?").all(wt).map((r) => r.path).filter((p) => !tree.has(p));
const groups = {};
for (const p of only) {
  const g = p.includes("node_modules/") ? "node_modules/**" : p.split("/").slice(0, 2).join("/");
  groups[g] = (groups[g] ?? 0) + 1;
}
const set = new Set(only);
const { closures } = storeClosures(store);
const listed = new Set(db.prepare("select project, path from test_file_keys where worktree_id = ?").all(wt).map((r) => `${r.project}\0${r.path}`));
let files = 0, naming = 0;
for (const [id, f] of closures) {
  if (!listed.has(id)) continue;
  files++;
  if (f.paths.some((p) => set.has(p))) naming++;
}
console.log(JSON.stringify({ worktree: wt, onlyOnDisk: only.length, groups, listedTestFiles: files, closuresNamingOne: naming }));
