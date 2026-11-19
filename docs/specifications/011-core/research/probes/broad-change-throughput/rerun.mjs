// rerun.mjs <label>: for an experiment with several edits, per edit window:
// file runs picked and finished, the files a cancelled run left unfinished,
// files finished in an earlier window that ran again later (work the next
// edit re-keyed), and the permits held (pool.N.lock files, $OUT/<label>.permits.txt)
// during each backlog tier. Reads $OUT/<label>.timeline.json's inputs again.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const label = process.argv[2];
const OUT = process.env.OUT, REPO = process.env.SQ_REPO;
const read = (f) => readFileSync(join(OUT, f), "utf8");
const t0 = Number(read(`${label}.t0`)), t1 = Number(read(`${label}.t1`));
const edits = read(`${label}.edits.tsv`).trim().split("\n").map((l) => Number(l.split("\t")[0]));
const e0 = edits[0];
const s = (ms) => +((ms - e0) / 1000).toFixed(1);
const db = new DatabaseSync(join(REPO, ".git/squeal/store.sqlite"), { readOnly: true });
const runs = db.prepare("select * from runs where started_at >= ? and started_at <= ? order by started_at").all(t0, t1).map((r) => {
  const files = JSON.parse(r.test_files).map((f) => `${f.project}|${f.path}`);
  const rep = join(r.log_dir, "report.json");
  const nodeTest = existsSync(join(r.log_dir, "node-test"));
  let done = [];
  if (existsSync(rep)) done = (JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? []).map((d) => [`${d.testFile.project}|${d.testFile.path}`, d.durationMs / 1000]);
  else if (nodeTest && r.end_state === "completed") done = files.map((f) => [f, (r.ended_at - r.started_at) / 1000 / files.length]);
  return { id: r.id.slice(0, 8), rev: r.revision, start: r.started_at, end: r.ended_at, files, done, nodeTest };
});
const permits = existsSync(join(OUT, `${label}.permits.txt`)) ? read(`${label}.permits.txt`).trim().split("\n").map((l) => l.split(" ").map(Number)) : [];
const meanPermits = (a, b) => { const p = permits.filter(([t]) => t >= a && t <= b); return p.length ? +(p.reduce((x, [, n]) => x + n, 0) / p.length).toFixed(1) : null; };
const windows = edits.map((e, i) => [e, edits[i + 1] ?? t1]);
const out = { windows: [], backlog: [] };
const finishedBefore = new Map(); // file -> seconds of its last finished run before the window
for (const [a, b] of windows) {
  const inW = runs.filter((r) => r.start >= a && r.start < b);
  const fin = inW.flatMap((r) => r.done);
  const rerun = fin.filter(([f]) => finishedBefore.has(f));
  const unfinished = inW.filter((r) => r.done.length < r.files.length && r.end !== null)
    .map((r) => ({ id: r.id, startS: s(r.start), endS: s(r.end), files: r.files.length, finished: r.done.length, wallS: +((r.end - r.start) / 1000).toFixed(1) }));
  out.windows.push({ fromS: s(a), toS: s(b), runs: inW.length, picked: inW.reduce((x, r) => x + r.files.length, 0), finished: fin.length,
    finishedS: Math.round(fin.reduce((x, [, d]) => x + d, 0)), finishedEarlierAndRunAgain: rerun.length,
    theirEarlierS: Math.round(rerun.reduce((x, [f]) => x + finishedBefore.get(f), 0)), cancelledWithUnfinished: unfinished });
  for (const [f, d] of fin) finishedBefore.set(f, d);
}
for (const r of runs.filter((r) => !r.nodeTest && r.files.length > 4 && r.end))
  out.backlog.push({ id: r.id, startS: s(r.start), files: r.files.length, wallS: +((r.end - r.start) / 1000).toFixed(1),
    sumS: Math.round(r.done.reduce((x, [, d]) => x + d, 0)), effW: +(r.done.reduce((x, [, d]) => x + d, 0) / ((r.end - r.start) / 1000)).toFixed(2), meanPermits: meanPermits(r.start, r.end) });
const find = (f) => runs.filter((r) => r.files.includes(f)).map((r) => ({ id: r.id, startS: s(r.start), endS: r.end && s(r.end), files: r.files.length, done: r.done.some(([g]) => g === f) }));
out.named = Object.fromEntries((process.argv[3] ?? "").split(",").filter(Boolean).map((f) => [f, find(f)]));
out.smallTiers = windows.map(([a, b]) => { const sm = runs.filter((r) => !r.nodeTest && r.files.length <= 4 && r.start >= a && r.start < b);
  const rl = sm.flatMap((r) => r.files).filter((f) => /parity.*\.test\.ts$|\/worker-[^/]*\.test\.ts$/.test(f)).length;
  return { fromS: s(a), tiers: sm.length, files: sm.reduce((x, r) => x + r.files.length, 0), runLoopFiles: rl }; });
console.log(JSON.stringify(out, null, 1));
