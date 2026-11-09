// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: within one (path, blob), does a V8 span join one function in every record?
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const [worktree, corpusPath] = process.argv.slice(2) as [string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const { joinedEntries } = await import(`${worktree}/src/core/code/crap/match.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);
type Entry = [number, number, number, number, 0 | 1];
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; blob: string; text: string; lists: Entry[][] }[];
const tally = { old: { spanTwoFns: 0, fnTwoSpans: 0 }, new: { spanTwoFns: 0, fnTwoSpans: 0 } };
const examples: string[] = [];
for (const item of corpus) {
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python" || item.lists.length < 2) continue;
  const count = await countFile(item.text, language);
  const spans = count.functions.map((f: { range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }) => ({
    startLine: f.range.startLine, startColumn: f.range.startColumn - 1, endLine: f.range.endLine, endColumn: f.range.endColumn - 2,
  }));
  for (const which of ["old", "new"] as const) {
    const bySpan = new Map<string, Set<number>>();
    const byFn = new Map<number, Set<string>>();
    for (const list of item.lists) {
      const joined = (which === "old" ? old.matchEntries(spans, list) : joinedEntries(count.functions, list)) as (Entry | null)[];
      joined.forEach((e, i) => {
        if (e === null) return;
        const k = e.slice(0, 4).join(",");
        (bySpan.get(k) ?? bySpan.set(k, new Set()).get(k)!).add(i);
        (byFn.get(i) ?? byFn.set(i, new Set()).get(i)!).add(k);
      });
    }
    for (const [k, fns] of bySpan) if (fns.size > 1) {
      tally[which].spanTwoFns++;
      if (which === "new" && examples.length < 30) examples.push(`${item.path} span ${k} -> ${[...fns].map((i) => count.functions[i].qualifiedName + "@" + count.functions[i].range.startLine + ":" + count.functions[i].range.startColumn).join(" / ")}`);
    }
    for (const [, ks] of byFn) if (ks.size > 1) tally[which].fnTwoSpans++;
  }
}
console.log(JSON.stringify(tally));
console.log(examples.join("\n"));
