// One project's test-file keys side by side for several worktrees of one store (read only):
// key prefix, the revision it was computed at, and whether it is queued or running.
// Usage: node keys.mjs <store.sqlite> <project> <worktree-id> ...
import { DatabaseSync } from "node:sqlite";

const [file, project, ...worktrees] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const byFile = {};
for (const wt of worktrees) {
  const rows = db.prepare("select path, key, revision, pending from test_file_keys where worktree_id = ? and project = ?").all(wt, project);
  for (const r of rows) {
    (byFile[r.path.split("/").at(-1)] ??= {})[wt] = `${r.key.slice(0, 10)}@r${r.revision}${r.pending ? `/${r.pending}` : ""}`;
  }
}
console.log("file", worktrees.join(" "));
for (const [path, keys] of Object.entries(byFile).sort()) {
  const distinct = new Set(worktrees.map((w) => keys[w]?.slice(0, 10))).size;
  console.log(path, worktrees.map((w) => keys[w] ?? "-").join(" "), distinct === 1 ? "same" : "differ");
}
