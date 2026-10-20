// THROWAWAY probe (011-core/research/edit-cut.md, questions 1 to 3). `node classify.mjs <cezar|squeal>`.
// Picks the agent revisions of the repository's store copy as ../catch-up/ did (no HEAD move and
// not within 10 s of one, 1 to 9 keyed paths), and for each one classifies every fast test file
// today's closures say it re-keyed, in the static one-hop graph at its head with the revision's
// own blobs overlaid (../central-edits/direct.mjs's method): edited, direct (with the changed paths
// it imports in one hop: `directOf`), transitive at depth d, outside the import graph, or absent at
// the head. Writes results/classified-<repo>.json.gz. Read-only on the store copy and on git.
import { depths, edgesOfBlob, graphAt, openStore, REPOS, writeResult } from "./lib.mjs";

const repo = process.argv[2];
const R = REPOS[repo];
const db = openStore(repo);
const tests = db.prepare("select project, path, closure_paths from test_files").all().filter((t) => !R.slow.test(t.path))
  .map((t) => ({ id: `${t.project}:${t.path}`, path: t.path, lane: R.nodeTest.has(t.project) ? "node:test" : "vitest", closure: new Set(JSON.parse(t.closure_paths)) }));
const keyed = new Set();
for (const t of db.prepare("select path, closure_paths from test_files").all()) { keyed.add(t.path); for (const p of JSON.parse(t.closure_paths)) keyed.add(p); }

// The selection of ../catch-up/explained.mjs: a revision is in a HEAD move when its HEAD differs
// from the worktree's previous revision's, or it is on the same HEAD within 10 s of that move.
const revs = db.prepare("select worktree_id, number, created_at, head, changes from revisions order by worktree_id, number").all();
const picked = [];
let prev = null, moveAt = null, base = null;
for (const r of revs) {
  const same = prev !== null && prev.worktree_id === r.worktree_id;
  if (!same) { base = null; moveAt = null; }
  const moved = same && prev.head !== r.head;
  if (moved) { base = prev.head; moveAt = r.created_at; }
  const inMove = base !== null && (moved || r.created_at - moveAt <= 10_000);
  const changes = JSON.parse(r.changes);
  const k = changes.filter((c) => keyed.has(c.path)).length;
  if (!inMove && k > 0 && k < 10 && r.head) picked.push(r);
  prev = r;
}

const earlier = db.prepare("select changes from revisions where worktree_id = ? and number < ? and head = ? order by number");
const cached = db.prepare("select path, hash from file_hashes where worktree_id = ?");
const graphs = new Map();
const out = [];
let missingHeads = 0;
for (const r of picked) {
  if (!graphs.has(r.head)) {
    try { graphs.set(r.head, graphAt(repo, r.head)); } catch { graphs.set(r.head, null); }
  }
  const g = graphs.get(r.head);
  if (g === null) { missingHeads++; continue; }
  const changes = JSON.parse(r.changes);
  const changed = new Set(changes.map((c) => c.path));
  const dirty = new Map();
  for (const e of earlier.all(r.worktree_id, r.number, r.head)) for (const c of JSON.parse(e.changes)) dirty.set(c.path, c.newHash);
  for (const c of changes) dirty.set(c.path, c.newHash);
  const cache = new Map(cached.all(r.worktree_id).map((h) => [h.path, h.hash]));
  for (const p of [...changed, ...tests.map((t) => t.path)]) if (!dirty.has(p) && !g.files.has(p) && cache.has(p)) dirty.set(p, cache.get(p));
  const view = { exists: (p) => (dirty.has(p) ? dirty.get(p) !== null : g.exists(p)) };
  const edges = new Map(g.edges);
  for (const [path, hash] of dirty) {
    if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)) continue;
    if (hash === null) { edges.delete(path); continue; }
    const e = edgesOfBlob(repo, view, path, hash);
    if (e !== null) edges.set(path, e);
  }
  const rekeyed = tests.filter((t) => changed.has(t.path) || [...changed].some((c) => t.closure.has(c)));
  const files = rekeyed.map((t) => {
    if (changed.has(t.path)) return { id: t.id, path: t.path, lane: t.lane, cls: "edited", depth: 0, directOf: [] };
    if (!edges.has(t.path)) return { id: t.id, path: t.path, lane: t.lane, cls: "absent", depth: null, directOf: [] };
    const directOf = [...changed].filter((c) => edges.get(t.path).has(c));
    const d = depths(edges, t.path);
    const ds = [...changed].map((c) => d.get(c)).filter((x) => x !== undefined);
    if (ds.length === 0) return { id: t.id, path: t.path, lane: t.lane, cls: "outside", depth: null, directOf };
    const depth = Math.min(...ds);
    return { id: t.id, path: t.path, lane: t.lane, cls: depth === 1 ? "direct" : "transitive", depth, directOf };
  });
  // The test files that exist at this revision: the namesake universe.
  const present = [...new Set(tests.map((t) => t.path))].filter((p) => edges.has(p));
  const testPaths = new Set(tests.map((t) => t.path));
  // Changed sources: keyed paths the revision changed that are not test files (a deleted one included).
  const sources = [...changed].filter((c) => keyed.has(c) && !testPaths.has(c));
  out.push({
    rev: `${r.worktree_id.slice(0, 8)} r${r.number}`, wt: r.worktree_id, n: r.number, at: r.created_at, head: r.head,
    changed: [...changed], keyedChanged: [...changed].filter((c) => keyed.has(c)), sources,
    editedTests: [...changed].filter((c) => testPaths.has(c)), present, files,
  });
}
// Stored compactly: each head's present test files once, and per revision only what differs.
const heads = {};
for (const o of out) heads[o.head] ??= o.present;
for (const o of out) {
  const base = new Set(heads[o.head]), mine = new Set(o.present);
  o.presentAdded = o.present.filter((p) => !base.has(p));
  o.presentRemoved = heads[o.head].filter((p) => !mine.has(p));
  delete o.present;
}
writeResult(`classified-${repo}`, { heads, revisions: out });
console.log(`${repo}: ${picked.length} agent revisions picked, ${out.length} classified, ${missingHeads} at a head git no longer has; ${graphs.size} heads, parse failures ${[...graphs.values()].filter(Boolean).reduce((a, g) => a + g.failed.length, 0)}`);
const big = out.filter((o) => o.files.filter((f) => f.cls !== "absent").length >= 200).length;
console.log(`re-keying 200 or more present files: ${big}`);
