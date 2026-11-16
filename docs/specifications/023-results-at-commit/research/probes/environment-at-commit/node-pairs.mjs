// Throwaway (environment-at-commit): local environment hashes whose parts are
// equal except the Node version (and, for node:test, the runner version and
// config, which hold the Node build). Each such pair is two hashes, so a
// result under one is never found under the other.
// Usage: node node-pairs.mjs <scratch store>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("select hash, descriptor from environments").all().map((r) => ({ hash: r.hash, ...JSON.parse(r.descriptor) })).filter((d) => !d.ci);
const vitest = rows.filter((d) => d.runnerName === "vitest");
const key = (d) => JSON.stringify([d.project, d.keyFormat, d.runnerVersion, d.adapterVersion, d.platform, d.arch, d.installedDependencies, d.env, d.config, d.files]);
const by = new Map();
for (const d of vitest) { const l = by.get(key(d)) ?? []; l.push(d); by.set(key(d), l); }
let groups = 0, pairsDifferentHash = 0, pairsSameHash = 0;
for (const l of by.values()) {
  const nodes = new Set(l.map((d) => d.nodeVersion));
  if (nodes.size < 2) continue;
  groups++;
  for (const a of l) for (const b of l) if (a.hash < b.hash && a.nodeVersion !== b.nodeVersion) (a.hash === b.hash ? pairsSameHash++ : pairsDifferentHash++);
}
console.log(JSON.stringify({ localVitestHashes: vitest.length, groupsEqualButNode: groups, crossNodePairsDifferentHash: pairsDifferentHash, crossNodePairsSameHash: pairsSameHash }));
