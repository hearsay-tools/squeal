// Throwaway probe for 015-10 Part C. Not product code.
//   tsx bench-count.mts <file list> [--runs N]
// Times the released counter (`git archive squeal--v0.1.284 src`, in ../counter) on each file of
// the list: one warm-up count, then N timed counts (default 5); prints per file the median wall
// ms and CPU ms of one count, then the median and p95 over files, the total CPU of one count of
// every file, and the one-minute load at start and end. The grammar load is timed on its own.
import { readFileSync } from "node:fs";
import { cpuUsage } from "node:process";
import { countFile } from "../counter/src/core/code/count/index.ts";

const [list, ...rest] = process.argv.slice(2);
const runs = rest[0] === "--runs" ? Number(rest[1]) : 5;
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
const language = (p: string) => (p.endsWith(".py") ? "python" : "typescript");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;

const loadStart = load();
const g0 = cpuUsage();
const w0 = performance.now();
await countFile("const a = 1;\n", "typescript");
const grammarWallMs = performance.now() - w0;
const g = cpuUsage(g0);
const walls: number[] = [];
const cpus: number[] = [];
for (const path of files) {
  const text = readFileSync(path, "utf8");
  await countFile(text, language(path));
  const w: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < runs; i++) {
    const c0 = cpuUsage();
    const t0 = performance.now();
    await countFile(text, language(path));
    w.push(performance.now() - t0);
    const d = cpuUsage(c0);
    c.push((d.user + d.system) / 1000);
  }
  walls.push(median(w));
  cpus.push(median(c));
  if (files.length <= 40) {
    console.log(`${median(w).toFixed(2)} ms wall  ${median(c).toFixed(2)} ms cpu  ${(text.length / 1024).toFixed(1)} KiB  ${path}`);
  }
}
console.log(
  JSON.stringify({
    files: files.length,
    grammarLoad: { wallMs: +grammarWallMs.toFixed(1), cpuMs: +((g.user + g.system) / 1000).toFixed(1) },
    wallMs: { median: +median(walls).toFixed(2), p95: +p95(walls).toFixed(2) },
    cpuMs: { median: +median(cpus).toFixed(2), p95: +p95(cpus).toFixed(2), total: +cpus.reduce((a, b) => a + b, 0).toFixed(0) },
    load: { start: loadStart, end: load() },
  }),
);
