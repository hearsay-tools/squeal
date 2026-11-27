import { DatabaseSync } from "node:sqlite";
const lint = new DatabaseSync(process.argv[2], { readOnly: true });
const keying = new Map(lint.prepare("select key, value from meta where key like 'lint-keying:%'").all().map(r => [r.key.slice(12), JSON.parse(r.value)]));
const envs = new Map();
for (const r of lint.prepare("select key, value from meta where key like 'lint-inputs:%'").all()) {
  const id = r.key.slice(12).replace(/:oxlint$/, ''); const v = JSON.parse(r.value); const k = keying.get(id); if (!k) continue;
  const e = envs.get(v.environment);
  if (!e || k.at < e.at) envs.set(v.environment, { at: k.at, files: new Map(v.files), installed: v.installed, id });
}
const list = [...envs.values()].sort((a, b) => a.at - b.at);
const since = Date.parse(process.argv[3] ?? "2026-11-19T21:07:41Z");
const cat = {}; const pathCount = {};
for (let i = 1; i < list.length; i++) {
  const [p, c] = [list[i - 1], list[i]]; if (c.at < since) continue;
  const changed = [], added = [], removed = [];
  for (const [f, b] of c.files) { if (!p.files.has(f)) added.push(f); else if (p.files.get(f) !== b) changed.push(f); }
  for (const f of p.files.keys()) if (!c.files.has(f)) removed.push(f);
  let k;
  if (changed.some(f => /oxlintrc/.test(f))) k = "oxlint config blob changed";
  else if (changed.length || added.length || removed.length) k = "closure files changed (rule sources and imports)";
  else k = "same closure blobs: install, tool version, Node major or keyed env";
  cat[k] = (cat[k] ?? 0) + 1;
  for (const f of [...changed, ...added, ...removed]) pathCount[f] = (pathCount[f] ?? 0) + 1;
}
console.log("environments", list.length, "since", new Date(since).toISOString(), cat);
console.log(Object.entries(pathCount).sort((a, b) => b[1] - a[1]).slice(0, 15));
const days = (list.at(-1).at - since) / 864e5; console.log("per day", (list.filter(e => e.at >= since).length / days).toFixed(1));
