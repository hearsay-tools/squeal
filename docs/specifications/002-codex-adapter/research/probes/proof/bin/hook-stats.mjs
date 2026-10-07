// Throwaway: from cz.mjs logs, every Squeal plugin hook run as Codex reported
// it in hook/completed: count, status, and duration p50/p95/max per event.
//   node hook-stats.mjs <as.jsonl>...
import { readFileSync } from "node:fs";

const runs = new Map();
const statuses = new Map();
for (const f of process.argv.slice(2)) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line) continue;
    const { msg } = JSON.parse(line);
    if (msg?.method !== "hook/completed" || msg.params?.run?.source !== "plugin") continue;
    const { eventName, status, durationMs } = msg.params.run;
    runs.set(eventName, [...(runs.get(eventName) ?? []), durationMs]);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
}
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
console.log(`statuses: ${JSON.stringify(Object.fromEntries(statuses))}`);
console.log("event               n   p50   p95   max (ms)");
for (const [e, xs] of [...runs].sort()) {
  xs.sort((a, b) => a - b);
  console.log(
    `${e.padEnd(18)} ${String(xs.length).padStart(3)} ${String(pct(xs, 50)).padStart(5)} ${String(pct(xs, 95)).padStart(5)} ${String(xs.at(-1)).padStart(5)}`,
  );
}
