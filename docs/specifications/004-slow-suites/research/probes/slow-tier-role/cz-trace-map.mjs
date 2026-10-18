// Throwaway. Reads one `strace -f -e openat,execve,clone,clone3,fork,vfork` log of cezarion's
// `test:package` run, ties every process to the e2e spec whose node:test child it descends
// from, and prints per spec the packages/cezar/dist files its processes opened. With
// --changed <file>, also prints which specs opened any dist path listed in that file.
// Usage: node cz-trace-map.mjs <cezar package dir> <trace> [--changed <list>...]
import { readFileSync } from "node:fs";

const [pkg, trace, ...rest] = process.argv.slice(2);
const parent = new Map();
const spec = new Map();
const opened = new Map(); // pid -> Set(rel)
const dist = `${pkg}/dist/`;
let root;
for (const line of readFileSync(trace, "utf8").split("\n")) {
  const m = /^(\d+)\s+(\w+)\((.*)\)\s+=\s+(\d+)/.exec(line);
  if (!m) continue;
  const [, pid, call, args, ret] = m;
  if (/^(clone3?|v?fork)$/.test(call)) { parent.set(ret, pid); continue; }
  if (call === "execve") {
    // strace truncates argv, so a spec is known by the first spec file its process opens;
    // the runner's own process (the first execve, listing every spec) is not one.
    root ??= pid;
    continue;
  }
  if (call === "openat") {
    const p = /"([^"]+)"/.exec(args)?.[1];
    const s = p && /\/test\/e2e\/([\w-]+)\.test\.ts$/.exec(p);
    if (s && pid !== root && !spec.has(pid)) spec.set(pid, s[1]);
    if (p?.startsWith(dist)) {
      if (!opened.has(pid)) opened.set(pid, new Set());
      opened.get(pid).add(p.slice(pkg.length + 1));
    }
  }
}
const specOf = (pid) => { for (let p = pid; p; p = parent.get(p)) if (spec.has(p)) return spec.get(p); return null; };
const bySpec = {};
for (const [pid, set] of opened) {
  const s = specOf(pid) ?? "(no spec)";
  bySpec[s] ??= new Set();
  for (const f of set) bySpec[s].add(f);
}
for (const s of [...spec.values()]) bySpec[s] ??= new Set();
const js = (set) => [...set].filter((f) => f.endsWith(".js")).length;
for (const [s, set] of Object.entries(bySpec).sort()) console.log(`${s}\t${js(set)} dist .js\t${set.size} dist files`);
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] !== "--changed") continue;
  const changed = readFileSync(rest[i + 1], "utf8").split("\n").filter(Boolean);
  const hit = Object.entries(bySpec).filter(([, set]) => changed.some((f) => set.has(f))).map(([s]) => s);
  console.log(`${rest[i + 1]}: ${hit.length} of ${spec.size} specs opened a changed file: ${hit.join(", ")}`);
}
