// 011-299 probe (throwaway): the (a) and (d) file runs in detail: the other run, its worktree, its checkpoint kind,
// the start offset, and which of the two kept the row.
// Usage: node dupes.cjs <store copy> <classes.jsonl> <classes.cls.jsonl>
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, rawPath, clsPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const read = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const R = read(rawPath), C = read(clsPath);
const run = db.prepare("select r.started_at, r.ended_at, r.checkpoint_id, c.kind, r.test_files from runs r left join checkpoints c on c.id = r.checkpoint_id where r.id = ?");
const S = {}; const add = (k, s) => (S[k] = (S[k] ?? 0) + s);
const ex = [];
R.forEach((r, i) => {
  const c = C[i].c;
  if (c.startsWith("d ")) {
    const o = r.overlap.find((o) => o.sameContent && (o.orphan || !r.stored));
    const or = run.get(o.run);
    const dt = (or.started_at - r.rs) / 1000;
    add(`d other run: ${or.kind ?? "no checkpoint"}; ${o.orphan ? "the other's row is gone" : "this run's row is gone"}; other started ${dt < 0 ? "before" : "after"}`, r.sec);
    add(`d other started ${Math.abs(dt) < 60 ? "<1 min" : Math.abs(dt) < 600 ? "1-10 min" : ">10 min"} apart`, r.sec);
    if (ex.length < 6) ex.push({ file: r.file.split("\0")[1], W: r.W.slice(0, 8), other: o.W.slice(0, 8), dt: Math.round(dt), otherKind: or.kind, otherFiles: JSON.parse(or.test_files).length });
  }
  if (c.startsWith("a ")) {
    const o = r.orphanBefore.find((o) => o.sameContent); const or = run.get(o.run);
    add(`a earlier run: ${or.kind ?? "no checkpoint"}, ended ${Math.round((r.rs - or.ended_at) / 60e3) < 60 ? "<1 h" : ">=1 h"} before; same worktree ${o.W === r.W}`, r.sec);
  }
});
console.log(Object.entries(S).sort().map(([k, v]) => String(Math.round(v)).padStart(6) + " " + k).join("\n"));
console.log(ex);
