// Throwaway (results-at-commit, question 1). For sampled first-parent main
// commits X: what `results WHERE commit_sha = X` gives, against the test
// files Squeal knows that exist at X, and why the two differ.
//
// Usage: node label.mjs <repo> <store.sqlite> <dump.jsonl> <ref> <since> <recent> <spread> <now-ms>
//   recent: the newest N main commits; spread: N more evenly over the rest.
// Output: one JSON line per commit, then a summary line.
//
// A file at X is classified as:
//   label-clean    a clean row (dirty = 0) labelled X: the lookup finds it
//   label-dirty    only rows labelled X with dirty = 1: content was not X's
//   reused-earlier no row labelled X, but a clean row labelled an older main
//                  commit whose content proxy equals X's (unchanged test reused)
//   relabel-later  ... labelled a newer main commit (a later run or an
//                  INSERT OR REPLACE at the same key overwrote the label)
//   relabel-other  ... labelled a commit off main's first-parent line
//                  (a branch, a merge-group SHA, a squash source)
//   none           no row whose content proxy equals X's: never run at this
//                  content here, or pruned
// The content proxy (lib.mjs `signer`) is the store's closure list plus
// observed entries over X's blobs, the project's environment runner files,
// the lockfile and the Node pin file. It does not see Node versions outside
// a pin file, installed packages, or env variables: two commits it calls
// equal can still have different keys (counted as `proxyEqualKeyDiffers`).
import { mainCommits, readDump, sameSig, signer, storeClosures, treeReader } from "./lib.mjs";

const [repo, store, dump, ref, since, recentArg, spreadArg, nowArg] = process.argv.slice(2);
const recent = Number(recentArg);
const spread = Number(spreadArg);
const now = Number(nowArg);

const commits = mainCommits(repo, ref, since);
const index = new Map(commits.map((c, i) => [c.sha, i]));
const sample = commits.slice(0, recent);
const rest = commits.slice(recent);
for (let i = 0; i < spread && rest.length > 0; i++) {
  sample.push(rest[Math.floor((i * rest.length) / spread)]);
}

const { closures, envFiles } = storeClosures(store);
// The test files Squeal lists today: any live worktree's test_file_keys row.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(store, { readOnly: true });
const listed = new Set(
  db.prepare("select distinct k.project p, k.path t from test_file_keys k join worktrees w on w.id = k.worktree_id").all().map((r) => `${r.p}\0${r.t}`),
);
db.close();
const byFile = readDump(dump);
const readTree = treeReader(repo, 4);
const sign = signer(readTree, envFiles, closures);
const sigCache = new Map();
const sig = (file, sha) => {
  const id = `${file.project}\0${file.path}\0${sha}`;
  if (!sigCache.has(id)) sigCache.set(id, sign(file, sha));
  return sigCache.get(id);
};

const KINDS = ["label-clean", "label-dirty", "reused-earlier", "relabel-later", "relabel-other", "none"];
const total = Object.fromEntries(KINDS.map((k) => [k, 0]));
const byAge = {};
let proxyEqualKeyDiffers = 0;
let proxyChecked = 0;

for (const x of sample) {
  const tree = readTree(x.sha);
  if (tree === null) continue;
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const origins = {};
  let labelledFilesNotAtX = 0;
  const labelledHere = new Set();
  for (const [id, groups] of byFile) {
    if (groups.some((g) => g.c === x.sha)) labelledHere.add(id);
  }
  for (const [id, file] of closures) {
    if (!tree.has(file.path) || !listed.has(id)) continue;
    const groups = byFile.get(id) ?? [];
    const clean = groups.filter((g) => g.c === x.sha && g.d === 0);
    const dirty = groups.filter((g) => g.c === x.sha && g.d === 1);
    let kind;
    if (clean.length > 0) {
      kind = "label-clean";
      for (const g of clean) origins[g.origin] = (origins[g.origin] ?? 0) + 1;
    } else {
      const here = sig(file, x.sha);
      const match = groups.filter((g) => g.d === 0 && g.c !== null && g.c !== x.sha && sameSig(sig(file, g.c), here));
      if (match.length > 0) {
        // Proxy check: equal proxies but more than one key among the matches.
        proxyChecked++;
        if (new Set(match.map((g) => g.k)).size > 1) proxyEqualKeyDiffers++;
        const pos = match.map((g) => index.get(g.c));
        if (pos.some((p) => p !== undefined && p > index.get(x.sha))) kind = "reused-earlier";
        else if (pos.some((p) => p !== undefined)) kind = "relabel-later";
        else kind = "relabel-other";
      } else kind = dirty.length > 0 ? "label-dirty" : "none";
    }
    counts[kind]++;
  }
  for (const id of labelledHere) {
    const f = closures.get(id);
    if (f === undefined || !tree.has(f.path)) labelledFilesNotAtX++;
  }
  const ageDays = (now - x.time) / 86400000;
  const bucket = ageDays < 1 ? "<1d" : ageDays < 3 ? "1-3d" : ageDays < 7 ? "3-7d" : ageDays < 14 ? "7-14d" : ">=14d";
  const files = KINDS.reduce((s, k) => s + counts[k], 0);
  const b = (byAge[bucket] ??= { commits: 0, files: 0, ...Object.fromEntries(KINDS.map((k) => [k, 0])) });
  b.commits++;
  b.files += files;
  for (const k of KINDS) {
    b[k] += counts[k];
    total[k] += counts[k];
  }
  console.log(
    JSON.stringify({ commit: x.sha.slice(0, 9), ageDays: Number(ageDays.toFixed(2)), files, ...counts, labelOrigins: origins, labelledFilesNotAtX }),
  );
}
console.log(JSON.stringify({ summary: true, commits: sample.length, total, byAge, proxyChecked, proxyEqualKeyDiffers }));
