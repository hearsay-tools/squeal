// Throwaway (environment-at-commit): for each first-parent main commit X of
// the last <days> days and each project, whether X's git-held environment
// inputs equal those of the main tip (the asker), and, where they differ,
// which approach would give X's environment hash:
//   derive   only the lockfile differs (runner files equal, runner version
//            equal): the installed part is computed from X's committed
//            lockfile (installed-from-git.mjs), every other part is the tip's;
//   recordC  a daemon had X as a clean revision head after the project's
//            current environment shape (Node, adapter, key format) began:
//            a table (commit, project) -> hash would hold it;
//   recordI  a stored descriptor (environments table, local, current shape)
//            has X's runner file blobs and X's lockfile's installed part:
//            the existing table plus a lockfile computation holds it;
//   install  always (topic 023-01): a checkout and install at X.
// Weights: test files per project, the asker's listing (a worktree's
// test_file_keys rows). Reads git with log/ls-tree/show and a store copy
// (copy.mjs) only. Usage: node share.mjs <repo> <scratch store> <tip> <days> <worktree root>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [repo, store, tip, days, askerRoot] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const now = Date.now();
const since = now - Number(days) * 86400000;
const db = new DatabaseSync(store, { readOnly: true });

// Projects, their runner files and current shape, from local descriptors.
const descs = db.prepare("select hash, descriptor, recorded_at from environments").all()
  .map((r) => ({ hash: r.hash, at: r.recorded_at, ...JSON.parse(r.descriptor) })).filter((d) => !d.ci);
const shape = (d) => [d.nodeVersion, d.adapterVersion, d.keyFormat, d.runnerVersion, d.platform, d.arch].join("|");
const projects = new Map();
for (const d of descs.sort((a, b) => a.at - b.at)) {
  const p = projects.get(d.project) ?? { files: new Set(), latest: null, descs: [] };
  for (const [f] of d.files) p.files.add(f);
  p.latest = d;
  p.descs.push(d);
  projects.set(d.project, p);
}
for (const p of projects.values()) {
  const cur = shape(p.latest);
  p.current = p.descs.filter((d) => shape(d) === cur);
  // The current shape began at the first descriptor recorded with it, after the last one without it.
  const lastOther = Math.max(0, ...p.descs.filter((d) => shape(d) !== cur).map((d) => d.at));
  p.shapeStart = Math.min(...p.current.filter((d) => d.at > lastOther).map((d) => d.at));
}

// Asker's test files per project.
const asker = db.prepare("select id from worktrees where root = ?").get(askerRoot)?.id;
const weight = new Map(db.prepare("select project, count(*) n from test_file_keys where worktree_id = ? group by 1").all(asker).map((r) => [r.project, r.n]));

// Git-held inputs at a commit.
const treeCache = new Map();
const blobsAt = (sha, paths) => {
  let t = treeCache.get(sha);
  if (!t) {
    t = new Map();
    for (const line of git("ls-tree", "-r", "--full-tree", sha).split("\n")) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
      if (m) t.set(m[2], m[1]);
    }
    treeCache.set(sha, t);
  }
  return paths.map((p) => t.get(p) ?? null);
};
const linked = (l, n) => { const i = /^( +)specifier: /.exec(l)?.[1]; return i !== undefined && n.startsWith(`${i}version: link:`); };
const installedCache = new Map();
const installedOf = (blob) => {
  if (blob === null) return "none";
  if (!installedCache.has(blob)) {
    const text = git("cat-file", "blob", blob);
    const docs = text.split(/^---\n/m);
    const second = docs.length > 2 ? docs[2] : text;
    const l = second.split("\n");
    const filtered = l.filter((x, i) => !linked(x, l[i + 1] ?? "")).join("\n");
    installedCache.set(blob, createHash("sha256").update("node_modules/.pnpm/lock.yaml\0").update(`squeal-installed/2\0${filtered}`).digest("hex"));
  }
  return installedCache.get(blob);
};
const PIN = [".node-version", ".nvmrc", ".tool-versions"];
// The asker's runner files: the descriptor its daemon keys the project with
// now. X is "determined" (018) when X holds the same blobs at these paths and
// the same lockfile; a path X's config would add needs an import changed in
// one of these, so a difference shows.
const askerEnv = new Map(db.prepare("select w.project, e.descriptor from worktree_environment_hashes w join environments e on e.hash = w.hash where w.worktree_id = ?").all(asker).map((r) => [r.project, JSON.parse(r.descriptor)]));
const inputs = (sha, project) => {
  const paths = askerEnv.get(project).files.map(([f]) => f);
  const [lock] = blobsAt(sha, ["pnpm-lock.yaml"]);
  return { runner: blobsAt(sha, paths).join(","), lock, pin: blobsAt(sha, PIN).join(","), paths };
};

// Clean heads daemons had, by time.
// Revisions of removed worktrees are pruned, so clean result labels written
// by a local worktree (not an import) count as seen too. A lower bound: a
// daemon that ran nothing at a commit leaves no label.
let imported = new Set();
try { imported = new Set(db.prepare("select id from imports").all().map((r) => r.id)); } catch {}
let labels = [];
try {
  labels = db.prepare("select commit_sha as head, worktree_id, first_at as created_at from clean_labels").all()
    .filter((r) => !r.worktree_id.startsWith("import") && !imported.has(r.worktree_id));
} catch {}
const heads = [...db.prepare("select head, created_at from revisions where dirty = 0 and head is not null").all(), ...labels];

const commits = git("log", "--first-parent", `--since=${Math.floor(since / 1000)}`, "--format=%H %ct", tip).trim().split("\n").map((l) => { const [sha, t] = l.split(" "); return { sha, time: Number(t) * 1000 }; });
const tally = {};
const add = (k, w) => { tally[k] = (tally[k] ?? 0) + w; };
const perCommit = [];
const diffPaths = new Map();
for (const [project, p] of projects) {
  const w = weight.get(project) ?? 0;
  if (w === 0 || !askerEnv.has(project)) continue;
  const tipIn = inputs(tip, project);
  const seenC = new Set(heads.filter((h) => h.created_at >= p.shapeStart).map((h) => h.head));
  const seenAny = new Set(heads.map((h) => h.head));
  for (const { sha, time } of commits) {
    const x = inputs(sha, project);
    add("files", w);
    const runnerEq = x.runner === tipIn.runner, lockEq = x.lock === tipIn.lock, pinEq = x.pin === tipIn.pin;
    if (!pinEq) add("pin differs (not a key input)", w);
    if (runnerEq && lockEq) { add("same environment as the tip", w); continue; }
    add("not determined", w);
    if (!runnerEq) {
      add("nd: runner files differ", w);
      if (!lockEq) add("nd: runner files and lockfile differ", w);
      const a = x.runner.split(","), b = tipIn.runner.split(",");
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffPaths.set(`${project}:${x.paths[i]}`, (diffPaths.get(`${project}:${x.paths[i]}`) ?? 0) + w);
    } else add("nd: lockfile only", w);
    const derive = runnerEq && !lockEq;
    const recordC = seenC.has(sha);
    const recordCAnyShape = seenAny.has(sha);
    const inst = installedOf(x.lock);
    const matching = new Set(p.current.filter((d) => d.installedDependencies === inst && d.files.every(([f, h]) => (blobsAt(sha, [f])[0]) === h)).map((d) => d.hash));
    const recordI = matching.size > 0;
    // More than one hash with equal git-held inputs: the config read something else (018 D1 parts), so the match is not exact.
    if (matching.size > 1) add("record by inputs: ambiguous (more than one hash)", w);
    if (matching.size === 1) add("resolved: record by inputs, one hash", w);
    if (derive) add("resolved: derive", w);
    if (recordC) add("resolved: record by commit", w);
    if (recordCAnyShape) add("resolved: record by commit, any shape", w);
    if (recordI) add("resolved: record by inputs (existing table)", w);
    if (derive || recordI) add("resolved: derive or record by inputs", w);
    if (derive || recordI || recordC) add("resolved: any of the three", w);
    perCommit.push({ project, sha: sha.slice(0, 9), ageDays: +((now - time) / 86400000).toFixed(2), runnerEq, lockEq, pinEq, derive, recordC, recordI, matches: matching.size });
  }
}
const files = tally.files;
const nd = tally["not determined"] ?? 0;
const pct = (v, of) => `${((100 * (v ?? 0)) / of).toFixed(1)}%`;
const out = { tip: tip.slice(0, 9), commits: commits.length, projects: Object.fromEntries([...projects].map(([k, p]) => [k, { files: weight.get(k) ?? 0, runnerFiles: p.files.size, shapeStart: new Date(p.shapeStart).toISOString(), currentDescriptors: p.current.length }])), fileCommitPairs: files, counts: tally, shareOfAll: {}, shareOfNotDetermined: {} };
for (const [k, v] of Object.entries(tally)) { out.shareOfAll[k] = pct(v, files); if (k.startsWith("resolved") || k.startsWith("nd:")) out.shareOfNotDetermined[k] = nd ? pct(v, nd) : "n/a"; }
out.runnerPathsDiffering = Object.fromEntries([...diffPaths].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, pct(v, files)]));
console.log(JSON.stringify(out, null, 1));
console.error(perCommit.map((r) => JSON.stringify(r)).join("\n"));
