// Throwaway probe for research/quality-gate.md, Q3 and Q4. Not product code.
//
// For each commit range base..head of a repository (read with `git show`
// and `git diff` only, nothing written), counts the JS/TS files the range
// changed at both ends with Squeal's counter (`countFile`, D2 identities)
// and classifies each head function:
//   unchanged  same identity, same body hash at base
//   shifted    same identity, other body hash, but that body is at base under
//              another identity (an occurrence index moved)
//   edited     same identity, other body hash not at base
//   moved      new identity whose body hash a base function of a changed
//              file had (D2's move rule: it takes the old state)
//   added      new identity, body hash not at base
// Test files are the paths that match TEST below (both repositories' runner
// globs reduced to a name rule; a heuristic, stated in the findings).
//
// Usage: node_modules/.bin/tsx changed.mts <squeal src root> <repo> <out.json> <base>..<head>...

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const [squeal, repo, out, ...ranges] = process.argv.slice(2);
if (squeal === undefined || repo === undefined || out === undefined) throw new Error("usage");
const { countFile } = await import(join(squeal, "src/core/code/count/index.ts"));

const JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /(\.test|\.spec|\.e2e)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const show = (rev: string, path: string): string | null => {
  try {
    return git("show", `${rev}:${path}`);
  } catch {
    return null;
  }
};
type Fn = { qualifiedName: string; occurrence: number; bodyHash: string; complexity: number; range: { startLine: number } };
let countMs = 0;
let counted = 0;
const count = async (text: string | null): Promise<Fn[]> => {
  if (text === null || text.length > 524_288) return [];
  const t = performance.now();
  const c = await countFile(text, "typescript");
  countMs += performance.now() - t;
  counted++;
  return c.functions;
};

const results = [];
for (const range of ranges) {
  const [base, head] = range.split("..") as [string, string];
  const status = git("diff", "--name-status", "-M", "--no-renames", base, head)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string]);
  const files = status.filter(([, p]) => JS.test(p) && !p.includes("node_modules/") && !p.includes("/dist/"));
  const baseHashes = new Map<string, number>();
  const byFile: { path: string; base: Fn[]; head: Fn[] }[] = [];
  for (const [, path] of files) {
    const b = await count(show(base, path));
    const h = await count(show(head, path));
    for (const f of b) baseHashes.set(f.bodyHash, (baseHashes.get(f.bodyHash) ?? 0) + 1);
    byFile.push({ path, base: b, head: h });
  }
  // shifted: same identity, other body hash, but the body is at base under another identity
  // (an occurrence index moved because a same-named function was added or removed before it).
  const tally = { unchanged: 0, shifted: 0, edited: 0, moved: 0, added: 0 };
  const shifted: { path: string; name: string; line: number }[] = [];
  const changed: { path: string; name: string; line: number; cc: number; kind: string; test: boolean }[] = [];
  for (const { path, base: b, head: h } of byFile) {
    const id = (f: Fn) => `${f.qualifiedName}#${f.occurrence}`;
    const before = new Map(b.map((f) => [id(f), f]));
    for (const f of h) {
      const old = before.get(id(f));
      const kind =
        old === undefined
          ? baseHashes.has(f.bodyHash)
            ? "moved"
            : "added"
          : old.bodyHash === f.bodyHash
            ? "unchanged"
            : baseHashes.has(f.bodyHash)
              ? "shifted"
              : "edited";
      tally[kind as keyof typeof tally]++;
      if (kind === "shifted") shifted.push({ path, name: f.qualifiedName, line: f.range.startLine });
      if (kind === "edited" || kind === "added") {
        changed.push({ path, name: f.qualifiedName, line: f.range.startLine, cc: f.complexity, kind, test: TEST.test(path) });
      }
    }
  }
  results.push({
    range,
    files: files.length,
    testFiles: files.filter(([, p]) => TEST.test(p)).length,
    tally,
    changed: changed.length,
    changedInTests: changed.filter((c) => c.test).length,
    over20: changed.filter((c) => c.cc > 20),
    shifted,
    changedFunctions: changed,
  });
}
writeFileSync(out, `${JSON.stringify({ countMs: Math.round(countMs), counted, results }, null, 2)}\n`);
for (const r of results) {
  process.stdout.write(
    `${r.range} files ${r.files} (tests ${r.testFiles}) ${JSON.stringify(r.tally)} changed ${r.changed} (in tests ${r.changedInTests}) over20 ${r.over20.length}\n`,
  );
}
process.stdout.write(`counted ${counted} file versions in ${Math.round(countMs)} ms\n`);
