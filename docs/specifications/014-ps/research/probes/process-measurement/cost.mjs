// Throwaway probe for research 014-02: the cost of each /proc read a snapshot needs, sync
// against async (libuv thread pool), all processes against a filtered set. Read-only.
// Usage: node cost.mjs [rounds]
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";

const rounds = Number(process.argv[2] ?? 3);
const read = (p) => { try { return readFileSync(p, "latin1"); } catch { return null; } };
const aread = async (p) => { try { return await readFile(p, "latin1"); } catch { return null; } };
async function measure(name, fn) {
  const c0 = process.cpuUsage(); const t0 = performance.now();
  const value = await fn();
  const c = process.cpuUsage(c0);
  return { name, wallMs: +(performance.now() - t0).toFixed(1), cpuMs: +((c.user + c.system) / 1000).toFixed(1), value };
}
for (let r = 0; r < rounds; r++) {
  const load = loadavg()[0].toFixed(2);
  const out = [];
  const names = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  const s = await measure("stat all, sync", () => names.map((n) => [n, read(`/proc/${n}/stat`)]).filter(([, t]) => t !== null));
  out.push(s);
  const node = s.value.filter(([, t]) => /\((node|MainThread|squeal)\)/.test(t)).map(([n]) => n);
  out.push(await measure("cmdline all, sync", () => names.map((n) => read(`/proc/${n}/cmdline`))));
  out.push(await measure("cmdline all, async", () => Promise.all(names.map((n) => aread(`/proc/${n}/cmdline`)))));
  const daemons = [];
  out.push(await measure(`cmdline of comm node (${node.length}), sync`, () => { for (const n of node) if (/squeal\.mjs\0daemon\0/.test(read(`/proc/${n}/cmdline`) ?? "")) daemons.push(n); }));
  const marked = [];
  out.push(await measure("environ all, sync", () => { for (const n of names) if ((read(`/proc/${n}/environ`) ?? "").includes("SQUEAL_DAEMON_CHILD=")) marked.push(n); }));
  out.push(await measure("environ all, async", () => Promise.all(names.map((n) => aread(`/proc/${n}/environ`)))));
  const ours = [...new Set([...daemons, ...marked])];
  out.push(await measure(`status of ours (${ours.length}), sync`, () => ours.map((n) => read(`/proc/${n}/status`))));
  out.push(await measure(`children of daemons' tasks (${daemons.length}), sync`, () => daemons.flatMap((d) => { try { return readdirSync(`/proc/${d}/task`).map((t) => read(`/proc/${d}/task/${t}/children`)); } catch { return []; } })));
  out.push(await measure(`smaps_rollup of ours (${ours.length}), sync`, () => ours.map((n) => read(`/proc/${n}/smaps_rollup`))));
  out.push(await measure("host files", () => ["/proc/loadavg", "/proc/pressure/cpu", "/proc/pressure/memory", "/proc/pressure/io", "/proc/meminfo", "/proc/stat"].map(read)));
  console.log(`round ${r + 1} load1 ${load} processes ${names.length} daemons ${daemons.length} marked ${marked.length}`);
  for (const { name, wallMs, cpuMs } of out) console.log(`  ${name.padEnd(42)} wall ${String(wallMs).padStart(7)} ms  cpu ${String(cpuMs).padStart(7)} ms`);
}
