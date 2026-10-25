// Throwaway (016-19). Reads the kind-tagged recorder output of one run and keeps, per
// test file, what `observedInputs` (src/runners/observe/inputs.ts) keeps: project paths
// outside node_modules and .git, minus what that test file wrote, plain directories
// dropped from the file kinds, listings kept. Then asks `git check-ignore -z --stdin`
// (the batch `checkIgnored` uses; listings by their directory) which are ignored.
// The closure is not subtracted: this is the upper bound of what (b) would track.
// Only the run's own test files count (`completed`), from <files.txt>, one relative path a line;
// inner runs' fixture test files are recorded too and dropped here, as the daemon drops them.
// Usage: node analyze.mjs <root> <run-out-dir> <result.json> <files.txt>
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const [root, outDir, resultFile, filesList] = process.argv.slice(2);
const runFiles = new Set(readFileSync(filesList, "utf8").split("\n").filter(Boolean));
const KINDS = ["load", "read", "stat", "exec", "l"];
const byTest = new Map();
const recDir = join(outDir, "rec");
for (const name of readdirSync(recDir).filter((n) => n.endsWith(".ndjson"))) {
  for (const line of readFileSync(join(recDir, name), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let v;
    try { v = JSON.parse(line); } catch { continue; }
    if (typeof v.t !== "string") continue;
    let e = byTest.get(v.t);
    if (!e) byTest.set(v.t, (e = Object.fromEntries([...KINDS, "f", "w"].map((k) => [k, new Set()]))));
    for (const k of [...KINDS, "f", "w"]) for (const p of v[k] ?? []) if (!p.includes("\0")) e[k].add(p);
  }
}
const prefix = root.endsWith(sep) ? root : root + sep;
const isProject = (abs) => abs.startsWith(prefix) && !abs.includes(`${sep}node_modules${sep}`);
const dirCache = new Map();
const isDir = (abs) => {
  if (!dirCache.has(abs)) dirCache.set(abs, statSync(abs, { throwIfNoEntry: false })?.isDirectory() === true);
  return dirCache.get(abs);
};
const kept = new Map(); // test -> kind -> Set(rel)
const all = new Set();
for (const [t, e] of byTest) {
  if (!runFiles.has(relative(root, t))) continue;
  const per = {};
  for (const k of KINDS) {
    per[k] = new Set();
    for (const abs of e[k]) {
      if (e.w.has(abs) || !isProject(abs)) continue;
      if (k !== "l" && isDir(abs) && abs !== join(root, ".git")) continue;
      const rel = relative(root, abs);
      per[k].add(rel);
      all.add(rel);
    }
  }
  per.written = new Set([...e.w].filter(isProject).map((abs) => relative(root, abs)));
  kept.set(relative(root, t), per);
}
const list = [...all].filter((p) => p !== "");
let ignored = new Set();
if (list.length) {
  const outp = execFileSync("git", ["check-ignore", "-z", "--stdin"], {
    cwd: root, input: `${list.join("\0")}\0`, maxBuffer: 1 << 28,
    // exit 1 = none ignored
  }).toString();
  ignored = new Set(outp.split("\0").filter(Boolean));
}
const top = (p) => p.split("/").slice(0, p.startsWith("packages/") ? 3 : 1).join("/");
const result = { root, recordedKeys: byTest.size, tests: kept.size, runFiles: runFiles.size, keptPaths: all.size, ignoredPaths: ignored.size,
  byKind: {}, byTop: {}, perTest: {}, existsNow: 0 };
const kindSets = Object.fromEntries(KINDS.map((k) => [k, new Set()]));
const counts = [];
for (const [t, per] of kept) {
  const mine = {};
  let n = new Set();
  for (const k of KINDS) {
    const ig = [...per[k]].filter((p) => ignored.has(p)).sort();
    if (ig.length) mine[k] = ig;
    for (const p of ig) { kindSets[k].add(p); n.add(p); }
  }
  counts.push([...n].filter((p) => !per.l.has(p) || ["load", "read", "stat", "exec"].some((k) => per[k].has(p))).length);
  if (n.size) result.perTest[t] = mine;
}
for (const k of KINDS) result.byKind[k] = kindSets[k].size;
// A file path becomes an extra file under (b); a listing is keyed by its entry names, never tracked.
const files = new Set(["load", "read", "stat", "exec"].flatMap((k) => [...kindSets[k]]));
result.ignoredFiles = files.size;
result.ignoredListings = kindSets.l.size;
for (const p of files) result.byTop[top(p)] = (result.byTop[top(p)] ?? 0) + 1;
for (const p of files) if (existsSync(join(root, p))) result.existsNow++;
result.files = [...files].sort();
result.listings = [...kindSets.l].sort();
counts.sort((a, b) => a - b);
result.testsWithIgnored = counts.filter((c) => c > 0).length;
result.perTestMax = counts.at(-1) ?? 0;
result.perTestMedianAmongThose = (() => { const c = counts.filter((x) => x > 0); return c[Math.floor(c.length / 2)] ?? 0; })();
result.ignored = [...ignored].sort();
// Q4 bounds: what each keeps of the ignored file paths (distinct paths over all test files).
const FILE_KINDS = ["load", "read", "stat", "exec"];
const RANDOM = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-[A-Za-z0-9]{6}(\/|$)/;
const keep = { loadOnly: new Set(), existsAfterRun: new Set(), notUnderWrittenDir: new Set(), noRandomSegment: new Set() };
const capped = { 10: new Set(), 100: new Set() };
for (const [, per] of kept) {
  const mine = [...new Set(FILE_KINDS.flatMap((k) => [...per[k]]))].filter((p) => ignored.has(p)).sort();
  const underWritten = (p) => { for (let at = p.lastIndexOf("/"); at > 0; at = p.lastIndexOf("/", at - 1)) if (per.written.has(p.slice(0, at))) return true; return false; };
  for (const p of mine) {
    if (per.load.has(p)) keep.loadOnly.add(p);
    if (existsSync(join(root, p))) keep.existsAfterRun.add(p);
    if (!underWritten(p)) keep.notUnderWrittenDir.add(p);
    if (!RANDOM.test(p)) keep.noRandomSegment.add(p);
  }
  for (const n of Object.keys(capped)) if (mine.length <= Number(n)) for (const p of mine) capped[n].add(p);
}
result.bounds = Object.fromEntries([...Object.entries(keep), ...Object.entries(capped).map(([n, v]) => [`testsAtOrBelowCap${n}`, v])]
  .map(([k, v]) => [k, { kept: v.size, sample: [...v].slice(0, 5), all: [...v].sort() }]));
writeFileSync(resultFile, JSON.stringify(result, null, 1));
const { perTest, ignored: _, files: _f, listings: _l, bounds, ...summary } = result;
summary.bounds = Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, v.kept]));
console.log(JSON.stringify(summary, null, 1));
