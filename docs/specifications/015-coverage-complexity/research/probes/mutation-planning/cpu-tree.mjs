// Throwaway probe for research/mutation-planning.md (row 015-125), question 4.
// CPU seconds a process tree has used so far: for each live process under <pid> (itself included), its own
// utime+stime plus cutime+cstime (the children it has reaped). Prints "<cpu seconds>".
// usage: node cpu-tree.mjs <pid>
import { readdirSync, readFileSync } from "node:fs";

const root = Number(process.argv[2]);
const TICK = 100; // USER_HZ on Linux
const stats = new Map();
for (const d of readdirSync("/proc")) {
  if (!/^\d+$/.test(d)) continue;
  try {
    const s = readFileSync(`/proc/${d}/stat`, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    stats.set(Number(d), { ppid: Number(f[1]), cpu: Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]) });
  } catch {}
}
const children = new Map();
for (const [pid, { ppid }] of stats) (children.get(ppid) ?? children.set(ppid, []).get(ppid)).push(pid);
let total = 0;
const stack = [root];
while (stack.length) {
  const pid = stack.pop();
  total += stats.get(pid)?.cpu ?? 0;
  stack.push(...(children.get(pid) ?? []));
}
console.log((total / TICK).toFixed(1));
