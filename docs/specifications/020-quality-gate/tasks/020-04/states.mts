// Run from a worktree with tsx; see notes.md.
// Row 020-04: the daemon's crap and uncovered outcomes, old join against new, for the sources at
// this tree's HEAD blobs, judged from every stored record of that blob (as the daemon unions loaders).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const [worktree, corpusPath] = process.argv.slice(2) as [string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const { joinCoverage } = await import(`${worktree}/src/core/code/crap/join.ts`);
const { crapScore } = await import(`${worktree}/src/core/code/crap/score.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);
const head = new Map(
  execFileSync("git", ["ls-tree", "-r", "HEAD", "--", "src", "test"], { cwd: worktree, encoding: "utf8", maxBuffer: 1 << 28 })
    .trim().split("\n").map((l) => { const [meta, path] = l.split("\t"); return [path, meta.split(" ")[2]] as const; }),
);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; blob: string; text: string; sources: unknown[] }[];
const outcome = (cc: number, j: { ran: boolean | null; coverage: number; runBy: number[] }) =>
  j.ran === null ? ["unknown", "unknown"] : [crapScore(cc, j.coverage) > 30 ? "fail" : "pass", j.runBy.length === 0 ? "fail" : "pass"];
const t: Record<string, number> = {};
const flips: string[] = [];
let files = 0;
for (const item of corpus) {
  if (head.get(item.path) !== item.blob) continue;
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python") continue;
  files++;
  const testFile = /(^|\/)test\/|\.test\.[cm]?[jt]sx?$/.test(item.path);
  const count = await countFile(item.text, language);
  const a = old.joinCoverage(count.functions, item.sources);
  const b = joinCoverage(count.functions, item.sources);
  count.functions.forEach((f: { qualifiedName: string; complexity: number }, i: number) => {
    const oa = outcome(f.complexity, a[i]);
    const ob = outcome(f.complexity, b[i]);
    ["crap", "uncovered"].forEach((m, k) => {
      const key = `${testFile ? "test" : "src"} ${m} ${oa[k]}->${ob[k]}`;
      t[key] = (t[key] ?? 0) + 1;
      if (oa[k] !== ob[k] && oa[k] !== "unknown" && ob[k] !== "unknown") flips.push(`${key} ${item.path} ${f.qualifiedName}`);
    });
  });
}
console.log(`${files} files at HEAD blobs`);
console.log(Object.entries(t).filter(([k]) => !/(\w+)->\1$/.test(k.split(" ")[2])).sort().map(([k, n]) => `${k}: ${n}`).join("\n"));
console.log(flips.join("\n"));
