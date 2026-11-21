// Throwaway (row 018-72). Files whose store closure holds `.git`: does the worktree's own key come
// out of that closure at the commit when `.git` is keyed as a linked worktree's file (its daemon),
// and not when keyed from the commit tree (what D11's re-key does)? Squawk store read-only.
// Usage: tsx git-entry.ts <worktreeId> <commit> [project]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { keyOver, commitSegments, NO_PARTS } from "../../../../../../src/core/store/transfer-rekey.ts";
import { encodeSegment } from "../../../../../../src/core/keys/check-key.ts";
import { isClosurePath } from "../../../../../../src/core/keys/closure.ts";
const [w, commit, project = "server"] = process.argv.slice(2);
const repo = `${process.env.HOME}/projects/cezar`;
const db = new DatabaseSync(`${repo}/.git/squeal/store.sqlite`, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const blobs = new Map<string, string>();
for (const l of execFileSync("git", ["-C", repo, "ls-tree", "-r", commit], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")) { const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(l); if (m) blobs.set(m[2], m[1]); }
const tree = commitSegments(blobs as never);
const asFile = encodeSegment(".git" as never, createHash("sha1").update(".git file").digest("hex") as never);
const linked = (p: string) => (p === ".git" ? asFile : tree(p as never));
const env = (db.prepare("select hash from worktree_environment_hashes where worktree_id=? and project=?").get(w, project) as { hash: string }).hash;
const obs = JSON.parse((db.prepare("select value from meta where key=?").get(`observed.${project}`) as { value: string }).value);
const tally: Record<string, number> = {};
for (const r of db.prepare("select path, closure_paths c from test_files where project=?").all(project) as { path: string; c: string }[]) {
  const list = [...new Set([...JSON.parse(r.c), ...(obs[r.path] ?? []).filter(isClosurePath)])].sort();
  if (!list.includes(".git")) continue;
  const own = (db.prepare("select key from test_file_keys where worktree_id=? and project=? and path=?").get(w, project, r.path) as { key: string } | undefined)?.key;
  if (!own) continue;
  const ref = { project, path: r.path } as never;
  const k = `ownKey=linkedGitFile:${own === keyOver(env as never, ref, list as never, linked as never, NO_PARTS)} ownKey=commitTree:${own === keyOver(env as never, ref, list as never, tree, NO_PARTS)}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log(JSON.stringify({ worktree: w, commit: commit.slice(0, 8), filesWithGitEntry: tally }));
