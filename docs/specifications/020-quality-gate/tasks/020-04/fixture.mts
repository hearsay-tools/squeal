// Run from a worktree with tsx; see notes.md.
// Row 020-04: the regression fixture, from this repository's coverage records, with the join as it
// was before the row (join-old.ts) as the expected value.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const [worktree, corpusPath, out] = process.argv.slice(2) as [string, string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);
type Src = { path: string; blob: string; lines: string; covered: string; functions: [number, number, number, number, 0 | 1][] };
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; blob: string; text: string; sources: Src[] }[];
const special = new Map([
  ["src/core/daemon/policy.ts", "26b7"], ["src/core/reach/analyze.ts", ""], ["test/watcher/parcel-racy.test.ts", ""],
  ["test/lint/provider/starter.test.ts", ""], ["src/cli/code-report.ts", ""], ["src/core/store/repos/replaced.ts", ""],
]);
const hash = (s: string) => createHash("sha1").update(s).digest("hex");
const byPath = new Map<string, (typeof corpus)[number]>();
for (const item of corpus) {
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python" || item.sources.length < 2) continue;
  const prev = byPath.get(item.path);
  if (prev === undefined || prev.sources.length < item.sources.length) byPath.set(item.path, item);
}
const chosen: (typeof corpus)[number][] = [];
for (const path of special.keys()) {
  const item = byPath.get(path) ?? corpus.find((c) => c.path === path);
  if (item !== undefined) chosen.push(item);
}
const rest = [...byPath.values()].filter((i) => !special.has(i.path)).sort((a, b) => hash(a.path).localeCompare(hash(b.path)));
for (const item of rest) {
  if (chosen.length >= 26) break;
  const language = CODE_EXTENSIONS[extname(item.path)];
  const n = (await countFile(item.text, language)).functions.length;
  if (n >= 10 && n <= 60 && item.text.length < 12_000) chosen.push(item);
}
const files = [];
for (const item of chosen) {
  const count = await countFile(item.text, CODE_EXTENSIONS[extname(item.path)]);
  const records = item.sources.slice(0, 3).map(({ path, blob, lines, covered, functions }) => ({ path, blob, lines, covered, functions }));
  const spans = count.functions.map((f: { range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }) => ({
    startLine: f.range.startLine, startColumn: f.range.startColumn - 1, endLine: f.range.endLine, endColumn: f.range.endColumn - 2,
  }));
  const joined = records.map((r) => (old.matchEntries(spans, r.functions) as (unknown[] | null)[]).map((e) => (e === null ? -1 : r.functions.indexOf(e as never))));
  const measure = (set: Src[]) => old.joinCoverage(count.functions, set).map((j: { ran: boolean | null; lines: number; covered: number }) => [j.ran, j.lines, j.covered]);
  files.push({
    path: item.path,
    blob: item.blob,
    names: count.functions.map((f: { qualifiedName: string }) => f.qualifiedName),
    ranges: count.functions.map((f: { range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }) => [f.range.startLine, f.range.startColumn, f.range.endLine, f.range.endColumn]),
    records,
    joined,
    measures: [...records.map((r) => measure([r])), measure(records)],
  });
}
const text = `{"files":[\n${files.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;
writeFileSync(out, text);
process.stdout.write(`${files.length} files, ${files.reduce((n, f) => n + f.records.length, 0)} records, ${files.reduce((n, f) => n + f.names.length, 0)} functions, ${text.length} bytes\n`);
for (const f of files) process.stdout.write(`  ${f.path} ${f.names.length} fns ${f.records.length} records\n`);
