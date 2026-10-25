// Throwaway probe (016-27), questions 3 to 5: for each worktree of a store whose daemon started after
// <sinceMs> and whose root still exists, the state of every listed directory of the observed maps:
//   watched  - the watcher sees a file in it (`git ls-files -co --exclude-standard`), and no other name;
//   mixed    - the watcher sees a file in it, and it also holds names the watcher does not see (Q5);
//   absent / empty / unwatched - the watcher sees no file in it; `unwatched` holds names on disk (Q3).
// Leaves out C2's atomic-save temp names (`<file>.tmp.<pid>.<random>`) from the unseen names.
// Reads git and the disk only (`git ls-files` writes nothing); opens the store read-only.
// Usage: node classify.mjs <store> <sinceMs> <listings.jsonl> [worktree-to-skip]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [file, sinceMs, listingsFile, skip = ""] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const listings = readFileSync(listingsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const TEMP = /\.tmp\.\d+\.[0-9a-z]+$/i;
const worktrees = db.prepare("select id, root, daemon_version v from worktrees where daemon_started_at > ? order by id").all(Number(sinceMs));
for (const wt of worktrees) {
  if (wt.id === skip || !existsSync(wt.root)) continue;
  const ignored = new Set();
  for (const { dir: listed } of listings) {
    if (listed === "./") continue;
    try {
      for (const p of execFileSync("git", ["-C", wt.root, "ls-files", "-oi", "--exclude-standard", "-z", "--", listed], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\0")) if (p) ignored.add(p);
    } catch { /* a pathspec beyond a symlink: git sees nothing there */ }
  }
  const seen = db.prepare("select path from file_hashes where worktree_id = ? and hash != ''").all(wt.id).map((r) => r.path).filter((p) => !ignored.has(p));
  const names = new Map(); // dir -> set of immediate names the watcher sees
  for (const p of seen) {
    const parts = p.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const set = names.get(dir) ?? new Set();
      set.add(parts[i]);
      names.set(dir, set);
    }
  }
  for (const { project, dir: listed, readers } of listings) {
    const dir = listed === "./" ? "" : listed.slice(0, -1);
    const abs = join(wt.root, dir);
    let disk = null;
    try { disk = statSync(abs).isDirectory() ? readdirSync(abs) : null; } catch { disk = null; }
    const watched = names.get(dir);
    let state, unseen = [];
    if (watched !== undefined && watched.size > 0) {
      unseen = (disk ?? []).filter((n) => !watched.has(n) && !TEMP.test(n));
      state = unseen.length > 0 ? "mixed" : "watched";
    } else if (disk === null) state = "absent";
    else if (disk.length === 0) state = "empty";
    else { state = "unwatched"; unseen = disk; }
    const hash = state === "unwatched" ? createHash("sha1").update([...disk].sort().join("\0")).digest("hex").slice(0, 12)
      : state === "mixed" ? createHash("sha1").update([...unseen].sort().join("\0")).digest("hex").slice(0, 12) : null;
    console.log(JSON.stringify({ worktree: wt.id, version: wt.v, project, dir: listed, state, unseen: unseen.length, unseenSample: unseen.slice(0, 5), hash, readers: readers.length }));
  }
}
