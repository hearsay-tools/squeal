// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: the current join against the worktree's join, over the corpus.
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const [worktree, corpusPath, out] = process.argv.slice(2) as [string, string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const { joinedEntries } = await import(`${worktree}/src/core/code/crap/match.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);

type Entry = [number, number, number, number, 0 | 1];
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; blob: string; text: string; lists: Entry[][] }[];
const key = (e: Entry | null) => (e === null ? "null" : e.slice(0, 4).join(","));
const stats = { files: 0, lists: 0, functions: 0, same: 0, gained: 0, lost: 0, moved: 0, nullBoth: 0 };
const diffs: unknown[] = [];
for (const item of corpus) {
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python") continue;
  const count = await countFile(item.text, language);
  stats.files++;
  const spans = count.functions.map((f: { range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }) => ({
    startLine: f.range.startLine, startColumn: f.range.startColumn - 1, endLine: f.range.endLine, endColumn: f.range.endColumn - 2,
  }));
  for (const list of item.lists) {
    stats.lists++;
    const a = old.matchEntries(spans, list) as (Entry | null)[];
    const b = joinedEntries(count.functions, list) as (Entry | null)[];
    count.functions.forEach((f: { qualifiedName: string; range: unknown }, i: number) => {
      stats.functions++;
      const ka = key(a[i] ?? null);
      const kb = key(b[i] ?? null);
      if (ka === kb) return void (ka === "null" ? stats.nullBoth++ : stats.same++);
      const kind = ka === "null" ? "gained" : kb === "null" ? "lost" : "moved";
      stats[kind]++;
      if (kind !== "gained" || diffs.length < 2000) diffs.push({ kind, path: item.path, blob: item.blob, fn: f.qualifiedName, range: f.range, old: a[i], new: b[i], line: item.text.split("\n")[(f.range as { startLine: number }).startLine - 1] });
    });
  }
}
writeFileSync(out, JSON.stringify({ stats, diffs }, null, 1));
process.stdout.write(`${JSON.stringify(stats)}\n`);
