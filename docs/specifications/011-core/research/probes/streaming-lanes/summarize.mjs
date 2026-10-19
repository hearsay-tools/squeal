// THROWAWAY probe (011-core/research/streaming-lanes.md). Summarizes results/<arm>.json: the forced
// backlog's wall time, the edit's start and current delays, the load range, and the tiers
// (files, start-end s; `q` marks a tier holding the quick file) of the forced checkpoint.
import { readFileSync } from "node:fs";
for (const arm of ["heavy-today", "heavy-w1", "heavy-stream-lane-mark", "heavy-stream", "heavy-stream-over", "heavy-w1-drain", "heavy-w1-kill", "heavy-w1-beside", "light-today", "light-stream"]) {
  let r;
  try { r = JSON.parse(readFileSync(new URL(`results/${arm}.json`, import.meta.url))); } catch { continue; }
  const forced = r.runs.filter((t) => t.start >= 0);
  const files = forced.reduce((a, t) => a + t.files.length, 0);
  console.log(`${arm}: backlog ${r.forcedWallS.toFixed(1)} s, ${forced.length} runs of ${files} files; edit ${r.edit === null ? "none" : `started ${r.edit.startAfterS.toFixed(1)} s, current ${r.edit.currentAfterS.toFixed(1)} s after it`}; load ${r.load.min} to ${r.load.max}`);
  if (forced.length <= 30) console.log(`  ${forced.map((t) => `${t.files.length}f ${t.start.toFixed(0)}-${t.end === null ? "?" : t.end.toFixed(0)}${t.files.some((f) => f.includes("quick")) ? "q" : ""}`).join(" | ")}`);
}
