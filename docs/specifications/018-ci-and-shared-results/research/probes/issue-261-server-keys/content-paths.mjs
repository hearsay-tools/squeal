// Throwaway (row 018-72): for test files, the closure paths (store list + observed) whose hash in a
// worktree's stat cache differs from the commit's blob, or that the commit lacks. Read-only.
// Usage: node content-paths.mjs <worktreeId> <commit> <path-regex>
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const [w, commit, re] = process.argv.slice(2);
const repo = process.env.HOME + "/projects/cezar";
const db = new DatabaseSync(repo + "/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const blobs = new Map();
for (const l of execFileSync("git", ["-C", repo, "ls-tree", "-r", commit], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")) { const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(l); if (m) blobs.set(m[2], m[1]); }
const obs = JSON.parse(db.prepare("select value from meta where key='observed.server'").get().value);
const fh = db.prepare("select hash from file_hashes where worktree_id = ? and path = ?");
for (const r of db.prepare("select path, closure_paths c from test_files where project='server'").all().filter((r) => new RegExp(re).test(r.path))) {
  const list = [...new Set([...JSON.parse(r.c), ...(obs[r.path] ?? [])])];
  const odd = list.filter((p) => !p.endsWith("/") && p !== ".git").map((p) => [p, blobs.get(p) ?? null, fh.get(w, p)?.hash ?? null]).filter(([, b, h]) => b !== h);
  const listings = list.filter((p) => p.endsWith("/") || p === ".git").filter((p) => p.startsWith(".") || p === ".git");
  console.log(JSON.stringify({ path: r.path, closure: list.length, differ: odd, dotListings: listings }));
}
