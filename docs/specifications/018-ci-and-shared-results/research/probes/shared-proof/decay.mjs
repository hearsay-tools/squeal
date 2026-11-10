// Throwaway (018-21). How many files of a CI export stay current at a later
// main commit, by the rule D11 keys them with: a file matches at commit T
// when every path of its exported closure and observed sets has the same
// git blob at T as at the export's commit E (absent at both counts as same),
// and every listed directory (a path ending in "/") has the same entry
// names. Assumes equal environments and a fresh store (this worktree's
// closure equals the export's), as in count.sh's clones after a restart.
// Validated against one measured point (see ../../shared-proof.md, Q2).
//
// Usage: node decay.mjs <clone> <export.json>... (each export's header names E)
// Prints one line per (E, T) for every first-parent main commit T after E.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [clone, ...exports] = process.argv.slice(2);
const git = (...args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const trees = new Map();
function tree(commit) {
  let t = trees.get(commit);
  if (t) return t;
  const blobs = new Map();
  const names = new Map();
  for (const line of git("ls-tree", "-r", commit).trim().split("\n")) {
    const [meta, path] = line.split("\t");
    blobs.set(path, meta.split(" ")[2]);
    let dir = "";
    for (const name of path.split("/")) {
      if (!names.has(dir)) names.set(dir, new Set());
      names.get(dir).add(name);
      dir = dir === "" ? name : `${dir}/${name}`;
    }
  }
  t = { blobs, names };
  trees.set(commit, t);
  return t;
}
const segment = (t, path) => {
  if (!path.endsWith("/")) return t.blobs.get(path) ?? "absent";
  const held = t.names.get(path.slice(0, -1));
  return held === undefined ? "absent" : [...held].sort().join("\0");
};
const line = git("log", "--first-parent", "--format=%H", "origin/main").trim().split("\n");
for (const file of exports) {
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  const e = bundle.header.commit;
  const at = line.indexOf(e);
  if (at < 0) { console.log(`${e.slice(0, 8)} not on origin/main's first-parent line`); continue; }
  const te = tree(e);
  for (let i = at - 1; i >= 0; i--) {
    const t = line[i];
    const tt = tree(t);
    let current = 0;
    for (const f of bundle.testFiles) {
      const paths = new Set([...(f.closure?.paths ?? []), ...Object.values(f.observed ?? {}).flat()]);
      paths.add(f.path);
      let same = true;
      for (const p of paths) if (segment(te, p) !== segment(tt, p)) { same = false; break; }
      if (same) current++;
    }
    const n = bundle.testFiles.length;
    console.log(`export ${e.slice(0, 8)} -> ${t.slice(0, 8)} (${at - i} commit${at - i === 1 ? "" : "s"} later): ${current}/${n} current (${((100 * current) / n).toFixed(1)}%)`);
  }
}
