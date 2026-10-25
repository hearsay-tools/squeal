// 011-223 probe: turns steps.log into one table per run: seconds from `squeal start` to each step, and per step.
// Process start of each pid = epoch ms - s since process start. usage: node steps.mjs <steps.log>
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => {
  const [pid, at, up, step, ...rest] = l.split(" ");
  // Lines the shell scripts write: "<epoch ms> 0 0 <step> ...".
  if (at === "0" && up === "0") return { pid: "0", at: Number(pid), up: 0, step, rest: rest.join(" ") };
  return { pid, at: Number(at), up: Number(up), step, rest: rest.join(" ") };
});
let run = null;
const runs = [];
for (const l of lines) {
  if (l.step === "run-begin") { run = { label: l.rest.split(" ")[0], begin: l.at, load: l.rest.split("load=")[1], steps: [] }; runs.push(run); continue; }
  if (!run) continue;
  if (l.step === "status-listed") run.loadEnd = l.rest.split("load=")[1];
  const daemon = l.rest.startsWith("daemon") || (l.pid !== "0" && !["start", "status", "stop"].includes(l.rest.split(" ")[0]));
  if (l.pid !== "0" && !daemon) continue;
  if (l.step === "module-eval" && daemon) run.steps.push({ step: "daemon-process-start", at: l.at - l.up * 1000 });
  run.steps.push({ step: l.step, at: l.at });
}
for (const r of runs) {
  console.log(`\n${r.label}: load ${r.load} at start, ${r.loadEnd} when listed`);
  let prev = r.begin;
  const seen = new Set();
  for (const s of r.steps.sort((a, b) => a.at - b.at)) {
    if (seen.has(s.step) && !["integrity-begin", "integrity-end"].includes(s.step)) continue;
    seen.add(s.step);
    console.log(`  ${((s.at - r.begin) / 1000).toFixed(2).padStart(7)} s  +${((s.at - prev) / 1000).toFixed(2).padStart(6)}  ${s.step}`);
    prev = s.at;
  }
}
