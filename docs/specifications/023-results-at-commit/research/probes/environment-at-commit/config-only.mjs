// Throwaway (environment-at-commit): environment pairs (same project, same
// Node, same runner and adapter versions) whose resolved config differs while
// every runner file and the installed dependencies are equal. Such a pair
// means the config depends on something git does not hold.
// Usage: node config-only.mjs <scratch store>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("select hash, descriptor, recorded_at from environments").all().map((r) => ({ ...r, d: JSON.parse(r.descriptor) }));
const group = new Map();
for (const r of rows) {
  const d = r.d;
  const k = [d.project, d.nodeVersion, d.runnerVersion, d.adapterVersion, d.keyFormat, d.installedDependencies, JSON.stringify(d.files), JSON.stringify(d.env)].join("|");
  const l = group.get(k) ?? [];
  l.push(r);
  group.set(k, l);
}
let groups = 0, multi = 0;
const fields = {};
const examples = [];
for (const [, l] of group) {
  groups++;
  if (l.length < 2) continue;
  multi++;
  const a = l[0].d.config;
  for (const r of l.slice(1)) {
    for (const f of new Set([...Object.keys(a), ...Object.keys(r.d.config)])) {
      if (a[f] !== r.d.config[f]) fields[`${r.d.project}:${f}`] = (fields[`${r.d.project}:${f}`] ?? 0) + 1;
    }
  }
  if (examples.length < 5) examples.push(l.map((r) => [r.hash.slice(0, 8), new Date(r.recorded_at).toISOString()]));
}
// Same check with installedDependencies left free: does the files tuple alone fix the rest?
const g2 = new Map();
for (const r of rows) {
  const d = r.d;
  const k = [d.project, d.nodeVersion, d.runnerVersion, d.adapterVersion, d.keyFormat, JSON.stringify(d.files), JSON.stringify(d.env)].join("|");
  const s = g2.get(k) ?? new Set();
  s.add(d.installedDependencies);
  g2.set(k, s);
}
const filesTupleWithManyInstalls = [...g2.values()].filter((s) => s.size > 1).length;
console.log(JSON.stringify({ hashes: rows.length, groupsWithEqualInputs: groups, groupsHoldingMoreThanOneHash: multi, configFieldsDiffering: fields, examples, filesTuples: g2.size, filesTuplesWithMoreThanOneInstall: filesTupleWithManyInstalls }, null, 1));
