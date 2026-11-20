// Throwaway probe (row 018-58, notes.md). Rewrites real format 3-5 parts as format 6 parts, as
// row 018-57's `ci record` would have written them if the shard's checkout had equalled
// <checkout> at both ends of its command (the assumption of unread-inputs.md 1 and 3):
//   stable    every listing path whose names on disk in <checkout> differ from the commit tree's
//   unstable  []
//   touched   with --touched observed: per part, every file path a file of it observed or loaded
//             (paths, direct, loaded) that its evidence lacks, a lower bound, since readRecorded
//             drops written and conflicting paths but natively read modules lack evidence too;
//             with --touched none: [], as the research's re-record of shard 3 found (0 writes,
//             0 conflicting reads)
// Usage: node as-format6.mjs --touched <observed|none> <checkout> <out-dir> <part-dir>...
//        (reads <checkout> and the parts, writes <out-dir>)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [flag, mode, checkout, out, ...dirs] = process.argv.slice(2);
if (flag !== "--touched" || (mode !== "observed" && mode !== "none")) throw new Error("usage: --touched <observed|none> <checkout> <out-dir> <part-dir>...");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const namesHash = (names) => createHash("sha1").update([...names].sort(cmp).join("\0")).digest("hex");
const listingPath = (d) => (d === "" ? "./" : `${d}/`);

const ls = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], { cwd: checkout, maxBuffer: 1 << 30 }).toString();
const names = new Map();
for (const entry of ls.split("\0")) {
  if (!entry) continue;
  let child = entry.slice(entry.indexOf("\t") + 1);
  for (;;) {
    const slash = child.lastIndexOf("/");
    const dir = slash < 0 ? "" : child.slice(0, slash);
    const set = names.get(dir) ?? new Set();
    set.add(child.slice(slash + 1));
    names.set(dir, set);
    if (dir === "") break;
    child = dir;
  }
}
const stable = {};
for (const [dir, held] of names) {
  const disk = namesHash(readdirSync(join(checkout, dir)));
  if (disk !== namesHash(held)) stable[listingPath(dir)] = disk;
}
console.error(`${names.size} directories in the tree; ${Object.keys(stable).length} listings differ on disk`);

let parts = 0, touchedPaths = 0;
for (const dir of dirs) {
  const target = join(out, basename(dir));
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const part = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const touched = new Set();
    for (const f of mode === "none" ? [] : part.testFiles) {
      const o = f.observed ?? {};
      const seen = [...(o.paths ?? []), ...(o.direct ?? []), ...(f.loaded ?? [])];  // a listing read is no touch (D31: listed and later changed); 0.1.522 wrote some listing evidence as "dir//"
      for (const path of seen) if (!Object.hasOwn(part.evidence, path)) touched.add(path);
    }
    touchedPaths += touched.size;
    parts += 1;
    const six = { ...part, format: "squeal-ci-part/6", stable, unstable: [], touched: [...touched].sort(cmp) };
    writeFileSync(join(target, name), `${JSON.stringify(six)}\n`);
  }
}
console.error(`${parts} parts rewritten; ${touchedPaths} touched paths in all`);
