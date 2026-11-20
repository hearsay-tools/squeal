// arms.mjs <out dir> <label>... (011-416): one line per arm from its timeline.json, load.txt,
// edits.tsv and tsv. Times are seconds after the first edit. edit tiers end: the end of the last
// run before the first backlog tier (a vitest run of more than 4 files, tierSize 4); catch-up start:
// that tier's start; drain: the last run's end. cpu: CPU-s of the probe's systemd scope (daemon and
// every test process) over the sampled window; busy: mean busy cores of the whole VM. Cut file
// runs: picked minus finished; runs not completed are listed with their state.
import { readFileSync, existsSync } from "node:fs";
const [, , out, ...labels] = process.argv;
for (const label of labels) {
  const f = (s) => `${out}/${label}.${s}`;
  if (!existsSync(f("timeline.json"))) { console.log(JSON.stringify({ label, missing: true })); continue; }
  const t = JSON.parse(readFileSync(f("timeline.json"), "utf8"));
  const runs = t.vitestRunList;
  const bi = runs.findIndex((r) => r.files > 4);
  const edits = readFileSync(f("edits.tsv"), "utf8").trim().split("\n").map((l) => Number(l.split("\t")[0]));
  const load = readFileSync(f("load.txt"), "utf8").split("\n")[1]?.match(/load average: ([\d.]+)/)?.[1];
  const tsv = readFileSync(f("tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
  const base = tsv.filter((r) => r[0] < edits[0]).map((r) => r[2]);
  console.log(JSON.stringify({
    label, loadBefore: Number(load), idleBusyBefore: base.length ? +(base.reduce((a, b) => a + b, 0) / base.length).toFixed(2) : null,
    secondEditS: edits[1] ? +((edits[1] - edits[0]) / 1000).toFixed(1) : null,
    firstRunS: runs[0]?.start, editTiersEndS: bi > 0 ? Math.max(...runs.slice(0, bi).map((r) => r.end)) : null, catchUpStartS: bi >= 0 ? runs[bi].start : null,
    drainS: t.lastRunEndS, filesFinished: t.distinctFinished, cutFileRuns: t.fileRunsPicked - t.fileRunsFinished,
    vitestRuns: t.vitestRuns, nodeRuns: t.nodeRuns, notCompleted: runs.filter((r) => r.state !== "completed").map((r) => ({ start: r.start, end: r.end, files: r.files, finished: r.finished, state: r.state })),
    cpuS: t.cpu.scopeCpuS, daemonCpuS: t.cpu.daemonCpuS, meanBusy: t.cpu.meanBusy, maxLoad1: t.cpu.maxLoad1,
  }));
}
