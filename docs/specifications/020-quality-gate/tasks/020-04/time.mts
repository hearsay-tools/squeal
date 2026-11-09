// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: time of joinCoverage, old against new, over the corpus; the slowest files.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { performance } from "node:perf_hooks";

const [worktree, corpusPath] = process.argv.slice(2) as [string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const { joinCoverage } = await import(`${worktree}/src/core/code/crap/join.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; text: string; sources: unknown[] }[];
const work: { path: string; fns: unknown[]; sources: unknown[] }[] = [];
for (const item of corpus) {
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python") continue;
  work.push({ path: item.path, fns: (await countFile(item.text, language)).functions, sources: item.sources });
}
const slow: [number, number, string, number][] = [];
let tOld = 0, tNew = 0;
for (let round = 0; round < 2; round++) {
  tOld = 0; tNew = 0; slow.length = 0;
  for (const w of work) {
    const a = performance.now();
    for (const s of w.sources) old.joinCoverage(w.fns, [s]);
    const b = performance.now();
    for (const s of w.sources) joinCoverage(w.fns, [s]);
    const c = performance.now();
    tOld += b - a; tNew += c - b;
    slow.push([c - b, b - a, w.path, w.fns.length]);
  }
}
slow.sort((x, y) => y[0] - x[0]);
console.log(`old ${tOld.toFixed(0)} ms, new ${tNew.toFixed(0)} ms over ${work.reduce((n, w) => n + w.sources.length, 0)} records`);
for (const [n, o, p, f] of slow.slice(0, 8)) console.log(`${n.toFixed(1)} ms (old ${o.toFixed(1)}) ${p} fns=${f}`);
