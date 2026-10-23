// 011-157 probe (throwaway), question 2: for one move of the main checkout's HEAD, the closure paths whose content differs, counted over the re-keyed files.
// Usage: node whyrekey.mjs <store copy> <repo root> <from commit> <to commit>
import { DatabaseSync } from "node:sqlite"; import { execFileSync } from "node:child_process";
const [, , storePath, root, from, to] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true }); const gitDir = root + "/.git";
const tree = (c) => new Map(execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--full-tree", c], { maxBuffer: 1 << 28 }).toString().trim().split("\n").map((l) => { const [m, p] = l.split("\t"); return [p, m.split(" ")[2]]; }));
const a = tree(from), b = tree(to);
const changed = new Set([...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)));
const observed = new Map(); for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) for (const [t, ps] of Object.entries(JSON.parse(m.value))) observed.set(m.key.slice(9) + "\0" + t, ps);
const count = new Map(); let files = 0, hit = 0;
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files WHERE path NOT LIKE '.ai/%'").all()) {
  if (!b.has(t.path)) continue; files++;
  const ps = new Set([...JSON.parse(t.closure_paths), ...(observed.get(t.project + "\0" + t.path) ?? [])]);
  const hits = [...ps].filter((p) => changed.has(p)); if (hits.length) hit++;
  for (const p of hits) count.set(p, (count.get(p) ?? 0) + 1);
}
console.log(`changed paths ${changed.size}; test files ${files}; with a changed closure path (listings not counted) ${hit}`);
for (const [p, n] of [...count].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(n, p);
