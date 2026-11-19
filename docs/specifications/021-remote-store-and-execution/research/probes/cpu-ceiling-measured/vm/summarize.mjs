// summarize.mjs <label>...: one JSON row per arm from $OUT/<label>.{timeline.json,tsv,refusals.json,load.txt,edits.tsv}.
// total = edit to the last run's end; background = edit to the end of the last Vitest run of more than 4 files (a
// backlog tier: edit tiers and the run-loop lane's tiers hold at most 4); CPU-s = the scope's (daemon and every test
// process) and the daemon's own between the first sample after the edit and the last sample at or before the last
// run's end; busy CPUs from the 2 s /proc/stat samples in that span.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const OUT = process.env.OUT;
for (const label of process.argv.slice(2)) {
  const tl = JSON.parse(readFileSync(join(OUT, `${label}.timeline.json`), "utf8"));
  const rf = JSON.parse(readFileSync(join(OUT, `${label}.refusals.json`), "utf8"));
  const e0 = Number(readFileSync(join(OUT, `${label}.edits.tsv`), "utf8").split("\t")[0]);
  const rows = readFileSync(join(OUT, `${label}.tsv`), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
  const total = tl.lastRunEndS;
  const backlog = tl.vitestRunList.filter((r) => r.files > 4 && r.end !== null);
  const bgEnd = Math.max(...backlog.map((r) => r.end));
  const span = rows.filter((r) => r[0] >= e0 && r[0] <= e0 + total * 1000);
  const before = rows.filter((r) => r[0] < e0).at(-1) ?? span[0];
  const last = span.at(-1);
  const busy = span.map((r) => r[2]);
  const load = readFileSync(join(OUT, `${label}.load.txt`), "utf8").split("\n").filter((l) => l.includes("load average")).map((l) => l.replace(/.*load average: /, ""));
  const daemonLines = tl.log.filter((l) => /refused|ceiling/.test(l)).length;
  console.log(JSON.stringify({
    label, totalS: total, backgroundS: bgEnd, backlogTiers: backlog.length, firstBacklogStartS: backlog[0]?.start ?? null,
    nodeLaneEndS: tl.lastNodeEnd, distinctFinished: tl.distinctFinished, fileRuns: tl.fileRunsFinished,
    scopeCpuS: Math.round(last[3] - before[3]), daemonCpuS: Math.round(last[4] - before[4]),
    busyMean: +(busy.reduce((a, b) => a + b, 0) / busy.length).toFixed(2), busyPeak: Math.max(...busy),
    busyP90: [...busy].sort((a, b) => a - b)[Math.floor(busy.length * 0.9)],
    load1Mean: +(span.reduce((a, r) => a + r[1], 0) / span.length).toFixed(2), load1Max: Math.max(...span.map((r) => r[1])),
    loadBeforeAfter: load, refusals: rf.count, refusalBusy: rf.busy, refusalHeldS: rf.heldTotalS, refusalEpisodes: rf.episodes.length,
    hbMaxMs: tl.hb.max, logLinesNamingCeiling: daemonLines,
  }));
}
