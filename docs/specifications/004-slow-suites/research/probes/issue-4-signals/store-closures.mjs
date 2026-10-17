// Throwaway, read only: the stored closures of cezarion's slow web specs, for research/issue-4-signals.md.
// Usage: node <this> <path to store.sqlite> <out.json>. Opens the store readOnly and writes nothing to it.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("select project, path, closure_paths, complete, method, updated_at from test_files where path like 'packages/web/e2e/%.e2e.ts' order by path").all();
const out = {};
for (const r of rows) {
  const paths = JSON.parse(r.closure_paths);
  out[r.path] = { project: r.project, complete: r.complete, method: r.method, updatedAt: new Date(r.updated_at).toISOString(), paths };
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
const sizes = Object.values(out).map((o) => o.paths.length).sort((a, b) => a - b);
console.log("slow web specs with a stored closure:", rows.length, "projects:", [...new Set(rows.map((r) => r.project))].join(","));
console.log("closure sizes min/median/max:", sizes[0], sizes[sizes.length >> 1], sizes.at(-1));
const any = (pred) => Object.entries(out).filter(([, o]) => o.paths.some(pred)).length;
console.log("closures naming any packages/web/src path:", any((p) => p.startsWith("packages/web/src/")));
console.log("closures naming markdown.tsx:", any((p) => p.endsWith("task-thread/markdown.tsx")));
const freq = new Map();
for (const o of Object.values(out)) for (const p of o.paths) freq.set(p, (freq.get(p) ?? 0) + 1);
console.log("closure paths outside packages/web/e2e, by how many specs name them:");
for (const [p, n] of [...freq].filter(([p]) => !p.startsWith("packages/web/e2e/")).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(" ", n, p);
console.log("helpers under packages/web/e2e (non-spec), by how many specs name them:");
for (const [p, n] of [...freq].filter(([p]) => p.startsWith("packages/web/e2e/") && !p.endsWith(".e2e.ts")).sort((a, b) => b[1] - a[1])) console.log(" ", n, p);
