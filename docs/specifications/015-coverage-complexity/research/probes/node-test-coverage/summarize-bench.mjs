// Throwaway (015-76): medians of bench-loop.sh's result file per mode, and each mode against `off`
// in the same round (wall, CPU = user + system of every process).
// usage: node summarize-bench.mjs <bench.txt>
import { readFileSync } from "node:fs";
const runs = readFileSync(process.argv[2], "utf8").split("\n").filter((l) => /^\d+ \w+ load=/.test(l)).map((l) => {
  const [, round, mode, load, wall, user, sys, json] = l.match(/^(\d+) (\w+) load=([\d.]+) time=([\d.]+) ([\d.]+) ([\d.]+) (.*)$/);
  const j = JSON.parse(json);
  return { round: +round, mode, load: +load, wall: +wall, cpu: +user + +sys, files: j.files, failed: j.failed.length, covBytes: j.covBytes, ms: j.ms };
});
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (x) => Math.round(x * 100) / 100;
for (const mode of ["off", "raw", "drop", "event"]) {
  const mine = runs.filter((r) => r.mode === mode);
  const ratio = (k) => mine.map((r) => r[k] / runs.find((o) => o.mode === "off" && o.round === r.round)[k]);
  console.log(JSON.stringify({
    mode, runs: mine.length, failed: mine.reduce((a, r) => a + r.failed, 0),
    load: [Math.min(...mine.map((r) => r.load)), Math.max(...mine.map((r) => r.load))],
    wallMedian: med(mine.map((r) => r.wall)), cpuMedian: r2(med(mine.map((r) => r.cpu))),
    cpuPerFileMs: Math.round(med(mine.map((r) => r.cpu)) / 34 * 1000),
    fileMsMedian: med(mine.flatMap((r) => r.ms)),
    ...(mode === "off" ? {} : { wallRatio: r2(med(ratio("wall"))), wallRatioRange: [r2(Math.min(...ratio("wall"))), r2(Math.max(...ratio("wall")))], cpuRatio: r2(med(ratio("cpu"))), cpuRatioRange: [r2(Math.min(...ratio("cpu"))), r2(Math.max(...ratio("cpu")))] }),
    covMiBPerFile: r2(med(mine.map((r) => r.covBytes)) / 34 / 1048576),
  }));
}
