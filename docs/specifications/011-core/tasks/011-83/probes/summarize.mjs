// Prints the summary of a host-snapshot.mjs log: node summarize.mjs logs/snapshot-N.json
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { daemons, pool, ...rest } = r;
console.log(JSON.stringify(rest));
console.log("permits held", pool.permitsHeldStart, "->", pool.permitsHeldEnd, pool.holdersEnd.map((h) => `${h.file}:${h.pid}`).join(" "));
console.log("fresh marks", pool.marksEnd.filter((m) => m.fresh).map((m) => `${m.id} want ${m.want} grant ${m.grant} since ${m.since}${m.slow ? " slow" : ""}`).join("; "));
for (const d of daemons) {
  if (d.slotProcesses === 0 && d.treeCores < 0.2) continue;
  const wt = (d.worktree ?? "").replace("/home/agent/projects/", "").replace(/\.ai\/cezar\/worktrees\/(\w{8})[\w-]*/, "$1");
  const below = Object.entries(d.belowComms).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}x${n}`).join(",");
  console.log(`${d.pid} ${d.scratch ? "scratch" : d.version} ${wt} slots ${d.slotProcesses} ${JSON.stringify(d.lanes)} below ${d.processesBelowSlots} [${below}] tree ${d.treeCores} own ${d.daemonOwnCores} permits ${d.permits.pool}+${d.permits.slow}slow mark ${d.mark ? `${d.mark.want}/${d.mark.grant}` : "none"}`);
}
