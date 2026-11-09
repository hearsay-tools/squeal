// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: joinCoverage old against new, per function and record set.
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const [worktree, corpusPath] = process.argv.slice(2) as [string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const { joinCoverage } = await import(`${worktree}/src/core/code/crap/join.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; blob: string; text: string; sources: unknown[] }[];
const t: Record<string, number> = {};
const bad: string[] = [];
for (const item of corpus) {
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python") continue;
  const count = await countFile(item.text, language);
  // Each record alone, and all records together as one union.
  const sets = [...item.sources.map((s) => [s]), item.sources];
  for (const set of sets) {
    for (const bound of [false, true]) {
      const a = old.joinCoverage(count.functions, set, bound);
      const b = joinCoverage(count.functions, set, bound);
      a.forEach((x: { ran: boolean | null; coverage: number; lines: number; covered: number }, i: number) => {
        const y = b[i];
        const k = `${x.ran}->${y.ran}${x.ran === y.ran && (x.coverage !== y.coverage || x.lines !== y.lines) ? " cov" : ""}`;
        t[k] = (t[k] ?? 0) + 1;
        if ((x.ran === true && y.ran === false) || (x.ran === false && y.ran === true) || (x.ran === y.ran && x.coverage !== y.coverage)) {
          bad.push(`${k} ${item.path} ${count.functions[i].qualifiedName}@${count.functions[i].range.startLine} records=${set.length} bound=${bound}`);
        }
      });
    }
  }
}
console.log(JSON.stringify(t, null, 1));
console.log(bad.join("\n"));
