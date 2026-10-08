// For each recorder graph file (graph-<i>-<pid>.ndjson) of one node:test project, the
// worktree paths it loaded that are not reachable from a test file's root edge
// (`parent: null`), i.e. what the adapter can only count as preload loads. Read only.
// Usage: node unreached.mjs <worktree root> <project log dir>...
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [root, ...dirs] = process.argv.slice(2);
const prefix = `file://${root}/`;
for (const dir of dirs) {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  for (const name of readdirSync(dir).filter((n) => n.startsWith("graph-"))) {
    const edges = readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const roots = edges.filter((e) => e.parent === null).map((e) => e.url);
    const next = new Map();
    for (const e of edges) if (e.parent) (next.get(e.parent) ?? next.set(e.parent, []).get(e.parent)).push(e.url);
    const seen = new Set(roots);
    const queue = [...roots];
    while (queue.length) for (const u of next.get(queue.pop()) ?? []) if (!seen.has(u)) seen.add(u), queue.push(u);
    const unreached = [...new Set(edges.map((e) => e.url))].filter(
      (u) => u.startsWith(prefix) && !u.includes("/node_modules/") && !seen.has(u),
    );
    if (!unreached.length) continue;
    const i = Number(name.split("-")[1]);
    const parents = (u) => [...new Set(edges.filter((e) => e.url === u).map((e) => (e.parent ?? "null").replace(prefix, "")))];
    console.log(`${dir.split("/").slice(-3, -2)[0].slice(0, 8)} ${name} (${run.files[i]?.testFile}) roots=${roots.length}`);
    for (const u of unreached) console.log(`  ${u.replace(prefix, "")} <- ${parents(u).join(", ")}`);
  }
}
