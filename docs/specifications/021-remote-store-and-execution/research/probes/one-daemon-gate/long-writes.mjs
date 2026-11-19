// Throwaway (row 021-17). Reads D3's long-write lines from the daemon logs
// (<commonDir>/squeal/logs/daemon-*.log and .log.1, deduplicated) and
// classifies each hold as a prune hold or not. A prune hold: a frame that
// names the prune (pruneCodeStore, pruneSlices, deleteInBatches, vacuum,
// dropOrphanLoadedModules), or an anonymous bundle frame run by
// withBusySliceSync, which in 0.1.563 is only the sliced prune driver's
// slices (checked line by line: deleteInBatches, dropOrphanLoadedModules and
// pruneSlices' checks delete); for earlier releases that mapping is inferred.
import { readFileSync, readdirSync } from "node:fs";
const LINE = /^(\S+) \[(\d+)\] squeal daemon: long write: (\S+) write lock held (\d+) ms by (.+?); (\d+) rows? written/;
const PRUNE = /prune|vacuum|deleteInBatches|dropOrphan/i;
export const isPrune = (op) => PRUNE.test(op) || /^squeal\.mjs:\d+ < AsyncLocalStorage\.run < withBusySliceSync/.test(op);
export function longWrites(commonDir, since, until) {
  const project = commonDir.replace(/^.*\/projects\//, "").replace(/\/\.git\/squeal.*$/, "");
  const seen = new Set(); const out = [];
  for (const f of readdirSync(`${commonDir}/logs`)) {
    if (!/^daemon-.*\.log(\.1)?$/.test(f)) continue;
    for (const line of readFileSync(`${commonDir}/logs/${f}`, "utf8").split("\n")) {
      const m = LINE.exec(line); if (!m || seen.has(line)) continue; seen.add(line);
      const end = Date.parse(m[1]); if (end < since || end - Number(m[4]) >= until) continue;
      out.push({ project, db: m[3], pid: m[2], start: end - Number(m[4]), end, ms: Number(m[4]), op: m[5], rows: Number(m[6]), prune: isPrune(m[5]) });
    }
  }
  return out;
}
