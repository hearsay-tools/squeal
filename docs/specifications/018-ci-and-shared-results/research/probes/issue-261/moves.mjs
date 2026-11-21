// Throwaway probe (row 018-69): in a COPY of a store (never the live one),
// every revision whose HEAD moved onto a main commit, against when CI
// published that commit's export (lag.json from lag.mjs) and when the store
// first imported it. With a repository path, a move is a change of the
// start point, merge-base(HEAD, origin/main), as the reader computes it
// (read-only git). Usage: node moves.mjs <store-copy.sqlite> <lag.json> [<repo>] [--list]
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const lag = JSON.parse(readFileSync(process.argv[3], "utf8"));
const main = new Map(lag.map((r) => [r.sha, r]));
const t = (x) => Date.parse(x);
const since = Math.min(...lag.map((r) => t(r.mainAt)));
const revs = db
  .prepare("select worktree_id w, number n, created_at at, head from revisions where created_at >= ? order by w, n")
  .all(since - 86_400_000);
const imports = db.prepare("select json_extract(header,'$.commit') c, imported_at at from imports").all();
const firstImport = new Map();
for (const i of imports) if (!firstImport.has(i.c) || i.at < firstImport.get(i.c)) firstImport.set(i.c, i.at);

const moves = [];
const repo = process.argv[4]?.startsWith("--") ? undefined : process.argv[4];
const bases = new Map();
const startOf = (head) => {
  if (repo === undefined || head === null) return head;
  if (!bases.has(head)) {
    let b = null;
    try { b = execFileSync("git", ["-C", repo, "merge-base", head, "origin/main"], { encoding: "utf8" }).trim(); } catch {}
    bases.set(head, b);
  }
  return bases.get(head);
};
let prev = new Map();
for (const r of revs) {
  const start = startOf(r.head);
  const before = prev.get(r.w);
  prev.set(r.w, start);
  if (before === undefined || before === start || !main.has(start)) continue;
  const m = main.get(start);
  moves.push({
    worktree: r.w, revision: r.n, at: r.at, head: r.head, start, onMain: r.head === start,
    afterMain: (r.at - t(m.mainAt)) / 1000,
    refAt: m.ref && m.publishDone ? (r.at - t(m.publishDone)) / 1000 : null,
    firstImportAfter: firstImport.has(start) ? (firstImport.get(start) - r.at) / 1000 : null,
  });
}
const withRef = moves.filter((m) => m.refAt !== null);
const before = withRef.filter((m) => m.refAt < 0);
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(JSON.stringify({
  moves: moves.length, worktrees: new Set(moves.map((m) => m.worktree)).size,
  ontoCommitWithoutRef: moves.length - withRef.length,
  withRef: withRef.length, beforePublish: before.length,
  afterMainSecondsP50: q(moves.map((m) => m.afterMain), 0.5),
  afterMainUnder300s: moves.filter((m) => m.afterMain < 300).length,
  firstImportAfterMoveSeconds: { p50: q(withRef.filter((m) => m.firstImportAfter !== null).map((m) => m.firstImportAfter), 0.5),
    p90: q(withRef.filter((m) => m.firstImportAfter !== null).map((m) => m.firstImportAfter), 0.9),
    never: withRef.filter((m) => m.firstImportAfter === null).length },
  beforePublishFirstImportAfter: before.map((m) => m.firstImportAfter),
}, null, 1));
if (process.argv.includes("--list")) for (const m of moves) console.log(JSON.stringify(m));
