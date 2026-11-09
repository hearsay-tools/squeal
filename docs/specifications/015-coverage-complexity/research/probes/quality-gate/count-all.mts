// Throwaway probe for research/quality-gate.md, Q3. Not product code.
//
// Counts every JS/TS file at a commit of a repository (read through
// `git ls-tree` and `git cat-file --batch`, nothing written) with Squeal's
// counter, and splits the totals into test files and other files by the
// name rule of changed.mts. Files over 512 KiB, under node_modules or dist,
// and under fixtures/ are left out (D1's defaults and runner listings).
//
// Usage: node_modules/.bin/tsx count-all.mts <squeal src root> <repo> <rev> <out.json>

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const [squeal, repo, rev, out] = process.argv.slice(2) as [string, string, string, string];
const { countFile } = await import(join(squeal, "src/core/code/count/index.ts"));
const JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /(\.test|\.spec|\.e2e)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|dist|build|vendor|fixtures)\//;

const tree = execFileSync("git", ["-C", repo, "ls-tree", "-r", "-l", rev], { encoding: "utf8", maxBuffer: 1 << 28 })
  .trim()
  .split("\n")
  .map((l) => {
    const [meta, path] = l.split("\t") as [string, string];
    const [, type, oid, size] = meta.split(/\s+/) as [string, string, string, string];
    return { type, oid, size: Number(size), path };
  })
  .filter((e) => e.type === "blob" && JS.test(e.path) && !SKIP.test(e.path) && !e.path.endsWith(".min.js") && e.size <= 524_288 && !e.path.endsWith(".d.ts"));

const input = tree.map((e) => e.oid).join("\n") + "\n";
const batch = execFileSync("git", ["-C", repo, "cat-file", "--batch"], { input, maxBuffer: 1 << 30 });
let at = 0;
const texts: string[] = [];
for (const _ of tree) {
  const nl = batch.indexOf(10, at);
  const header = batch.subarray(at, nl).toString();
  const size = Number(header.split(" ")[2]);
  texts.push(batch.subarray(nl + 1, nl + 1 + size).toString("utf8"));
  at = nl + 1 + size + 1;
}

const sum = { test: { files: 0, functions: 0, over20: 0, ms: 0 }, other: { files: 0, functions: 0, over20: 0, ms: 0 } };
const testOver: { path: string; name: string; cc: number }[] = [];
for (let i = 0; i < tree.length; i++) {
  const e = tree[i]!;
  const kind = TEST.test(e.path) ? "test" : "other";
  const t = performance.now();
  const c = await countFile(texts[i]!, "typescript");
  sum[kind].ms += performance.now() - t;
  sum[kind].files++;
  sum[kind].functions += c.functions.length;
  for (const f of c.functions as { qualifiedName: string; complexity: number }[]) {
    if (f.complexity > 20) {
      sum[kind].over20++;
      if (kind === "test") testOver.push({ path: e.path, name: f.qualifiedName, cc: f.complexity });
    }
  }
}
for (const k of ["test", "other"] as const) sum[k].ms = Math.round(sum[k].ms);
writeFileSync(out, `${JSON.stringify({ repo, rev, sum, testOver }, null, 2)}\n`);
process.stdout.write(`${repo} ${rev} ${JSON.stringify(sum)}\n`);
