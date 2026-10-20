// THROWAWAY probe (011-core/research/central-edits.md, question 1). For cezar's 62 revisions of
// (with R25_ALL=1, all 293 agent revisions of 1 to 9 keyed sources)
// fewer than 10 keyed sources that re-keyed 200 or more fast test files (research/catch-up.md,
// probes/catch-up/results/{explained,revisions}.json; no HEAD move), each re-keyed test file's
// distance from the revision's changed paths in graph.mjs's module graph at the revision's head:
// edited (the test file itself changed), direct (imports a changed path in one hop), transitive at
// depth d, or outside the import graph (a declared input or a path a run read). Re-keyed means
// what the catch-up probe counted: a fast test file whose stored closure holds a changed path, or
// that changed. Where cezar's object store still holds a changed file's new blob, that file's
// edges are read from it, so an import the edit added counts. Read-only on the store copy.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { depths, edgesOfBlob, graphAt, writeResult } from "./graph.mjs";

const db = new DatabaseSync(process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const CU = new URL("../catch-up/results/", import.meta.url);
const SLOW = /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/;
const NODE_TEST = new Set(["test:unit", "root:test:unit", "test:package"]);
const ex = JSON.parse(readFileSync(new URL("explained.json", CU)));
const rv = new Map(JSON.parse(readFileSync(new URL("revisions.json", CU))).map((r) => [`${r.wt}:${r.n}`, r]));
const picked = ex.map((e) => ({ ...e, ...rv.get(`${e.wt}:${e.n}`) })).filter((r) => !r.inMove && r.keyed < 10 && (process.env.R25_ALL ? r.keyed > 0 : r.rekeyed >= 200));
// R25_ALL=1: every agent revision (no HEAD move, 1 to 9 keyed sources), for cuts.mjs.
const OUT = process.env.R25_ALL ? "direct-all" : "direct";

const tests = db.prepare("select project, path, closure_paths from test_files").all().filter((t) => !SLOW.test(t.path))
  .map((t) => ({ id: `${t.project}:${t.path}`, project: t.project, path: t.path, lane: NODE_TEST.has(t.project) ? "node:test" : "vitest", closure: new Set(JSON.parse(t.closure_paths)) }));
const revRow = db.prepare("select worktree_id, number, created_at, head, changes from revisions where worktree_id like ? and number = ?");
// Every earlier revision of the worktree at the same head: the dirty tree the daemon saw build up.
const earlier = db.prepare("select changes from revisions where worktree_id = ? and number < ? and head = ? order by number");
// A file the worktree held before its first retained revision: the hash its stat cache keeps now.
const cached = db.prepare("select path, hash from file_hashes where worktree_id = ?");

const graphs = new Map();
const out = [];
for (const p of picked) {
  const r = revRow.get(`${p.wt}%`, p.n);
  if (!graphs.has(r.head)) graphs.set(r.head, graphAt(r.head));
  const g = graphs.get(r.head);
  const changes = JSON.parse(r.changes);
  const changed = new Set(changes.map((c) => c.path));
  // The revision's own edges: each changed file's, and each file earlier revisions of the worktree
  // at this head changed, from its newest blob when cezar's object store holds it. A file they added
  // resolves; one they deleted does not.
  const dirty = new Map();
  for (const e of earlier.all(r.worktree_id, r.number, r.head)) for (const c of JSON.parse(e.changes)) dirty.set(c.path, c.newHash);
  for (const c of changes) dirty.set(c.path, c.newHash);
  // Test files and changed paths the head lacks and no revision wrote: the stat cache's hash, if any.
  const cache = new Map(cached.all(r.worktree_id).map((h) => [h.path, h.hash]));
  for (const q of [...changed, ...tests.map((t) => t.path)]) if (!dirty.has(q) && !g.files.has(q) && cache.has(q)) dirty.set(q, cache.get(q));
  const view = { exists: (q) => (dirty.has(q) ? dirty.get(q) !== null : g.exists(q)) };
  const edges = new Map(g.edges);
  let blobs = 0, overlaid = 0, codeChanged = 0;
  for (const [path, hash] of dirty) {
    if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)) continue;
    if (changed.has(path)) codeChanged++;
    if (hash === null) { edges.set(path, new Set()); continue; }
    const e = edgesOfBlob(view, path, hash);
    if (e === null) continue;
    edges.set(path, e);
    if (changed.has(path)) blobs++; else overlaid++;
  }
  const rekeyed = tests.filter((t) => changed.has(t.path) || [...changed].some((c) => t.closure.has(c)));
  const files = rekeyed.map((t) => {
    if (changed.has(t.path)) return { id: t.id, lane: t.lane, cls: "edited", depth: 0 };
    if (!edges.has(t.path)) return { id: t.id, lane: t.lane, cls: "absent", depth: null };
    const d = depths(edges, t.path);
    const ds = [...changed].map((c) => d.get(c)).filter((x) => x !== undefined);
    if (ds.length === 0) return { id: t.id, lane: t.lane, cls: "outside", depth: null };
    const depth = Math.min(...ds);
    return { id: t.id, lane: t.lane, cls: depth === 1 ? "direct" : "transitive", depth };
  });
  // Per changed keyed path: its direct importers and the rest it re-keys.
  const perPath = [...changed].filter((c) => tests.some((t) => t.closure.has(c) || t.path === c)).map((c) => {
    const reach = rekeyed.filter((t) => t.path === c || t.closure.has(c));
    const direct = reach.filter((t) => t.path === c || (edges.get(t.path)?.has(c) ?? false)).length;
    return { path: c, direct, rest: reach.length - direct };
  });
  // The edited module's own test file: an edited test file, else a changed source's sibling `<name>.test.ts(x)`.
  const own = new Set(rekeyed.filter((t) => changed.has(t.path)).map((t) => t.id));
  if (own.size === 0) for (const c of changed) {
    const base = c.replace(/\.(ts|tsx|mts|js|mjs)$/, "");
    for (const t of rekeyed) if (t.path === `${base}.test.ts` || t.path === `${base}.test.tsx`) own.add(t.id);
  }
  const count = (cls) => files.filter((f) => f.cls === cls).length;
  out.push({
    rev: `${p.wt} r${p.n}`, at: new Date(r.created_at).toISOString(), head: r.head.slice(0, 8), keyed: p.keyed, changed: changed.size,
    codeChanged, blobs, overlaid, rekeyed: rekeyed.length,
    edited: count("edited"), direct: count("direct"), transitive: count("transitive"), outside: count("outside"), absent: count("absent"),
    depth2: files.filter((f) => f.depth === 2).length, depth3plus: files.filter((f) => f.depth !== null && f.depth >= 3).length,
    maxDepth: Math.max(0, ...files.map((f) => f.depth ?? 0)),
    own: [...own].map((id) => ({ id, cls: files.find((f) => f.id === id).cls })),
    perPath, files,
  });
}
writeResult(OUT, out);
console.log(`${out.length} revisions, ${graphs.size} heads; parse failures per head: ${[...graphs.values()].map((g) => g.failed.length).join(" ")}`);
console.table(out.map(({ perPath, files, own, ...o }) => ({ ...o, own: own.map((x) => x.cls).join(",") || "-" })));
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
for (const k of ["rekeyed", "edited", "direct", "transitive", "outside", "absent", "depth2", "depth3plus"]) {
  const xs = out.map((o) => o[k]);
  console.log(`${k}: min ${Math.min(...xs)} p50 ${q(xs, 0.5)} p90 ${q(xs, 0.9)} max ${Math.max(...xs)} sum ${xs.reduce((a, b) => a + b, 0)}`);
}
const stay = out.map((o) => o.edited + o.direct);
console.log(`edited + direct (stay edits under cut a): p50 ${q(stay, 0.5)} p90 ${q(stay, 0.9)} max ${Math.max(...stay)}; share of re-keyed ${(stay.reduce((a, b) => a + b, 0) / out.reduce((a, o) => a + o.rekeyed, 0) * 100).toFixed(1)} %`);
const owns = out.flatMap((o) => o.own);
console.log(`own test files: ${owns.length} in ${out.filter((o) => o.own.length).length} revisions; by class ${JSON.stringify(Object.fromEntries(["edited", "direct", "transitive", "outside", "absent"].map((c) => [c, owns.filter((x) => x.cls === c).length])))}`);
const paths = out.flatMap((o) => o.perPath);
console.log("changed keyed paths by re-key reach (direct / rest), the 15 widest:");
const seen = new Map();
for (const pp of paths) { const k = pp.path, w = seen.get(k); if (!w || w.rest + w.direct < pp.rest + pp.direct) seen.set(k, pp); }
for (const pp of [...seen.values()].sort((a, b) => b.rest + b.direct - a.rest - a.direct).slice(0, 15)) console.log(`  ${pp.path}: ${pp.direct} direct, ${pp.rest} rest`);
