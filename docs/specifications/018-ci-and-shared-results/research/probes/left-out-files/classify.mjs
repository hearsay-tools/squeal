// Throwaway probe (row 018-40). Classifies each left-out (test file, input) pair.
// Usage: node classify.mjs <uncertified.json> <parts-dir-glob-root> <squawk-checkout> > pairs.json
// <uncertified.json>: what the patched 0.1.443 `ci export` wrote (see README.md).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [uncertifiedFile, partsRoot, checkout] = process.argv.slice(2);
const uncertified = JSON.parse(readFileSync(uncertifiedFile, "utf8"));

const parts = [];
for (const dir of readdirSync(partsRoot).filter((d) => d.startsWith("squeal-parts-shard-")).sort()) {
  for (const name of readdirSync(join(partsRoot, dir)).filter((n) => n.endsWith(".json"))) {
    const part = JSON.parse(readFileSync(join(partsRoot, dir, name), "utf8"));
    parts.push({ shard: dir.replace("squeal-parts-", ""), part });
  }
}
const owner = new Map();
for (const p of parts) for (const f of p.part.testFiles) owner.set(`${f.project}:${f.path}`, { p, f });

// Blobs of tracked files at the checkout's HEAD.
const tree = new Map();
const ls = execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], { cwd: checkout, maxBuffer: 1 << 30 }).toString();
for (const entry of ls.split("\0")) {
  if (!entry) continue;
  const [meta, path] = entry.split("\t");
  tree.set(path, meta.split(" ")[2]);
}
function here(path) {
  if (path.endsWith("/")) return { kind: "listing" };
  if (path === ".git") return { kind: "git-entry" };
  if (tree.has(path)) return { kind: "tracked", hash: tree.get(path) };
  if (existsSync(join(checkout, path)))
    return { kind: "untracked", hash: execFileSync("git", ["hash-object", path], { cwd: checkout }).toString().trim() };
  return { kind: "missing", hash: null };
}

const pairs = [];
for (const { testFile, inputs } of uncertified) {
  const id = `${testFile.project}:${testFile.path}`;
  const { p, f } = owner.get(id);
  const obs = f.observed ?? {};
  const read = new Set([...(obs.paths ?? []), ...(obs.modules ?? [])]);
  for (const input of inputs) {
    const h = here(input);
    const own = Object.hasOwn(p.part.evidence, input) ? p.part.evidence[input] : undefined;
    const others = parts
      .filter((q) => q !== p && Object.hasOwn(q.part.evidence, input))
      .map((q) => ({ shard: q.shard, value: q.part.evidence[input] }));
    pairs.push({
      testFile: id,
      shard: p.shard,
      input,
      here: h,
      own: own === undefined ? "absent" : own === h.hash ? "equal" : "differs",
      ownValue: own,
      readByFile: read.has(input),
      inWritten: (obs.written ?? []).some((w) => input === w || input.startsWith(`${w}/`)),
      othersEqual: others.filter((o) => o.value === h.hash).map((o) => o.shard),
      othersDiffer: others.filter((o) => o.value !== h.hash).map((o) => o.shard),
    });
  }
}
process.stdout.write(JSON.stringify(pairs));
