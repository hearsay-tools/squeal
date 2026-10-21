// 011-82 probe: what a cancel keeps under Vitest's order (longest first) and
// under Squeal's (the order it picked, shortest first). Read-only.
// Usage: node order.mjs <store.sqlite> <runs-dir> <hours> <tiers.json from tiers.mjs> [out.json]
//
// Model, per large Vitest tier with a report:
// - last-known duration of a file: the median of its `fileDurations` in every
//   report under <runs-dir>; a file with none is "unknown" (Vitest runs it first).
// - W: the tier's average concurrency, sum of its ended files' reported
//   durations over its wall, from the uncancelled large tiers of the same
//   worktree (median), at least 2; the store's median when it has none.
// - s: the tier's slowdown, median of reported / last-known over its ended
//   files; the store's median when none ended.
// - list scheduling at W of durations x s, cut at the cancel (wall - 1 s);
//   a file ends when its run ends before the cut.
// A file ended under the model is stored unless a revision during the run
// changed a path of its closure (tiers.mjs's `rekeyed`).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [, , storePath, runsDir, hours = "24", tiersPath, out] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const since = Date.now() - Number(hours) * 3600_000;
const id = (r) => `${r.project}\u0000${r.path}`;
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Last-known durations from every report kept.
const seen = new Map();
const reports = new Map();
for (const d of readdirSync(runsDir)) {
  const p = join(runsDir, d, "report.json");
  if (!existsSync(p)) continue;
  let r;
  try {
    r = JSON.parse(readFileSync(p, "utf8")).report;
  } catch {
    continue;
  }
  reports.set(d, r);
  for (const f of r.fileDurations ?? []) {
    const k = id(f.testFile);
    const list = seen.get(k) ?? [];
    list.push(f.durationMs);
    seen.set(k, list);
  }
}
const known = new Map([...seen].map(([k, v]) => [k, median(v)]));

const tiers = JSON.parse(readFileSync(tiersPath, "utf8")).rows;
const byId = new Map(tiers.map((t) => [t.id, t]));
const runs = db
  .prepare(
    `SELECT id, worktree_id, test_files, started_at, ended_at FROM runs
     WHERE started_at >= ? AND ended_at IS NOT NULL ORDER BY started_at`,
  )
  .all(since);
const revsOf = db.prepare(
  `SELECT changes FROM revisions WHERE worktree_id = ? AND created_at > ? AND created_at <= ?`,
);
const closures = new Map();
for (const r of db.prepare("SELECT project, path, closure_paths FROM test_files").all())
  closures.set(id(r), new Set(JSON.parse(r.closure_paths)));
for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) {
  const project = m.key.slice("observed.".length);
  for (const [path, reads] of Object.entries(JSON.parse(m.value))) {
    const set = closures.get(id({ project, path })) ?? new Set();
    for (const p of reads) set.add(p);
    closures.set(id({ project, path }), set);
  }
}
const ENV = /(^|\/)(package\.json|package-lock\.json|\.package-lock\.json|vitest\.config\.[cm]?[jt]s|squeal\.config\.json|tsconfig[^/]*\.json)$/;

/** Ends of `durations` (in the given order) over `w` workers, list scheduling. */
function ends(durations, w) {
  const free = Array.from({ length: Math.max(1, w) }, () => 0);
  return durations.map((d) => {
    let i = 0;
    for (let j = 1; j < free.length; j++) if (free[j] < free[i]) i = j;
    free[i] += d;
    return free[i];
  });
}

const rows = [];
for (const run of runs) {
  const t = byId.get(run.id.slice(0, 8));
  if (!t || t.files < 13 || !t.report) continue;
  const report = reports.get(run.id);
  if (!report) continue;
  const files = JSON.parse(run.test_files);
  const endedIds = new Set([...(report.completedFiles ?? []), ...(report.withheld ?? [])].map(id));
  const actual = new Map((report.fileDurations ?? []).map((f) => [id(f.testFile), f.durationMs]));
  const ratios = [];
  let endedSum = 0;
  for (const f of files) {
    const a = actual.get(id(f));
    if (a === undefined) continue;
    endedSum += a;
    const k = known.get(id(f));
    if (k && k > 0) ratios.push(a / k);
  }
  const changed = new Set();
  for (const rev of revsOf.all(run.worktree_id, run.started_at, run.ended_at))
    for (const c of JSON.parse(rev.changes)) changed.add(typeof c === "string" ? c : c.path);
  const env = [...changed].some((p) => ENV.test(p));
  const rekeyed = (f) => env || [...(closures.get(id(f)) ?? [])].some((p) => changed.has(p));
  rows.push({
    id: t.id,
    worktree: t.worktree,
    at: t.at,
    wallS: t.wallS,
    cancelled: t.cancelled,
    cause: t.cause,
    files: files.map((f) => ({
      k: id(f),
      d: known.get(id(f)) ?? null,
      ended: endedIds.has(id(f)),
      rekeyed: rekeyed(f),
    })),
    observedEnded: endedIds.size,
    observedStored: t.storedEnded,
    concurrency: t.wallS > 0 ? endedSum / 1000 / t.wallS : null,
    slowdown: median(ratios),
    tierRekeyed: files.filter(rekeyed).length,
  });
}

const storeS = median(rows.map((r) => r.slowdown).filter((x) => x !== null)) ?? 1;
const fillOf = (r) => median(r.files.map((f) => f.d).filter((d) => d !== null)) ?? 1000;
const durOf = (r, s) => (f) => ((f.d ?? fillOf(r)) * s) / 1000;
// Vitest: unknown first, then longest first. Squeal: the order it picked.
const vitestOrder = (r) =>
  [...r.files].sort((a, b) =>
    (a.d === null) !== (b.d === null) ? (a.d === null ? -1 : 1) : (b.d ?? 0) - (a.d ?? 0),
  );
// W per worktree: the width at which Vitest's order of each uncancelled tier
// ends nearest its measured wall (median over the worktree's tiers).
const fitW = (r) => {
  const d = vitestOrder(r).map(durOf(r, r.slowdown ?? storeS));
  let best = 1;
  for (let w = 1; w <= 23; w++) {
    const err = (x) => Math.abs(Math.max(0, ...ends(d, x)) - r.wallS);
    if (err(w) < err(best)) best = w;
  }
  return best;
};
const wByWorktree = new Map();
for (const r of rows.filter((r) => !r.cancelled)) {
  const list = wByWorktree.get(r.worktree) ?? [];
  list.push(fitW(r));
  wByWorktree.set(r.worktree, list);
}
const storeW = median(rows.filter((r) => !r.cancelled).map(fitW)) ?? 4;

const result = [];
for (const r of rows) {
  const w = Math.max(2, Math.round(median(wByWorktree.get(r.worktree) ?? []) ?? storeW));
  const s = r.slowdown ?? storeS;
  const vitest = vitestOrder(r);
  const squeal = r.files;
  const dur = durOf(r, s);
  const cut = r.cancelled ? Math.max(0, r.wallS - 1) : Number.POSITIVE_INFINITY;
  const endV = ends(vitest.map(dur), w);
  const endS = ends(squeal.map(dur), w);
  const keep = (list, e) => list.filter((f, i) => e[i] <= cut);
  const keptV = keep(vitest, endV);
  const keptS = keep(squeal, endS);
  result.push({
    id: r.id,
    worktree: r.worktree,
    at: r.at,
    files: r.files.length,
    cancelled: r.cancelled,
    cause: r.cause,
    wallS: r.wallS,
    w,
    s: Math.round(s * 100) / 100,
    observedEnded: r.observedEnded,
    observedStored: r.observedStored,
    modelEndedVitest: keptV.length,
    modelStoredVitest: keptV.filter((f) => !f.rekeyed).length,
    modelEndedSqueal: keptS.length,
    modelStoredSqueal: keptS.filter((f) => !f.rekeyed).length,
    makespanVitestS: Math.round(Math.max(0, ...endV)),
    makespanSquealS: Math.round(Math.max(0, ...endS)),
    tierRekeyed: r.tierRekeyed,
    unknown: r.files.filter((f) => f.d === null).length,
  });
}

function total(list) {
  const t = { tiers: list.length, files: 0, observedEnded: 0, observedStored: 0, modelEndedVitest: 0, modelStoredVitest: 0, modelEndedSqueal: 0, modelStoredSqueal: 0, wallS: 0, makespanVitestS: 0, makespanSquealS: 0, unknown: 0, tiersReachedNone: 0, filesInTiersReachedNone: 0 };
  for (const r of list) {
    for (const k of ["files", "observedEnded", "observedStored", "modelEndedVitest", "modelStoredVitest", "modelEndedSqueal", "modelStoredSqueal", "wallS", "makespanVitestS", "makespanSquealS", "unknown"]) t[k] += r[k];
    if (r.tierRekeyed === 0) {
      t.tiersReachedNone++;
      t.filesInTiersReachedNone += r.files;
    }
  }
  t.wallS = Math.round(t.wallS);
  return t;
}
const summary = {
  store: storePath,
  storeW: Math.round(storeW * 10) / 10,
  storeS: Math.round(storeS * 100) / 100,
  cancelled: total(result.filter((r) => r.cancelled)),
  uncancelled: total(result.filter((r) => !r.cancelled)),
};
console.log(JSON.stringify(summary, null, 1));
if (out) writeFileSync(out, `${JSON.stringify({ summary, tiers: result }, null, 1)}\n`);
