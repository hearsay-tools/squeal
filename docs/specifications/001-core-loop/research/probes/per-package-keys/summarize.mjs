// Throwaway probe (001-102): folds a trace.mjs log into "test file -> installed packages loaded".
// A process with a FILE mark is attributed to that test file; its child processes too.
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split(" "));
const fileOf = new Map(), parent = new Map(), pkgs = new Map();
for (const [pid, ppid, kind, path] of lines) {
  parent.set(pid, ppid);
  if (kind === "FILE") (fileOf.get(pid) ?? fileOf.set(pid, new Set()).get(pid)).add(path);
}
const owner = (pid) => { for (let p = pid; p; p = parent.get(p)) if (fileOf.has(p)) return [...fileOf.get(p)].join(","); return `pid ${pid} (no test file)`; };
const pkgName = (url) => { const m = url.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)/); return m?.[1]; };
const ignore = new RegExp(process.argv[3] ?? "^$");
for (const [pid, , kind] of lines) {
  if (kind === "FILE") continue;
  const name = pkgName(kind);
  if (!name || ignore.test(name)) continue;
  const o = owner(pid);
  (pkgs.get(o) ?? pkgs.set(o, new Set()).get(o)).add(name);
}
for (const [o, s] of [...pkgs].sort()) console.log(o.replace(process.cwd(), ""), "->", [...s].sort().join(" "));
console.log("processes with a FILE mark:", fileOf.size, "max files per process:", Math.max(...[...fileOf.values()].map((s) => s.size)));
