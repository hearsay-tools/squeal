// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: every join the start rule adds, with the text between the record's end
// and the counted end, classified.
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const [worktree, corpusPath, out] = process.argv.slice(2) as [string, string, string];
const { countFile } = await import(`${worktree}/src/core/code/count/index.ts`);
const { CODE_EXTENSIONS } = await import(`${worktree}/src/core/types/code.ts`);
const { joinedEntries } = await import(`${worktree}/src/core/code/crap/match.ts`);
const old = await import(`${import.meta.dirname}/join-old.ts`);
type Entry = [number, number, number, number, 0 | 1];
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { path: string; blob: string; text: string; lists: Entry[][] }[];
const classes = new Map<string, { n: number; distinct: Set<string>; examples: unknown[] }>();
let gained = 0;
for (const item of corpus) {
  const language = CODE_EXTENSIONS[extname(item.path)];
  if (language === undefined || language === "python") continue;
  const count = await countFile(item.text, language);
  const lines = item.text.split("\n");
  const spans = count.functions.map((f: { range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }) => ({
    startLine: f.range.startLine, startColumn: f.range.startColumn - 1, endLine: f.range.endLine, endColumn: f.range.endColumn - 2,
  }));
  for (const list of item.lists) {
    const a = old.matchEntries(spans, list) as (Entry | null)[];
    const b = joinedEntries(count.functions, list) as (Entry | null)[];
    count.functions.forEach((f: { qualifiedName: string; range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }, i: number) => {
      const e = b[i];
      if (a[i] !== null || e === null || e === undefined) return;
      gained++;
      const line = lines[f.range.endLine - 1] ?? "";
      const tail = line.slice(e[3], f.range.endColumn - 1);
      const head = (lines[e[0] - 1] ?? "").slice(e[1], e[0] === f.range.startLine ? f.range.startColumn - 1 : undefined);
      const cls =
        /^[\w$]+$/.test(tail) ? "identifier/number" :
        /^(["'`]).*\1$/.test(tail) ? "string" :
        /^[\w$]+\)*$/.test(tail) ? "token+parens" :
        /^[\w$]+(\s+as\s+.+|\s+satisfies\s+.+|!)\)*$/.test(tail) ? "token+type" :
        /^(["'`]).*\1\)*$/.test(tail) ? "string+parens" :
        "other";
      const id = `${item.path}|${f.qualifiedName}|${f.range.startLine}`;
      let c = classes.get(cls);
      if (c === undefined) classes.set(cls, (c = { n: 0, distinct: new Set(), examples: [] }));
      c.n++;
      if (!c.distinct.has(id) && c.examples.length < 400) c.examples.push({ id, tail, head, entry: e, range: f.range, text: line.trim().slice(0, 120) });
      c.distinct.add(id);
    });
  }
}
const summary = Object.fromEntries([...classes].map(([k, v]) => [k, { joins: v.n, functions: v.distinct.size }]));
writeFileSync(out, JSON.stringify({ gained, summary, examples: Object.fromEntries([...classes].map(([k, v]) => [k, v.examples])) }, null, 1));
process.stdout.write(`${gained} ${JSON.stringify(summary)}\n`);
