// Throwaway (results-at-commit, question 3). Of first-parent main commits
// since <since>, how many some worktree's daemon had as a clean revision
// head (`revisions`, pruned with removed worktrees, so a lower bound), and
// how many clean heads daemons saw that are not main commits.
// Usage: node seen.mjs <repo> <store.sqlite> <ref> <since-iso>
import { DatabaseSync } from "node:sqlite";
import { mainCommits } from "./lib.mjs";
const [repo, store, ref, since] = process.argv.slice(2);
const main = mainCommits(repo, ref, since);
const set = new Set(main.map((c) => c.sha));
const db = new DatabaseSync(store, { readOnly: true });
const t0 = Date.parse(since);
const heads = db.prepare("select distinct head from revisions where dirty = 0 and head is not null and created_at >= ?").all(t0).map((r) => r.head);
const anyHeads = db.prepare("select distinct head from revisions where head is not null and created_at >= ?").all(t0).map((r) => r.head);
const days = (Date.now() - t0) / 86400000;
console.log(JSON.stringify({
  since, days: Number(days.toFixed(2)), mainCommits: main.length,
  mainSeenClean: heads.filter((h) => set.has(h)).length,
  mainSeenAny: anyHeads.filter((h) => set.has(h)).length,
  cleanHeads: heads.length, cleanHeadsOffMain: heads.filter((h) => !set.has(h)).length,
}));
