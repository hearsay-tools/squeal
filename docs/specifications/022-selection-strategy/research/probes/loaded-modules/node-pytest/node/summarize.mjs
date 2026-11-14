// Throwaway: summarize hook output dir: per process/thread, the fixture-relative
// files seen by each kind (resolve/load/aresolve/aload), plus require.cache dumps.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const [dir, root] = process.argv.slice(2);
const rel = (u) => { try { const p = u.startsWith("file:") ? fileURLToPath(u.replace(/[?#].*$/, "")) : u; return p.startsWith(root + "/") ? p.slice(root.length + 1) : null; } catch { return null; } };
for (const name of readdirSync(dir).sort()) {
  const text = readFileSync(`${dir}/${name}`, "utf8");
  if (name.endsWith(".json")) {
    const v = JSON.parse(text);
    console.log(`${name} argv1=${v.argv1 && rel(v.argv1)}\n  require.cache: ${v.requireCache.map(rel).filter(Boolean).sort().join(" ")}\n  moduleLoadList(file-like): ${v.moduleLoadListFiles.length}`);
    continue;
  }
  const by = {};
  let argv1 = null;
  for (const line of text.split("\n").filter(Boolean)) {
    const e = JSON.parse(line); argv1 ??= e.argv1;
    const r = rel(e.url); if (r) (by[e.kind] ??= new Set()).add(r);
  }
  console.log(`${name} argv1=${argv1 && rel(argv1)}`);
  for (const [k, s] of Object.entries(by)) console.log(`  ${k}: ${[...s].sort().join(" ")}`);
}
