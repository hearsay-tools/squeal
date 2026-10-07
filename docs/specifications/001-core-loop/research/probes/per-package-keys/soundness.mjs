// Throwaway probe (001-102): which installed packages a test file's run loaded (trace.mjs log) that its
// per-package key would not cover (graph closure of its first-hop packages plus the env-wide closure).
// Usage: node soundness.mjs <trace log> <perfile.json> <installed lockfile> <worktree root>
import { readFileSync } from "node:fs";
import { readLock, resolve, closure } from "./lockgraph.mjs";
const [tracePath, pf, lockPath, root] = process.argv.slice(2);
const pk = readLock(lockPath);
const perfile = JSON.parse(readFileSync(pf, "utf8"));
const rows = readFileSync(tracePath, "utf8").trim().split("\n").map((l) => l.split(" "));
// pid -> test file: a worker names it; a child process inherits its parent's.
const fileOf = new Map(), parent = new Map();
for (const [pid, ppid, file] of rows) { parent.set(pid, ppid); if (file !== "-") fileOf.set(pid, file); }
const owner = (pid) => { for (let p = pid, i = 0; p && i < 50; p = parent.get(p), i++) if (fileOf.has(p)) return fileOf.get(p); return null; };
const locOf = (url) => {
  const path = decodeURIComponent(url.replace(/^file:\/\//, ""));
  if (!path.startsWith(`${root}/`)) return `outside:${path.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[0] ?? path}`;
  return path.slice(root.length + 1).match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1];
};
const covered = new Map();
for (const p of perfile.projects) {
  const env = closure(pk, p.envStarts.map(([f, n]) => resolve(pk, f, n) ?? `absent:${f}:${n}`));
  for (const [file, pairs] of Object.entries(p.files)) {
    const set = closure(pk, pairs.map(([f, n]) => resolve(pk, f, n) ?? `absent:${f}:${n}`));
    for (const l of env) set.add(l);
    covered.set(`${root}/${file}`, set);
  }
}
const misses = new Map(), unattributed = new Set(), absent = new Map(), inChild = new Map();
let attributedFiles = new Set();
const via = new Map();
for (const [pid, , , status, parentURL, specifier, url] of rows) {
  const file = owner(pid);
  if (!file) { if (status === "ok") unattributed.add(locOf(url)); continue; }
  attributedFiles.add(file);
  const cov = covered.get(file);
  if (!cov) continue;
  if (status === "absent") { const k = `${specifier} from ${locOf(parentURL) ?? parentURL.replace(`file://${root}/`, "")}`; (absent.get(k) ?? absent.set(k, new Set()).get(k)).add(file); continue; }
  const loc = locOf(url);
  if (!loc || cov.has(loc)) continue;
  // Grouped by package; the first importer seen is kept as an example.
  const k = loc.startsWith("outside:") ? `outside the worktree: ${loc.slice(8).replace(/.*\/node_modules\//, "")}` : loc;
  if (!via.has(k)) via.set(k, `${locOf(parentURL) ?? parentURL.replace(`file://${root}/`, "")} -> ${specifier}`);
  (misses.get(k) ?? misses.set(k, new Set()).get(k)).add(file.slice(root.length + 1));
  if (!fileOf.has(pid)) (inChild.get(k) ?? inChild.set(k, new Set()).get(k)).add(file);
}
const filesWithMiss = new Set([...misses.values()].flatMap((s) => [...s]));
const inside = new Set([...misses].filter(([k]) => !k.startsWith("outside")).flatMap(([, s]) => [...s]));
console.log(`with a worktree package loaded outside their key: ${inside.size}`);
console.log(`test files attributed: ${attributedFiles.size}; with a package loaded outside their key: ${filesWithMiss.size}`);
for (const [k, s] of [...misses].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${s.size} files${inChild.has(k) ? " (in a child process)" : ""}: ${k}   e.g. ${via.get(k)}   e.g. ${[...s][0]}`);
console.log(`failed bare resolutions: ${absent.size}`);
for (const [k, s] of [...absent].sort((a, b) => b[1].size - a[1].size).slice(0, 15)) console.log(`  ${s.size} files: ${k}`);
console.log(`packages loaded by processes with no test file (main process, globalSetup): ${unattributed.size}`);
