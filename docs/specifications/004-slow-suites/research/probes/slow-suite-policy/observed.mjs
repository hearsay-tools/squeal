// Throwaway. node observed.mjs <observed dir> <repo root> [static.json]
// Per test file: worktree paths loaded by the test process and by every Node
// process it spawned, grouped, and how many the static closure lacks.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const [dir, root, staticJson] = process.argv.slice(2);
const stat = staticJson ? JSON.parse(readFileSync(staticJson, "utf8")).files : {};
const group = (p) => p.replace(/^(packages\/[^/]+\/[^/]+|[^/]+)\/.*$/, "$1");
for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const procs = readdirSync(`${dir}/${name}`);
  const paths = new Set();
  for (const p of procs)
    for (const line of readFileSync(`${dir}/${name}/${p}`, "utf8").split("\n").filter(Boolean)) {
      const { url } = JSON.parse(line);
      if (!url.startsWith("file:")) continue;
      const f = fileURLToPath(url);
      if (!f.startsWith(`${root}/`) || f.includes("/node_modules/")) continue;
      paths.add(f.slice(root.length + 1));
    }
  const groups = {};
  for (const p of paths) groups[group(p)] = (groups[group(p)] ?? 0) + 1;
  const key = Object.keys(stat).find((k) => k.endsWith(`/${name}.test.ts`));
  const s = new Set(key ? stat[key].list : []);
  const missed = [...paths].filter((p) => !s.has(p));
  console.log(`${name}\tprocs=${procs.length}\tobserved=${paths.size}\tstatic=${s.size}\tmissedByStatic=${missed.length}\t${JSON.stringify(groups)}`);
}
