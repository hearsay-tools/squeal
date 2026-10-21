// Tabulates host-snapshot.mjs logs: node series-table.mjs logs/series/*.json
import { readFileSync } from "node:fs";
const rows = [];
const perProcess = [];
for (const path of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(path, "utf8"));
  const sessions = r.daemons.filter((d) => !d.scratch);
  const marks = r.pool.marksEnd.filter((m) => m.fresh);
  const editSlots = sessions.filter((d) => d.mark === null).reduce((s, d) => s + d.slotProcesses, 0);
  rows.push({
    at: r.startedAt.slice(11, 19),
    load1: Number(r.loadavgEnd.split(" ")[0]),
    psi: r.cpuPressureSomeAvg10[1],
    busy: r.hostCores.busy,
    nice: r.hostCores.nice,
    system: r.hostCores.system,
    squeal: r.sessionTreeCores,
    slots: r.slotProcesses,
    noMark: editSlots,
    permits: r.pool.permitsHeldEnd,
    markGrant: marks.reduce((s, m) => s + m.grant, 0),
    perSlot: r.slotProcesses ? Number((r.sessionTreeCores / r.slotProcesses).toFixed(2)) : null,
  });
  for (const d of sessions) if (d.slotProcesses > 0) perProcess.push(d.treeCores / d.slotProcesses);
}
console.log(Object.keys(rows[0]).join("\t"));
for (const row of rows) console.log(Object.values(row).join("\t"));
const col = (k) => rows.map((r) => r[k]).filter((v) => v !== null).sort((a, b) => a - b);
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
for (const k of ["load1", "busy", "nice", "squeal", "slots", "noMark", "perSlot"]) {
  const xs = col(k);
  console.log(`${k}: min ${xs[0]} median ${q(xs, 0.5)} max ${xs.at(-1)}`);
}
const ps = perProcess.sort((a, b) => a - b);
console.log(`per daemon cores per slot process (n=${ps.length}): min ${ps[0].toFixed(2)} p10 ${q(ps, 0.1).toFixed(2)} median ${q(ps, 0.5).toFixed(2)} p90 ${q(ps, 0.9).toFixed(2)} max ${ps.at(-1).toFixed(2)}`);
const ratio = rows.map((r) => r.nice / r.squeal).sort((a, b) => a - b);
console.log(`niced cores / Squeal tree cores: min ${ratio[0].toFixed(2)} median ${q(ratio, 0.5).toFixed(2)} max ${ratio.at(-1).toFixed(2)}`);
