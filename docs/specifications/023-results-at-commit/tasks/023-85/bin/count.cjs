// Row 023-85: runs per folder-listing test file in one worktree's store, as JSON on stdout.
// usage: node count.cjs <store.sqlite> <root> <listing.txt> [label]
const { DatabaseSync } = require("node:sqlite");
const { readFileSync } = require("node:fs");
const [store, root, listing, label = ""] = process.argv.slice(2);
const files = readFileSync(listing, "utf8").split("\n").filter(Boolean);
const db = new DatabaseSync(store, { readOnly: true });
const runs = db
  .prepare(
    "select r.test_files, r.started_at, r.ended_at from runs r join worktrees w on w.id = r.worktree_id where w.root = ? order by started_at",
  )
  .all(root)
  .map((r) => ({ ...r, files: JSON.parse(r.test_files).map((f) => f.path ?? f) }));
const count = Object.fromEntries(files.map((f) => [f, 0]));
for (const run of runs) for (const f of run.files) if (f in count) count[f] += 1;
const histogram = {};
for (const n of Object.values(count)) histogram[n] = (histogram[n] ?? 0) + 1;
const twice = Object.entries(count).filter(([, n]) => n > 1).map(([f, n]) => `${f} ${n}`);
const span = runs.length === 0 ? 0 : (Math.max(...runs.map((r) => r.ended_at ?? 0)) - Math.min(...runs.map((r) => r.started_at))) / 1000;
process.stdout.write(`${JSON.stringify({ label, files: files.length, runs: runs.length, span, histogram, twice }, null, 1)}\n`);
