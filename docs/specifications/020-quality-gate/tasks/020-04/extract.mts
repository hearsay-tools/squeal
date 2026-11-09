// Run from a worktree with tsx; see notes.md.
// Survey for row 020-04: every (path, blob) of this repository's coverage records with the
// distinct V8 function lists seen for it, and the blob's text when git has it.
import { DatabaseSync } from "node:sqlite";
import { constants, inflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [store, repo, out] = process.argv.slice(2) as [string, string, string];
const db = new DatabaseSync(store, { readOnly: true });
const by = new Map<string, { path: string; blob: string; lists: Set<string>; tests: number }>();
for (const row of db.prepare("select part from coverage_parts").iterate() as Iterable<{ part: Uint8Array }>) {
  const s = JSON.parse(inflateRawSync(row.part, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")) as { path: string; blob: string; functions: unknown[] };
  if (!/\.(m|c)?[jt]sx?$/.test(s.path)) continue;
  const key = `${s.path}\0${s.blob}`;
  let e = by.get(key);
  if (e === undefined) by.set(key, (e = { path: s.path, blob: s.blob, lists: new Set(), tests: 0 }));
  e.lists.add(JSON.stringify(s.functions));
  e.tests++;
}
const items = [...by.values()];
const input = items.map((i) => i.blob).join("\n") + "\n";
const raw = execFileSync("git", ["cat-file", "--batch"], { cwd: repo, input, maxBuffer: 1 << 30 });
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
  return text === undefined ? [] : [{ path: i.path, blob: i.blob, tests: i.tests, text, lists: [...i.lists].map((l) => JSON.parse(l)) }];
});
writeFileSync(out, JSON.stringify(corpus));
process.stdout.write(`${items.length} sources, ${corpus.length} with text, ${corpus.reduce((n, c) => n + c.lists.length, 0)} lists\n`);
