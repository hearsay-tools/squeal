// Start phases of each rep's commit daemon, seconds from its spawn: claim, pnpm seen in
// its tree, installed, runner-host seen. Usage: node phases.mjs <out dir>
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".samples.jsonl")).sort()) {
  const lines = readFileSync(`${dir}/${f}`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const claimed = lines.find((l) => l.event?.startsWith("claimed:"));
  if (!claimed) continue;
  const proc = lines.find((l) => l.event === `daemon-process:commit:${claimed.pid}`) ?? lines.find((l) => l.event?.endsWith(`:${claimed.pid}`));
  const spawn = proc.spawnedAt ?? proc.t;
  const rel = (t) => (t == null ? null : +((t - spawn) / 1000).toFixed(1));
  let rh = null, pn0 = null, pn1 = null, roles = new Set();
  for (const l of lines) {
    const tr = l.trees?.find((x) => x.pid === claimed.pid);
    if (!tr) continue;
    for (const r of Object.keys(tr.roles)) roles.add(r);
    if (tr.roles["runner-host"] && rh == null) rh = l.t;
    const p = Object.keys(tr.roles).some((r) => /pnpm/.test(r));
    if (p) { pn0 ??= l.t; pn1 = l.t; }
  }
  const inst = lines.find((l) => l.event?.startsWith("installed:"));
  console.log(f.replace(".samples.jsonl", ""), "claim", rel(claimed.t), "pnpm", rel(pn0), "-", rel(pn1), "installed", rel(inst?.t), "runner-host", rel(rh), [...roles].join(","));
}
