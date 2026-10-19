// THROWAWAY probe (011-core/research/backlog-wall-budget.md). Summarizes results/<arm>.json:
// the forced backlog's tiers per lane (after the forced checkpoint began), its wall time, the
// edit delays and the one-minute load at each mark.
import { readFileSync } from "node:fs";
for (const arm of ["today-noedit", "today-edit", "proto-noedit", "proto-edit"]) {
  let r;
  try { r = JSON.parse(readFileSync(new URL(`results/${arm}.json`, import.meta.url))); } catch { continue; }
  console.log(`${arm}: forced checkpoint ${r.forcedWallS.toFixed(0)} s; edit delay ${JSON.stringify(r.editDelayS)}`);
  console.log(`  load: ${r.log.map((l) => `${l.what.split(" ")[0]}@${l.at.toFixed(0)}s=${l.load}`).join(", ")}`);
  for (const lane of ["vitest", "node-test"]) {
    const tiers = r.runs.filter((t) => t.lane === lane && t.start >= 0);
    console.log(`  ${lane}: ${tiers.map((t) => `${t.files.length}f ${t.start.toFixed(0)}-${t.end === null ? "?" : t.end.toFixed(0)}${t.files.some((f) => f.includes("quick")) ? "q" : ""}`).join(" | ")}`);
  }
}
