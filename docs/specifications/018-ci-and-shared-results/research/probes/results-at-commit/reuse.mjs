// Throwaway (results-at-commit, question 4). For first-parent main commits X
// and X~d (d = 1, 10, 50), the share of listed test files whose content
// proxy (lib.mjs `signer`) is equal, and the first part that breaks it:
// the Node pin file, the lockfile, the environment's runner files
// (config, setup), or the file's own closure.
//
// With a store that holds imports (018 D3), it also compares the real keys
// the imports stored per main commit (`import_files`): equal keys where the
// environment hash is equal, and how many files had no import pair with an
// equal environment.
//
// Usage: node reuse.mjs <repo> <store.sqlite> <ref> <since> <samples>
import { DatabaseSync } from "node:sqlite";
import { mainCommits, signer, storeClosures, treeReader } from "./lib.mjs";

const [repo, store, ref, since, samplesArg] = process.argv.slice(2);
const samples = Number(samplesArg);
const commits = mainCommits(repo, ref, since);
const { closures, envFiles } = storeClosures(store);
const db = new DatabaseSync(store, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const listed = new Set(
  db
    .prepare("select distinct k.project p, k.path t from test_file_keys k join worktrees w on w.id = k.worktree_id")
    .all()
    .map((r) => `${r.p}\0${r.t}`),
);
const readTree = treeReader(repo, 4);
const sign = signer(readTree, envFiles, closures);

const out = {};
for (const d of [1, 10, 50]) {
  const usable = commits.length - d;
  const counts = { pairs: 0, files: 0, equal: 0, pin: 0, lock: 0, env: 0, closure: 0, closureWithPackageJson: 0, newFile: 0 };
  for (let i = 0; i < samples && usable > 0; i++) {
    const at = Math.floor((i * usable) / samples);
    const x = commits[at].sha;
    const y = commits[at + d].sha;
    const tx = readTree(x);
    const ty = readTree(y);
    if (tx === null || ty === null) continue;
    counts.pairs++;
    for (const [id, file] of closures) {
      if (!listed.has(id) || !tx.has(file.path)) continue;
      counts.files++;
      if (!ty.has(file.path)) {
        counts.newFile++;
        continue;
      }
      const a = sign(file, x);
      const b = sign(file, y);
      if (a.pin !== b.pin) counts.pin++;
      else if (a.lock !== b.lock) counts.lock++;
      else if (a.env !== b.env) counts.env++;
      else if (a.closure !== b.closure) {
        counts.closure++;
        if (file.paths.includes("package.json") && tx.get("package.json") !== ty.get("package.json")) counts.closureWithPackageJson++;
      }
      else counts.equal++;
    }
  }
  counts.equalShare = Number((counts.equal / counts.files).toFixed(4));
  out[`d${d}`] = counts;
}
console.log(JSON.stringify({ proxy: out, mainCommits: commits.length }));

// Real keys from imports, when the store has them.
const hasImports = db.prepare("select 1 from sqlite_master where name = 'imports'").get() !== undefined;
if (hasImports) {
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  const byCommit = new Map();
  for (const row of db
    .prepare(
      `select json_extract(i.header, '$.commit') c, f.project p, f.path t, f.key k, f.environment e
       from imports i join import_files f on f.import_id = i.id`,
    )
    .iterate()) {
    if (!index.has(row.c)) continue;
    const files = byCommit.get(row.c) ?? new Map();
    const id = `${row.p}\0${row.t}`;
    const list = files.get(id) ?? [];
    list.push([row.k, row.e]);
    files.set(id, list);
    byCommit.set(row.c, files);
  }
  const held = [...byCommit.keys()].sort((a, b) => index.get(a) - index.get(b));
  const real = {};
  for (const d of [1, 10, 50]) {
    // Pairs of imported main commits whose first-parent distance is about d
    // (the next imported commit at least d back).
    const counts = { pairs: 0, files: 0, equalKey: 0, keyDiffers: 0, envDiffers: 0, distances: [] };
    for (const x of held) {
      const want = index.get(x) + d;
      const y = held.find((c) => index.get(c) >= want);
      if (y === undefined) continue;
      counts.pairs++;
      counts.distances.push(index.get(y) - index.get(x));
      const fx = byCommit.get(x);
      const fy = byCommit.get(y);
      for (const [id, rows] of fx) {
        const other = fy.get(id);
        if (other === undefined) continue;
        counts.files++;
        const sameEnv = rows.flatMap(([k, e]) => other.filter(([, e2]) => e2 === e).map(([k2]) => k2 === k));
        if (sameEnv.length === 0) counts.envDiffers++;
        else if (sameEnv.some(Boolean)) counts.equalKey++;
        else counts.keyDiffers++;
      }
    }
    const ds = counts.distances.sort((a, b) => a - b);
    counts.distances = ds.length === 0 ? null : { min: ds[0], median: ds[Math.floor(ds.length / 2)], max: ds.at(-1) };
    counts.equalShareOfSameEnv = Number((counts.equalKey / (counts.equalKey + counts.keyDiffers)).toFixed(4));
    real[`d${d}`] = counts;
  }
  console.log(JSON.stringify({ importedKeys: real, importedMainCommits: held.length }));
}
