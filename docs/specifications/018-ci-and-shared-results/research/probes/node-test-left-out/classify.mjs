// Throwaway probe (row 018-55). Classifies each left-out (node:test file, input) pair.
// Usage: node classify.mjs <uncertified.json> <checkout> <part-dir>... > pairs.json
// <uncertified.json>: what the patched 0.1.579 `ci export` wrote (README.md).
// Each part dir is read for *.json parts (not recursive).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const [uncertifiedFile, checkout, ...dirs] = process.argv.slice(2);
const uncertified = JSON.parse(readFileSync(uncertifiedFile, "utf8"));

const parts = [];
for (const dir of dirs)
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const part = JSON.parse(readFileSync(join(dir, name), "utf8"));
    parts.push({ label: `${dir.split("/").slice(-1)[0]}/${name.slice(12, 20)}`, runner: part.header.runner, part });
  }
const owner = new Map();
for (const p of parts) for (const f of p.part.testFiles) owner.set(f.path, { p, f });

const tree = new Map();
const ls = execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], { cwd: checkout, maxBuffer: 1 << 30 }).toString();
for (const entry of ls.split("\0")) {
  if (!entry) continue;
  const [meta, path] = entry.split("\t");
  tree.set(path, meta.split(" ")[2]);
}
function here(path) {
  if (path.endsWith("/")) return { kind: "listing" };
  if (tree.has(path)) return { kind: "tracked", hash: tree.get(path) };
  const abs = join(checkout, path);
  if (existsSync(abs)) {
    if (statSync(abs).isDirectory()) return { kind: "directory" };
    return { kind: "untracked", hash: execFileSync("git", ["hash-object", path], { cwd: checkout }).toString().trim() };
  }
  return { kind: "missing", hash: null };
}

const pairs = [];
for (const { testFile, inputs } of uncertified) {
  if (process.env.ONLY_VITEST ? ["test:unit", "root:test:unit"].includes(testFile.project) : !["test:unit", "root:test:unit"].includes(testFile.project)) continue;
  const { p, f } = owner.get(testFile.path);
  const obs = f.observed ?? {};
  for (const input of inputs) {
    const h = here(input);
    const own = Object.hasOwn(p.part.evidence, input) ? p.part.evidence[input] : undefined;
    const others = parts.filter((q) => q !== p && Object.hasOwn(q.part.evidence, input));
    pairs.push({
      project: testFile.project,
      testFile: testFile.path,
      part: p.label,
      input,
      here: h,
      own: own === undefined ? "absent" : own === (h.hash ?? null) ? "equal" : "differs",
      ownValue: own,
      inObservedPaths: (obs.paths ?? []).includes(input),
      inObservedDirectories: (obs.directories ?? []).includes(input),
      inDirect: (obs.direct ?? []).includes(input),
      othersEqual: others.filter((q) => q.part.evidence[input] === (h.hash ?? null)).map((q) => q.label),
      othersDiffer: others.filter((q) => q.part.evidence[input] !== (h.hash ?? null)).map((q) => q.label),
    });
  }
}
process.stdout.write(JSON.stringify(pairs));
