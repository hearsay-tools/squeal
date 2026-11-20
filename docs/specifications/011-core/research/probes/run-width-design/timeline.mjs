// timeline.mjs <label>: where the wall time of one experiment went. Reads
// $OUT/<label>.{t0,t1,edits.tsv,tsv,queue.tsv}, the clone's store (runs and
// their reports) and the daemon log. Prints JSON: the edits, every run after
// t0 (start, end, files, finished, summed file s, Vitest width), the gaps
// with no run open while files were queued, pool-wait log lines, heartbeat
// ages, CPU of the scope and of the daemon, busy cores, and the queue over
// time (queued count each 60 s). Times are seconds after the first edit.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const label = process.argv[2];
const OUT = process.env.OUT, REPO = process.env.SQ_REPO;
const read = (f) => readFileSync(join(OUT, f), "utf8");
const tsv = (f) => read(f).trim().split("\n").slice(1).map((l) => l.split("\t"));
const t0 = Number(read(`${label}.t0`));
const t1 = existsSync(join(OUT, `${label}.t1`)) ? Number(read(`${label}.t1`)) : Date.now();
const edits = read(`${label}.edits.tsv`).trim().split("\n").map((l) => l.split("\t"));
const e0 = Number(edits[0][0]);
const s = (ms) => +((ms - e0) / 1000).toFixed(1);
const db = new DatabaseSync(join(REPO, ".git/squeal/store.sqlite"), { readOnly: true });
const runs = db.prepare("select * from runs where started_at >= ? and started_at <= ? order by started_at").all(t0, t1).map((r) => {
  const files = JSON.parse(r.test_files);
  const rep = join(r.log_dir, "report.json");
  const nodeTest = existsSync(join(r.log_dir, "node-test"));
  let fin = [], width = null;
  if (existsSync(rep)) fin = JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? [];
  else if (nodeTest && r.end_state === "completed") fin = files.map((f) => ({ testFile: f, durationMs: (r.ended_at - r.started_at) / files.length }));
  const log = join(r.log_dir, "vitest.log");
  if (existsSync(log)) { const m = /maxWorkers[^0-9]*(\d+)/.exec(readFileSync(log, "utf8").slice(0, 4000)); if (m) width = Number(m[1]); }
  return { id: r.id.slice(0, 8), rev: r.revision, lane: nodeTest ? "node" : "vitest", start: s(r.started_at), end: r.ended_at ? s(r.ended_at) : null,
    files: files.length, finished: fin.length, sumS: +(fin.reduce((a, d) => a + d.durationMs, 0) / 1000).toFixed(1), width,
    state: r.end_state, keys: files.map((f) => `${f.project}|${f.path}`), done: fin.map((d) => `${d.testFile.project}|${d.testFile.path}`) };
});
// Vitest lane busy intervals and gaps
const vit = runs.filter((r) => r.lane === "vitest");
const gaps = [];
for (let i = 1; i < vit.length; i++) if (vit[i - 1].end !== null && vit[i].start - vit[i - 1].end > 0.5) gaps.push([vit[i - 1].end, +(vit[i].start - vit[i - 1].end).toFixed(1)]);
// daemon log lines in the window
const logDir = join(REPO, ".git/squeal/logs");
const lines = readdirSync(logDir).flatMap((f) => readFileSync(join(logDir, f), "utf8").split("\n"))
  .filter((l) => { const t = Date.parse(l.slice(0, 24)); return t >= t0 && t <= t1 && !l.includes("coverage: no result"); })
  .map((l) => `${s(Date.parse(l.slice(0, 24)))} ${l.slice(34, 260)}`);
const samp = tsv(`${label}.tsv`).map((r) => r.map(Number));
const q = tsv(`${label}.queue.tsv`);
const hb = q.map((r) => Number(r[1])).filter((x) => Number.isFinite(x));
const firstEnd = (key) => { for (const r of runs) if (r.end !== null && r.done.includes(key)) return r.end; return null; };
const queueEvery60 = q.filter((_, i) => i % 30 === 0).map((r) => [s(Number(r[0])), Number(r[2]), Number(r[3])]);
const allDone = new Set(runs.flatMap((r) => r.done));
const lastEnd = Math.max(...runs.map((r) => r.end ?? 0));
const cpu = samp.length ? { scopeCpuS: +(samp.at(-1)[3] - samp[0][3]).toFixed(0), daemonCpuS: +(samp.at(-1)[4] - samp[0][4]).toFixed(0),
  meanBusy: +(samp.reduce((a, r) => a + r[2], 0) / samp.length).toFixed(2), maxLoad1: Math.max(...samp.map((r) => r[1])),
  meanLoad1: +(samp.reduce((a, r) => a + r[1], 0) / samp.length).toFixed(2), sampleS: +((samp.at(-1)[0] - samp[0][0]) / 1000).toFixed(0) } : null;
console.log(JSON.stringify({
  label, edits: edits.map(([t, p]) => [s(Number(t)), p]), windowS: s(t1), lastRunEndS: lastEnd,
  distinctFinished: allDone.size, fileRunsPicked: runs.reduce((a, r) => a + r.files, 0), fileRunsFinished: runs.reduce((a, r) => a + r.finished, 0),
  vitestRuns: vit.length, nodeRuns: runs.length - vit.length,
  vitestBusyS: +vit.reduce((a, r) => a + ((r.end ?? s(t1)) - r.start), 0).toFixed(1), vitestSumFileS: +vit.reduce((a, r) => a + r.sumS, 0).toFixed(1),
  nodeSumFileS: +runs.filter((r) => r.lane === "node").reduce((a, r) => a + r.sumS, 0).toFixed(1),
  firstNodeStart: runs.find((r) => r.lane === "node")?.start ?? null, lastNodeEnd: Math.max(0, ...runs.filter((r) => r.lane === "node").map((r) => r.end ?? 0)),
  gaps, hb: { samples: hb.length, max: Math.max(...hb), over10s: hb.filter((x) => x > 10000).length, over6s: hb.filter((x) => x > 6000).length },
  cpu, queueEvery60, log: lines,
  vitestRunList: vit.map(({ keys, done, ...r }) => r),
  firstEndOf: (process.argv[3] ?? "").split(",").filter(Boolean).map((k) => [k, firstEnd(k)]),
}, null, 1));
