// Throwaway probe for 016-34: one host process that takes samples and
// appends one JSON line per sample to `out`. argv[2] is a JSON job:
//   { mode: "smoke" | "cold" | "warm" | "hint", bindings: [...], check,
//     n, warmup, root, eslintDir, compileCache, out, loadMax }
// cold: one sample of bindings[0], timed from open() (module load, process
//   start, the provider's first ESLint load) to the result. Run each cold
//   sample in a fresh process.
// warm: every binding opened and warmed up, then n rounds; each round takes
//   one sample of each binding, the order rotated by round.
// hint: the warm cost of one scheduling-hint call (tierWidth), per call.
// smoke: one edit per binding, checks the result, records no time.
// Every timed sample starts only when the one-minute load is below loadMax;
// the load read is stored beside the sample.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { open } from "./bindings.mjs";

const job = JSON.parse(process.argv[2]);
const SOURCE = join(job.root, "src/a.js");
const base = readFileSync(SOURCE, "utf8").replace(/\/\/ edit \d+\n$/, "");
const expected = job.check === "trivial" ? { file: "checks/a.check.js", outcome: "pass" } : { file: "src/a.js", outcome: "fail" };
let edits = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
/** Waits (asleep) until the one-minute load is below loadMax; returns the load read and the wait. */
async function gate() {
  const started = Date.now();
  for (;;) {
    const load = load1();
    if (load < job.loadMax) return { load, gateWaitS: Math.round((Date.now() - started) / 1000) };
    await sleep(15_000);
  }
}
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
/** Children reaped by this process: utime + stime of /proc/self/stat, in 10 ms ticks. */
const childTicksMs = () => {
  const fields = readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ");
  return (Number(fields[13]) + Number(fields[14])) * 10;
};

/** The agent's edit: written before the timed span starts, as a watcher would see it. */
function edit() {
  edits += 1;
  writeFileSync(SOURCE, `${base}// edit ${edits}\n`);
}

/** From a changed path to a result: the provider calls a revision makes (question 3). */
async function editToResult(binding) {
  const changed = ["src/a.js"];
  await binding.invalidate(changed.map((path) => ({ path, kind: "change" })));
  const { direct } = await binding.affected(changed);
  for (const unit of direct) await binding.closure(unit);
  return binding.run(direct);
}

function verify(report, kind) {
  const r = report.results?.[0];
  if (report.results?.length !== 1 || r.file !== expected.file || r.outcome !== expected.outcome)
    throw new Error(`${kind}: unexpected report ${JSON.stringify(report).slice(0, 300)}`);
  return r.messages.length;
}

const provider = { root: job.root, check: job.check, eslintDir: job.eslintDir, compileCache: job.compileCache };
const record = (line) => appendFileSync(job.out, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);

/** One timed edit on an open binding; remote CPU is read outside the span. */
async function warmSample(binding, round) {
  const { load, gateWaitS } = await gate();
  const remote0 = binding.kind === "rpc" ? await binding.remoteCpu() : null;
  edit();
  const ticks0 = childTicksMs();
  const cpu0 = cpuMs();
  const t0 = performance.now();
  const report = await editToResult(binding);
  const wallMs = performance.now() - t0;
  const hostCpuMs = cpuMs() - cpu0;
  const ticksMs = childTicksMs() - ticks0;
  const messages = verify(report, binding.kind);
  let remoteCpuMs = null;
  let remoteRssMb = null;
  if (binding.kind === "rpc") {
    const remote1 = await binding.remoteCpu();
    remoteCpuMs = (remote1.cpuUs - remote0.cpuUs) / 1000;
    remoteRssMb = remote1.rss / 2 ** 20;
  } else if (binding.kind.startsWith("command")) {
    const last = await binding.remoteCpu();
    remoteCpuMs = last.cpuUs / 1000;
    remoteRssMb = last.maxRssKb / 1024;
  }
  record({
    mode: "warm",
    binding: binding.kind,
    check: job.check,
    round,
    load1: load,
    gateWaitS,
    wallMs,
    hostCpuMs,
    remoteCpuMs,
    cpuMs: hostCpuMs + (remoteCpuMs ?? 0),
    childTicksMs: binding.kind.startsWith("command") ? ticksMs : null,
    hostRssMb: process.memoryUsage().rss / 2 ** 20,
    remoteRssMb,
    messages,
  });
}

if (job.mode === "smoke") {
  for (const kind of job.bindings) {
    const binding = await open(kind, provider);
    edit();
    const messages = verify(await editToResult(binding), kind);
    edit();
    verify(await editToResult(binding), kind);
    await binding.close();
    console.log(`smoke ${job.check} ${kind}: ok, ${messages} message(s)`);
  }
} else if (job.mode === "cold") {
  const [kind] = job.bindings;
  const { load, gateWaitS } = await gate();
  edit();
  const ticks0 = childTicksMs();
  const cpu0 = cpuMs();
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const binding = await open(kind, provider);
  const report = await editToResult(binding);
  const wallMs = performance.now() - t0;
  const hostCpuMs = cpuMs() - cpu0;
  const ticksMs = childTicksMs() - ticks0;
  const messages = verify(report, kind);
  const remote = await binding.remoteCpu();
  // rpc: the provider process's CPU since its fork, read after the result.
  const remoteCpuMs = remote === null ? null : remote.cpuUs / 1000;
  const remoteRssMb = remote === null ? null : (remote.rss ?? remote.maxRssKb * 1024) / 2 ** 20;
  record({
    mode: "cold",
    binding: kind,
    check: job.check,
    load1: load,
    gateWaitS,
    wallMs,
    hostCpuMs,
    remoteCpuMs,
    cpuMs: hostCpuMs + (remoteCpuMs ?? 0),
    childTicksMs: kind.startsWith("command") ? ticksMs : null,
    hostRssMb: process.memoryUsage().rss / 2 ** 20,
    hostRssGrowthMb: (process.memoryUsage().rss - rss0) / 2 ** 20,
    remoteRssMb,
    messages,
  });
  await binding.close();
} else if (job.mode === "warm") {
  const bindings = [];
  for (const kind of job.bindings) {
    const binding = await open(kind, provider);
    for (let i = 0; i < job.warmup; i++) {
      edit();
      verify(await editToResult(binding), kind);
    }
    bindings.push(binding);
  }
  for (let round = 0; round < job.n; round++)
    for (let j = 0; j < bindings.length; j++) await warmSample(bindings[(round + j) % bindings.length], round);
  for (const binding of bindings) await binding.close();
} else if (job.mode === "hint") {
  // inproc answers synchronously, as RunnerAdapter's hints must under the
  // scheduler's lock; worker and rpc can only answer with an awaited reply.
  const bindings = [];
  for (const kind of job.bindings) bindings.push(await open(kind, provider));
  for (const binding of bindings) for (let i = 0; i < 200; i++) await binding.hint("checks/a.check.js", 8);
  for (let round = 0; round < job.n; round++)
    for (let j = 0; j < bindings.length; j++) {
      const binding = bindings[(round + j) % bindings.length];
      const calls = binding.kind === "inproc" ? 100_000 : 1_000;
      const { load, gateWaitS } = await gate();
      const remote0 = binding.kind === "rpc" ? await binding.remoteCpu() : null;
      const cpu0 = cpuMs();
      const t0 = performance.now();
      let sum = 0;
      if (binding.kind === "inproc") for (let i = 0; i < calls; i++) sum += binding.hint("checks/a.check.js", 8);
      else for (let i = 0; i < calls; i++) sum += await binding.hint("checks/a.check.js", 8);
      const wallMs = performance.now() - t0;
      const hostCpuMs = cpuMs() - cpu0;
      if (sum !== calls * 4) throw new Error(`${binding.kind}: hint answered ${sum / calls}`);
      const remoteCpuMs = remote0 === null ? 0 : ((await binding.remoteCpu()).cpuUs - remote0.cpuUs) / 1000;
      record({
        mode: "hint",
        binding: binding.kind,
        round,
        load1: load,
        gateWaitS,
        calls,
        wallUsPerCall: (wallMs * 1000) / calls,
        cpuUsPerCall: ((hostCpuMs + remoteCpuMs) * 1000) / calls,
      });
    }
  for (const binding of bindings) await binding.close();
}
// A cold rpc binding's close ends its child; nothing else keeps the loop alive.
