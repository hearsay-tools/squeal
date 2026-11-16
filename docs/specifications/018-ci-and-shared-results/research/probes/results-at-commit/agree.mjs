// Throwaway (results-at-commit). Agreement of the git-only content proxy
// (lib.mjs) with real keys: for each pair of consecutive imported main
// commits, each file both imports hold under one environment hash: is the
// real key equal, is the proxy equal (whole, and without the lockfile part,
// since per-package keys re-key only files whose packages moved).
// Usage: node agree.mjs <repo> <store.sqlite> <ref> <since>
import { DatabaseSync } from "node:sqlite";
import { mainCommits, signer, storeClosures, treeReader } from "./lib.mjs";
const [repo, store, ref, since] = process.argv.slice(2);
const commits = mainCommits(repo, ref, since);
const index = new Map(commits.map((c, i) => [c.sha, i]));
const { closures, envFiles } = storeClosures(store);
const sign = signer(treeReader(repo, 4), envFiles, closures);
const db = new DatabaseSync(store, { readOnly: true });
const byCommit = new Map();
for (const row of db.prepare(`select json_extract(i.header,'$.commit') c, f.project p, f.path t, f.key k, f.environment e
  from imports i join import_files f on f.import_id = i.id`).iterate()) {
  if (!index.has(row.c)) continue;
  const m = byCommit.get(row.c) ?? new Map();
  const id = `${row.p}\0${row.t}`;
  (m.get(id) ?? m.set(id, []).get(id)).push([row.k, row.e]);
  byCommit.set(row.c, m);
}
const held = [...byCommit.keys()].sort((a, b) => index.get(a) - index.get(b));
const t = { both: 0, keyEq_proxyEq: 0, keyEq_proxyNe: 0, keyNe_proxyEq: 0, keyNe_proxyNe: 0, keyEq_proxyNoLockEq: 0, keyNe_proxyNoLockEq: 0 };
for (let i = 0; i + 1 < held.length; i++) {
  const x = held[i], y = held[i + 1];
  for (const [id, rows] of byCommit.get(x)) {
    const other = byCommit.get(y).get(id);
    const file = closures.get(id);
    if (other === undefined || file === undefined) continue;
    const same = rows.flatMap(([k, e]) => other.filter(([, e2]) => e2 === e).map(([k2]) => k2 === k));
    if (same.length === 0) continue;
    const keyEq = same.some(Boolean);
    const a = sign(file, x), b = sign(file, y);
    if (a === null || b === null) continue;
    t.both++;
    const pe = a.closure === b.closure && a.env === b.env && a.lock === b.lock && a.pin === b.pin;
    const pn = a.closure === b.closure && a.env === b.env && a.pin === b.pin;
    t[`key${keyEq ? "Eq" : "Ne"}_proxy${pe ? "Eq" : "Ne"}`]++;
    if (pn) t[`key${keyEq ? "Eq" : "Ne"}_proxyNoLockEq`]++;
  }
}
console.log(JSON.stringify({ pairs: held.length - 1, ...t }));
