// Throwaway probe for row 018-15. Read only: a copied store, CI's export, a tree listing.
// node union-extras.mjs <store.sqlite copy> <export.json> <tree.txt (git ls-tree -r --name-only)> <out.json>
//
// Per exported test file:
//   E   = CI's closure list (static closure plus CI's own observed reads, one run at the commit)
//   Eo  = CI's own observed reads (export `observed.observed`)
//   U   = the store's shared observed union for the file (`meta observed.<project>`)
//   S   = E without Eo's paths that are not also static: E \ (Eo \ static) cannot be told apart,
//         so the model list here is L' = E ∪ eff(U): what a clone at the commit assembles
//         (static closure at the commit, which is CI's, plus the union), see keying.ts setClosure.
//   X   = eff(U) \ E, the paths the union adds over the file's own run
//   M   = eff(Eo) \ eff(U), paths CI's run read that the union lacks
// A path with no file enters no key segment (check-key.ts, task 011-158); a listing path
// always does (a marker when absent, observed.ts ABSENT_LISTING). So X moves the key when it
// holds a file present at the commit or any listing path.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

const [dbPath, exportPath, treePath, outPath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
const exp = JSON.parse(readFileSync(exportPath, "utf8"));
const files = new Set(readFileSync(treePath, "utf8").split("\n").filter(Boolean));
const dirs = new Set([""]);
for (const f of files) for (let d = posix.dirname(f); d !== "."; d = posix.dirname(d)) dirs.add(d);

function isClosurePath(p) {
  if (p.endsWith("/")) return true;
  const s = p.replaceAll("\\", "/");
  if (s === "" || s.startsWith("/") || /^[A-Za-z]:\//.test(s)) return false;
  const n = posix.normalize(s).replace(/\/$/, "");
  return !(n === "." || n === ".." || n.startsWith("../"));
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function kind(p) {
  if (p.endsWith("/")) {
    const d = p === "./" ? "" : p.slice(0, -1);
    return dirs.has(d) ? "listing-tracked-dir" : "listing-other-dir";
  }
  if (files.has(p)) return p.endsWith("package.json") ? "tracked-package.json" : "tracked-file";
  if (UUID.test(p)) return "untracked-uuid-name";
  if (p.startsWith("node_modules/") || p.includes("/node_modules/")) return "untracked-node_modules";
  if (/(^|\/)(dist|web|\.ai)\//.test(p)) return "untracked-build-or-ai";
  return "untracked-other";
}
const MOVES = new Set(["listing-tracked-dir", "listing-other-dir", "tracked-package.json", "tracked-file"]);

const unions = new Map();
function unionOf(project) {
  if (!unions.has(project)) {
    const row = db.prepare("select value from meta where key = ?").get(`observed.${project}`);
    unions.set(project, row ? JSON.parse(row.value) : {});
  }
  return unions.get(project);
}
const storedList = db.prepare("select closure_paths, updated_at, updated_by from test_files where project = ? and path = ?");

const perFile = [];
const byKind = {};
const summary = {};
for (const tf of exp.testFiles) {
  const E = new Set(tf.closure.paths);
  const Eo = (tf.observed.observed ?? []).filter(isClosurePath);
  const U = (unionOf(tf.project)[tf.path] ?? []).filter(isClosurePath);
  const Uset = new Set(U);
  const X = U.filter((p) => !E.has(p));
  const M = Eo.filter((p) => !Uset.has(p));
  const kinds = {};
  for (const p of X) kinds[kind(p)] = (kinds[kind(p)] ?? 0) + 1;
  for (const [k, n] of Object.entries(kinds)) byKind[k] = (byKind[k] ?? 0) + n;
  const moving = X.filter((p) => MOVES.has(kind(p)));
  const row = storedList.get(tf.project, tf.path);
  const L = row ? new Set(JSON.parse(row.closure_paths)) : null;
  const storedExtra = L ? [...L].filter((p) => !E.has(p)).length : null;
  const storedMissing = L ? [...E].filter((p) => !L.has(p)).length : null;
  const storedMissingObserved = L ? Eo.filter((p) => !L.has(p)).length : null;
  const f = {
    project: tf.project,
    path: tf.path,
    E: E.size,
    Eo: Eo.length,
    U: U.length,
    X: X.length,
    M: M.length,
    xKinds: kinds,
    keyMovesToday: moving.length > 0 || M.length > 0,
    supersetHolds: M.length === 0,
    storedListExtra: storedExtra,
    storedListMissing: storedMissing,
    storedListMissingObserved: storedMissingObserved,
    storedUpdatedAt: row ? new Date(Number(row.updated_at)).toISOString() : null,
    xSample: moving.slice(0, 5),
    mSample: M.slice(0, 5),
  };
  perFile.push(f);
  const s = (summary[tf.project] ??= {
    exported: 0, unionAddsAny: 0, unionAddsKeyMoving: 0, todayKeyEqual: 0,
    optionA_superset: 0, optionB_ownRun: 0, ciReadUnionLacks: 0,
    storedListEqual: 0, storedListSuperset: 0,
  });
  s.exported++;
  if (X.length > 0) s.unionAddsAny++;
  if (moving.length > 0) s.unionAddsKeyMoving++;
  if (!f.keyMovesToday) s.todayKeyEqual++;
  if (f.supersetHolds) s.optionA_superset++;
  s.optionB_ownRun++;
  if (M.length > 0) s.ciReadUnionLacks++;
  if (L && storedExtra === 0 && storedMissing === 0) s.storedListEqual++;
  if (L && storedMissing === 0) s.storedListSuperset++;
}
const all = {};
for (const s of Object.values(summary)) for (const [k, v] of Object.entries(s)) all[k] = (all[k] ?? 0) + v;
summary.all = all;
writeFileSync(outPath, JSON.stringify({ summary, byKind, perFile }, null, 1));
console.log(JSON.stringify({ summary, byKind }, null, 1));
