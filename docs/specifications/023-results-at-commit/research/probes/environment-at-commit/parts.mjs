// Throwaway (environment-at-commit): for each project, which descriptor parts
// differ between environment hashes recorded in a store copy (copy.mjs), by
// pairs of hashes recorded one after the other at one Node version.
// Usage: node parts.mjs <scratch store>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("select hash, descriptor, recorded_at from environments order by recorded_at").all();
const byProject = new Map();
for (const r of rows) {
  const d = JSON.parse(r.descriptor);
  const list = byProject.get(d.project) ?? [];
  list.push({ ...r, d });
  byProject.set(d.project, list);
}
const partsOf = (d) => {
  const p = {
    keyFormat: d.keyFormat, runnerVersion: d.runnerVersion, adapterVersion: d.adapterVersion,
    nodeVersion: d.nodeVersion, platform: d.platform + "/" + d.arch,
    installedDependencies: d.installedDependencies, env: JSON.stringify(d.env),
  };
  for (const [k, v] of Object.entries(d.config ?? {})) p[`config.${k}`] = v;
  for (const [f, h] of d.files ?? []) p[`file:${f}`] = h;
  return p;
};
const summary = {};
for (const [project, list] of byProject) {
  const counts = {};
  let pairs = 0;
  for (let i = 1; i < list.length; i++) {
    const a = partsOf(list[i - 1].d), b = partsOf(list[i].d);
    if (a.nodeVersion !== b.nodeVersion) continue; // machine input; counted apart
    pairs++;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const kinds = new Set();
    for (const k of keys) if (a[k] !== b[k]) kinds.add(k.startsWith("file:") ? "runner file" : k.startsWith("config.") ? "resolved config" : k);
    for (const k of kinds) counts[k] = (counts[k] ?? 0) + 1;
  }
  const nodes = [...new Set(list.map((x) => x.d.nodeVersion))];
  summary[project] = { hashes: list.length, sameNodePairs: pairs, partDiffers: counts, nodes };
}
console.log(JSON.stringify(summary, null, 1));
