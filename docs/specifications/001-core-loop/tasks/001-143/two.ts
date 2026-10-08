// Task 001-143 evidence driver, not product code. One Vitest run of the named
// test files of a repository with a variant of the recorder copy in
// `recorder/` delivered as Squeal's adapter delivers it (the `env` option:
// `--require` first in NODE_OPTIONS, settings in SQUEAL_OBSERVE, the temp
// directory skipped), or none (`off`). Variant `on` is the whole copy; any other
// name sets SQUEAL143_OFF=<name> (`+` joins several; `shm`, which the
// recorder ignores, moves its output to tmpfs). `stamp.cjs` rides in
// every variant and times each worker and child. Records every test's
// duration and state, and the 1-minute load and runnable count every 500 ms.
// Usage: npx tsx two.ts <root> <variant> <out.json> <maxWorkers> <test path ...>
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reporter, TestCase, TestModule } from "vitest/node";
import { loadVitest } from "../../../../../src/runners/vitest/load.js";

const [root, variant, out, workers, ...only] = process.argv.slice(2);
if (!root || !variant || !out || !workers || only.length === 0) {
  throw new Error("usage: <root> <variant> <out> <maxWorkers> <test path ...>");
}
const t0 = Date.now();
const at = () => Date.now() - t0;
const here = fileURLToPath(new URL(".", import.meta.url));
const stampDir = mkdtempSync(join(tmpdir(), "squeal143-stamp-"));
// A variant named with `shm` writes the recorder's output to tmpfs instead (`/dev/shm`).
const observeDir = mkdtempSync(join(variant.includes("shm") ? "/dev/shm" : tmpdir(), "squeal143-observe-"));
const env: Record<string, string> = {
  SQUEAL143_STAMP: stampDir,
  NODE_OPTIONS: `--require ${JSON.stringify(join(here, "stamp.cjs"))}`,
};
// SQUEAL143_PROF=<dir>: a V8 CPU profile of every process that exits normally.
if (process.env.SQUEAL143_PROF) env.NODE_OPTIONS += ` --cpu-prof --cpu-prof-dir=${process.env.SQUEAL143_PROF}`;
if (variant !== "off") {
  env.NODE_OPTIONS += ` --require ${JSON.stringify(join(here, "recorder/recorder.cjs"))}`;
  env.SQUEAL_OBSERVE = JSON.stringify({ out: observeDir, root, skip: [tmpdir()] });
  if (process.env.SQUEAL143_TIME) env.SQUEAL143_TIME = "1";
  if (variant !== "on") env.SQUEAL143_OFF = variant.replaceAll("+", ",");
}

const samples: { t: number; load1: number; runnable: number }[] = [];
const sample = () => {
  const [l1] = readFileSync("/proc/loadavg", "utf8").split(" ");
  const runnable = Number(/procs_running (\d+)/.exec(readFileSync("/proc/stat", "utf8"))?.[1]);
  samples.push({ t: at(), load1: Number(l1), runnable });
};
sample();
const sampler = setInterval(sample, 500);

const rel = (id: string) => id.slice(root.length + 1);
const files: Record<string, { start?: number; end?: number; state?: string; durationMs?: number; error?: string }> = {};
const tests: { file: string; name: string; state: string; durationMs?: number; error?: string }[] = [];
const reporter: Reporter = {
  onTestModuleStart: (m: TestModule) => {
    files[rel(m.moduleId)] = { start: at() };
  },
  onTestCaseResult: (c: TestCase) => {
    const r = c.result();
    tests.push({
      file: rel(c.module.moduleId),
      name: c.fullName,
      state: r.state,
      durationMs: c.diagnostic()?.duration,
      error: r.errors?.[0]?.message?.slice(0, 200),
    });
  },
  onTestModuleEnd: (m: TestModule) => {
    files[rel(m.moduleId)] = { ...files[rel(m.moduleId)], end: at(), state: m.state(), durationMs: m.diagnostic().duration, error: m.errors()[0]?.message?.slice(0, 300) };
  },
};

const { createVitest } = await loadVitest(root as never);
const vitest = await createVitest("test", {
  root,
  watch: false,
  reporters: [reporter],
  update: "none",
  maxWorkers: Number(workers),
  env,
});
await vitest.standalone();
const specs = (await vitest.globTestSpecifications()).filter((s) => only.includes(rel(s.moduleId)));
const runStart = at();
await vitest.runTestSpecifications(specs);
const runEnd = at();
clearInterval(sampler);
await vitest.close();

const stamps = readdirSync(stampDir).flatMap((f) => readFileSync(join(stampDir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
rmSync(stampDir, { recursive: true, force: true });
const times = readdirSync(observeDir).filter((f) => f.endsWith(".time.json")).map((f) => JSON.parse(readFileSync(join(observeDir, f), "utf8")));
const flushes = readdirSync(observeDir).filter((f) => f.endsWith(".ndjson")).map((f) => ({ file: f, lines: readFileSync(join(observeDir, f), "utf8").split("\n").length - 1 }));
rmSync(observeDir, { recursive: true, force: true });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
writeFileSync(out, JSON.stringify({ variant, startedAt: new Date(t0).toISOString(), runStart, runEnd, files, tests, stamps, times, flushes, samples }));
const help = tests.filter((t) => t.name.includes("help") && t.name.includes("dispatch"));
console.log(
  `${variant}: run ${((runEnd - runStart) / 1000).toFixed(1)} s, files ${JSON.stringify(Object.fromEntries(Object.entries(files).map(([p, f]) => [p.split("/").slice(-2).join("/"), `${f.state} ${((f.durationMs ?? 0) / 1000).toFixed(1)}`])))}, help tests ${JSON.stringify(help.map((t) => `${t.state} ${((t.durationMs ?? 0) / 1000).toFixed(1)}`))}, load1 ${mean(samples.map((s) => s.load1)).toFixed(0)}, runnable ${mean(samples.map((s) => s.runnable)).toFixed(0)}`,
);
process.exit(0);
