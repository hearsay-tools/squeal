#!/usr/bin/env node
// Throwaway probe for 023-80 (new in round 11). Not product code. Runs on the VM as agent, over a
// copy of one session's store (session.mjs copies <clone>/.git/squeal/store.sqlite*, which both
// sides of the clone share: the commit worktree is a worktree of the clone):
//
//   node runs.mjs <store.sqlite> <session start ISO>
//
// Prints every run the store kept, in start order: seconds from the session's start, duration,
// side (`commit` for a worktree under Squeal's checkouts, `tree` for the clone), revision, end
// state and its test files (browser files by base name; others counted unless 3 or fewer). Then,
// for 023-78: per side, the browser files in the order they started, and the files with a run on
// both sides, with which side ran each first; for 023-81: per side, the test files that ran more
// than once, with their run starts.
import { DatabaseSync } from "node:sqlite";

const [file, start] = process.argv.slice(2);
const t0 = Date.parse(start);
const db = new DatabaseSync(file);
const trees = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root]));
const side = (id) => {
  const root = trees.get(id) ?? "";
  return /\/checkouts\//.test(root) ? "commit" : root ? "tree" : `gone:${id.slice(0, 8)}`;
};
const paths = (json) => {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") {
      if (/\.(test|spec|e2e)\.[cm]?[jt]sx?$|\.ts$/.test(v)) out.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(JSON.parse(json));
  return [...new Set(out)];
};
const browser = (p) => /\.e2e\.ts$/.test(p);
const base = (p) => p.split("/").pop();
const sec = (ms) => ((ms - t0) / 1000).toFixed(0);
const runs = db.prepare("SELECT worktree_id, revision, test_files, started_at, ended_at, end_state FROM runs ORDER BY started_at").all();
const order = { commit: [], tree: [] };
const first = { commit: new Map(), tree: new Map() };
const count = { commit: new Map(), tree: new Map() };
console.log(`## runs (${runs.length}), seconds from session start`);
for (const r of runs) {
  const s = side(r.worktree_id);
  const files = paths(r.test_files);
  const b = files.filter(browser);
  const other = files.filter((p) => !browser(p));
  const dur = r.ended_at ? `${((r.ended_at - r.started_at) / 1000).toFixed(0)}s` : "open";
  const shown = [...b.map(base), ...(other.length <= 3 ? other : [`${other.length} other files`])];
  console.log(`${sec(r.started_at)}s\t${dur}\t${s}\trev ${r.revision}\t${r.end_state ?? "-"}\t${shown.join(", ")}`);
  if (!order[s]) continue;
  for (const p of files) {
    count[s].set(p, [...(count[s].get(p) ?? []), sec(r.started_at)]);
    if (browser(p) && !first[s].has(p)) {
      first[s].set(p, r.started_at);
      order[s].push(base(p));
    }
  }
}
console.log("\n## 023-78: browser files per side, in start order");
for (const s of ["commit", "tree"]) console.log(`${s}: ${order[s].join(", ") || "(none)"}`);
const both = [...first.commit.keys()].filter((p) => first.tree.has(p));
console.log(`both sides: ${both.length}`);
for (const p of both) {
  const c = first.commit.get(p);
  const t = first.tree.get(p);
  console.log(`  ${base(p)}: commit ${sec(c)}s, tree ${sec(t)}s, ${c <= t ? "commit" : "tree"} first`);
}
console.log("\n## 023-81: test files run more than once on one side (run starts)");
for (const s of ["commit", "tree"])
  for (const [p, at] of count[s]) if (at.length > 1) console.log(`${s}\t${p}\t${at.join("s, ")}s`);
