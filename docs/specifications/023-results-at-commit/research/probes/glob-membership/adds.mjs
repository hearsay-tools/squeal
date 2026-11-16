// Throwaway (glob-membership, Q3/Q4): over first-parent main commits since
// <since>, how many add or delete a file (renames split, --no-renames)
//  - at all;
//  - in a directory that holds a module of some stored closure list
//    (what a listing entry per imported directory would re-key);
//  - beside a closure module with the same stem and another extension, or as
//    `<dir>/index.*` for an imported `<dir>` (the shadowing input).
// Closure lists come from the scratch copy (copy.mjs); git read with log only.
// Usage: node adds.mjs <scratch.sqlite> <repo> <ref> <since> <out.json>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, repo, ref, since, out] = process.argv.slice(2);
const db = new DatabaseSync(scratch, { readOnly: true });
const modules = new Set();
for (const r of db.prepare("select closure_paths from test_files").all())
  for (const p of JSON.parse(r.closure_paths)) if (!p.endsWith("/")) modules.add(p);
const dirs = new Set([...modules].map((p) => posix.dirname(p)));
const stems = new Map();
for (const p of modules) {
  const ext = posix.extname(p);
  stems.set(p.slice(0, p.length - ext.length), p);
}
const log = execFileSync("git", ["-C", repo, "log", "--first-parent", "--no-renames", `--since=${since}`,
  "--format=@%H", "--name-status", ref], { encoding: "utf8", maxBuffer: 1 << 30 });
const commits = [];
let cur = null;
for (const line of log.split("\n")) {
  if (line.startsWith("@")) { cur = { sha: line.slice(1, 10), changes: [] }; commits.push(cur); continue; }
  const m = /^([AD])\t(.*)$/.exec(line);
  if (m && cur) cur.changes.push({ status: m[1], path: m[2] });
}
const res = { commits: commits.length, anyAddDelete: 0, inClosureDir: 0, shadowing: 0, shadowExamples: [] };
for (const c of commits) {
  if (c.changes.length > 0) res.anyAddDelete++;
  if (c.changes.some((x) => dirs.has(posix.dirname(x.path)))) res.inClosureDir++;
  const shadow = c.changes.filter((x) => {
    if (modules.has(x.path)) return false;
    const ext = posix.extname(x.path);
    if (!/^\.(m|c)?[jt]sx?$/.test(ext)) return false;
    const stem = x.path.slice(0, x.path.length - ext.length);
    const twin = stems.get(stem);
    if (twin !== undefined && twin !== x.path) return true;
    const base = posix.basename(stem);
    return base === "index" && stems.has(posix.dirname(stem));
  });
  if (shadow.length > 0) {
    res.shadowing++;
    if (res.shadowExamples.length < 10) res.shadowExamples.push({ sha: c.sha, paths: shadow.map((s) => `${s.status} ${s.path}`).slice(0, 4) });
  }
}
res.share = {
  anyAddDelete: +(res.anyAddDelete / res.commits * 100).toFixed(1),
  inClosureDir: +(res.inClosureDir / res.commits * 100).toFixed(1),
  shadowing: +(res.shadowing / res.commits * 100).toFixed(2),
};
writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
