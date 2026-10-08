// Task 001-137 evidence driver, not product code. One Vitest run of the named
// test files of a repository, with the recorder (`on`) or without (`off`),
// delivered as Squeal's adapter delivers it (`VitestObserver`: the `env`
// option, then `configure`), at a fixed `maxWorkers`. Unlike 001-132's `ab.ts`
// it records when each file started and ended, when each failing test failed,
// and samples the process tree and the load every 500 ms.
// Usage: npx tsx nine.ts <root> <on|off> <out.json> <maxWorkers> <test path ...>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, TestCase, TestModule } from "vitest/node";
import { loadVitest } from "../../../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../../../src/runners/vitest/paths.js";
import { VitestObserver } from "../../../../../src/runners/vitest/observe.js";

const [root, mode, out, workers, ...only] = process.argv.slice(2);
if (!root || (mode !== "on" && mode !== "off") || !out || !workers || only.length === 0) {
  throw new Error("usage: <root> <on|off> <out> <maxWorkers> <test path ...>");
}
const t0 = Date.now();
const at = () => Date.now() - t0;

interface Proc {
  pid: number;
  ppid: number;
  comm: string;
  cmd: string;
}
const procs = (): Proc[] => {
  const found: Proc[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const comm = stat.slice(stat.indexOf("(") + 1, close);
      const ppid = Number(stat.slice(close + 2).split(" ")[1]);
      const cmd = readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ").slice(0, 200);
      found.push({ pid: Number(name), ppid, comm, cmd });
    } catch {
      // Gone between readdir and read.
    }
  }
  return found;
};
// Workers: this process's direct children. Children: everything below them.
const samples: unknown[] = [];
const sample = () => {
  const all = procs();
  const kids = new Map<number, Proc[]>();
  for (const p of all) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  const workerProcs = kids.get(process.pid) ?? [];
  let children = 0;
  const childComms: Record<string, number> = {};
  const walk = (pid: number) => {
    for (const k of kids.get(pid) ?? []) {
      children++;
      childComms[k.comm] = (childComms[k.comm] ?? 0) + 1;
      walk(k.pid);
    }
  };
  for (const w of workerProcs) walk(w.pid);
  const [l1, , , running] = readFileSync("/proc/loadavg", "utf8").split(" ");
  const procsRunning = Number(/procs_running (\d+)/.exec(readFileSync("/proc/stat", "utf8"))?.[1]);
  samples.push({
    t: at(),
    load1: Number(l1),
    runnable: procsRunning,
    tasks: running,
    workers: workerProcs.length,
    children,
    childComms,
    burners: all.filter((p) => p.cmd.includes("squeal137-burn")).length,
  });
};
sample();
const sampler = setInterval(sample, 500);

const files: Record<string, { start?: number; end?: number; state?: string; durationMs?: number }> = {};
const failures: { file: string; name: string; t: number; durationMs?: number; error?: string }[] = [];
const rel = (id: string) => id.slice(root.length + 1);
const reporter: Reporter = {
  onTestModuleStart: (m: TestModule) => {
    files[rel(m.moduleId)] = { ...files[rel(m.moduleId)], start: at() };
  },
  onTestCaseResult: (c: TestCase) => {
    const r = c.result();
    if (r.state !== "failed") return;
    failures.push({
      file: rel(c.module.moduleId),
      name: c.fullName,
      t: at(),
      durationMs: c.diagnostic()?.duration,
      error: r.errors?.[0]?.message?.slice(0, 300),
    });
  },
  onTestModuleEnd: (m: TestModule) => {
    const f = files[rel(m.moduleId)] ?? {};
    files[rel(m.moduleId)] = { ...f, end: at(), state: m.state(), durationMs: m.diagnostic().duration };
  },
};

const observer = new VitestObserver(new WorktreePaths(root as never), () => mode === "on");
// The project's own Vitest, as the adapter loads it.
const { createVitest } = await loadVitest(root as never);
const vitest = await createVitest("test", {
  root,
  watch: false,
  reporters: [reporter],
  update: "none",
  includeTaskLocation: true,
  maxWorkers: Number(workers),
  ...observer.start(),
});
await vitest.standalone();
observer.configure(vitest);
const specs = (await vitest.globTestSpecifications()).filter((s) => only.includes(rel(s.moduleId)));
const runStart = at();
await vitest.runTestSpecifications(specs);
const runEnd = at();
clearInterval(sampler);
sample();
const observed = observer.take(specs.map((s) => ({ project: s.project.name, path: rel(s.moduleId) }) as never)) ?? [];
await vitest.close();
observer.stop();

const failed = Object.entries(files)
  .filter(([, f]) => f.state !== "passed")
  .map(([p]) => p)
  .sort();
writeFileSync(
  out,
  JSON.stringify({
    mode,
    maxWorkers: Number(workers),
    startedAt: new Date(t0).toISOString(),
    runStart,
    runEnd,
    files,
    failed,
    failures,
    observedFiles: observed.filter((o) => o.paths.length + o.directories.length > 0).length,
    samples,
  }),
);
console.log(
  `${mode}: ${specs.length} files, run ${((runEnd - runStart) / 1000).toFixed(1)} s, failing ${JSON.stringify(failed)}, observed ${observed.length}`,
);
process.exit(0);
