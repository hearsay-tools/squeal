// Throwaway probe (research 023-01, question 2). Which test files at commit X name, in
// their stored closure or observed reads, a path X's tree lacks and git ignores: a file
// a fresh checkout of X does not hold (build output, generated files).
// Usage: node ignored-inputs.mjs <store-copy.sqlite> <checkout-at-X>
// Reads a VACUUM INTO copy of the store and runs `git ls-tree` and `git check-ignore` only.
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const [store, wt] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const tree = new Set(execFileSync("git", ["-C", wt, "ls-tree", "-r", "-z", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 1 << 30 }).split("\0").filter(Boolean));
const observed = new Map();
for (const r of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
  try { observed.set(r.key.slice(9), JSON.parse(r.value)); } catch {}
}
const nm = (p) => p.startsWith("node_modules/") || p.includes("/node_modules/") || p === ".git";
const missingBy = new Map(); // test id -> missing paths
const allMissing = new Set();
let atX = 0;
const projects = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) {
  if (!tree.has(r.path)) continue;
  const id = `${r.project}\0${r.path}`;
  if (missingBy.has(id) || projects.has(id)) continue;
  atX++;
  projects.set(id, 1);
  const paths = new Set(JSON.parse(r.closure_paths));
  for (const p of observed.get(r.project)?.[r.path] ?? []) paths.add(p);
  const miss = [...paths].filter((p) => !nm(p) && !p.endsWith("/") && !tree.has(p));
  if (miss.length) { missingBy.set(id, miss); miss.forEach((p) => allMissing.add(p)); }
}
// Of the paths X lacks, which does git ignore at X (generated), and which are simply absent (deleted, renamed)?
const list = [...allMissing];
let ignored = new Set();
if (list.length) {
  const out = execFileSync("git", ["-C", wt, "check-ignore", "--no-index", "--stdin", "-z"], { input: list.join("\0") + "\0", encoding: "utf8", maxBuffer: 1 << 30 }).toString();
  ignored = new Set(out.split("\0").filter(Boolean));
}
const top = (p) => p.split("/").slice(0, 3).join("/");
const groups = {};
for (const p of ignored) groups[top(p)] = (groups[top(p)] ?? 0) + 1;
const files = [];
for (const [id, miss] of missingBy) {
  const ign = miss.filter((p) => ignored.has(p));
  if (ign.length) files.push({ test: id.replace("\0", " "), ignoredInputs: ign.length, groups: [...new Set(ign.map(top))], sample: ign.slice(0, 3) });
}
files.sort((a, b) => a.test.localeCompare(b.test));
console.log(JSON.stringify({ testFilesAtX: atX, missingPaths: list.length, ignoredPaths: ignored.size, ignoredGroups: groups, testFilesNamingIgnored: files.length, files }, null, 1));
