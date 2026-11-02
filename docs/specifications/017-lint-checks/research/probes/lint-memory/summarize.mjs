// Throwaway probe for research 017-26: prints a stages.jsonl or a daemon inside.jsonl as a table.
//   node summarize.mjs stages <stages.jsonl>   |   node summarize.mjs daemon <inside.jsonl>
import { readFileSync } from "node:fs";
const [kind, file] = process.argv.slice(2);
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const r = (v) => (v === undefined || v === null ? "-" : String(Math.round(v)));
if (kind === "stages") {
  console.log("label\tstage\tload\tRSS\tpeak\tworkerLive\tworkerBeforeGc\tworkerPhys\theap256\tanonOther\tglibc\tfile\tcpuS\textra");
  for (const d of lines) {
    const skip = new Set(["label", "stage", "s", "load1", "rssMiB", "hwmMiB", "anonMiB", "worker", "workerBeforeGc", "pauseMs", "smaps", "driverHeapMiB", "cpuS", "oldMb"]);
    const extra = Object.fromEntries(Object.entries(d).filter(([k]) => !skip.has(k)));
    const sm = d.smaps ?? {};
    console.log([d.label, d.stage, d.load1 ?? "-", r(d.rssMiB), r(d.hwmMiB), r(d.worker?.usedMiB), r(d.workerBeforeGc?.usedMiB), r(d.worker?.physicalMiB), r(sm.heap256), r(sm.anonOther), r(sm.glibc), r(sm.file), d.cpuS ?? "-", JSON.stringify(extra)].join("\t"));
  }
} else {
  // Daemon: marks, GCs, worker starts and exits, plus the sample with the highest RSS.
  let peak = null;
  console.log("t\tlabel\tload\tRSS\tpeak\tmainUsed\tmainPhys\tlintUsed\tlintPhys\tnote");
  const row = (d, note = "") => {
    const w = d.lint?.[0] ?? {};
    console.log([d.t.slice(11, 19), d.label, d.load1, r(d.rssMiB), r(d.hwmMiB), r(d.main?.usedMiB), r(d.main?.physicalMiB), r(w.usedMiB), r(w.physicalMiB), note].join("\t"));
  };
  for (const d of lines) {
    if (!peak || d.rssMiB > peak.rssMiB) peak = d;
    if (d.label === "tick") continue;
    let note = "";
    if (d.workers) note = `main ${r(d.mainBefore?.usedMiB)}->${r(d.main?.usedMiB)} (${d.mainPauseMs} ms); lint ${d.workers.map((w) => `${r(w.before?.usedMiB)}->${r(w.after?.usedMiB)} used, phys ${r(w.after?.physicalMiB)} (${w.pauseMs} ms)`).join(", ")}`;
    if (d.code !== undefined) note = `exit ${d.code}`;
    row(d, note);
  }
  if (peak) row(peak, "the sample with the highest RSS");
}
