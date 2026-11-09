// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: every (path, blob) of this repository's coverage parts with each distinct
// whole source entry (lines, covered, functions), and the blob's text when git has it.
import { DatabaseSync } from "node:sqlite";
import { constants, inflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [store, repo, out] = process.argv.slice(2) as [string, string, string];
const db = new DatabaseSync(store, { readOnly: true });
const by = new Map<string, { path: string; blob: string; sources: Map<string, unknown> }>();
for (const row of db.prepare("select part from coverage_parts").iterate() as Iterable<{ part: Uint8Array }>) {
  const text = inflateRawSync(row.part, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
  const s = JSON.parse(text) as { path: string; blob: string };
  if (!/\.(m|c)?[jt]sx?$/.test(s.path)) continue;
  const key = `${s.path}\0${s.blob}`;
  let e = by.get(key);
  if (e === undefined) by.set(key, (e = { path: s.path, blob: s.blob, sources: new Map() }));
  e.sources.set(text, s);
}
const items = [...by.values()];
const raw = execFileSync("git", ["cat-file", "--batch"], { cwd: repo, input: items.map((i) => i.blob).join("\n") + "\n", maxBuffer: 1 << 30 });
let at = 0;
const texts = new Map<string, string>();
for (const i of items) {
  const nl = raw.indexOf(10, at);
  const header = raw.subarray(at, nl).toString();
  at = nl + 1;
  if (header.endsWith(" missing")) continue;
  const size = Number(header.split(" ")[2]);
  texts.set(i.blob, raw.subarray(at, at + size).toString("utf8"));
  at += size + 1;
}
const corpus = items.flatMap((i) => {
  const text = texts.get(i.blob);
  return text === undefined ? [] : [{ path: i.path, blob: i.blob, text, sources: [...i.sources.values()] }];
});
writeFileSync(out, JSON.stringify(corpus));
process.stdout.write(`${corpus.length} sources with text, ${corpus.reduce((n, c) => n + c.sources.length, 0)} entries\n`);
