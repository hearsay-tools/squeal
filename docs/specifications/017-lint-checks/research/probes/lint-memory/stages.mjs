// Throwaway probe for research 017-26. Runs Squeal's own ESLint worker (the bundle's
// `lint-worker.mjs`, through `worker-wrap.mjs`) outside the daemon, with the calls a first
// pass makes, with inputs first so the config load and the program walk read apart: open, inputs
// for every listed file (loads the config, computes each file's config), refresh (the program walk), then lint in parts of 16 with
// each file's text and blob. After each stage it runs a major GC in the worker's isolate
// and logs that isolate's live heap and the process's RSS; with LM_NOGC=1 it logs without
// GC. The driver's own isolate holds only the file list and one part's texts.
//   node --expose-gc stages.mjs <root> <bundle-cli-dir> <out.jsonl> [label]
// Environment: ESLINT_FLAGS passes through, as the daemon's would. LM_IDLE_S (default 0)
// adds idle samples, without GC, every 5 s for that long after the last stage. LM_OLD_MB
// (and LM_YOUNG_MB) start the worker with that `resourceLimits` cap, as a bound would.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MessageChannel, Worker } from "node:worker_threads";
import v8 from "node:v8";
import { smaps } from "./smaps.mjs";

const [root, cli, out, label = ""] = process.argv.slice(2);
const WRAP = fileURLToPath(new URL("./worker-wrap.mjs", import.meta.url));
const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10;
const status = () => {
  const s = readFileSync("/proc/self/status", "utf8");
  const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
  return { rssMiB: mib(kb("VmRSS") * 1024), hwmMiB: mib(kb("VmHWM") * 1024), anonMiB: mib(kb("RssAnon") * 1024) };
};
const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 1 << 28 })
  .toString()
  .split("\0")
  .filter((p) => p && !p.split("/").includes("node_modules"));

const { port1, port2 } = new MessageChannel();
const worker = new Worker(WRAP, {
  workerData: { root, format: "sha1", lmPort: port2, lmReal: pathToFileURL(join(cli, "lint-worker.mjs")).href },
  transferList: [port2],
  env: { ...process.env, TSESTREE_SINGLE_RUN: "false" },
  execArgv: [],
  ...(process.env.LM_OLD_MB ? { resourceLimits: { maxOldGenerationSizeMb: Number(process.env.LM_OLD_MB), ...(process.env.LM_YOUNG_MB ? { maxYoungGenerationSizeMb: Number(process.env.LM_YOUNG_MB) } : {}) } } : {}),
  stdout: true,
  stderr: true,
});
worker.stdout.resume();
worker.stderr.resume();
let calls = 0;
const waiting = new Map();
worker.on("message", (m) => {
  if (m.type === "progress" || m.type === "building") return;
  waiting.get(m.id)?.(m);
});
worker.on("error", (e) => {
  appendFileSync(out, `${JSON.stringify({ label, stage: "worker-error", error: String(e), ...status() })}\n`);
  console.error("worker error", e);
  process.exit(2);
});
const call = (message) =>
  new Promise((resolve, reject) => {
    const id = ++calls;
    waiting.set(id, (m) => {
      waiting.delete(id);
      if (m.type === "error") reject(new Error(m.message));
      else resolve(m.answer);
    });
    worker.postMessage({ ...message, id });
  });
const probe = new Map();
port1.on("message", (m) => probe.get(m.id)?.(m));
const ask = (gc) =>
  new Promise((resolve) => {
    const id = ++calls;
    probe.set(id, resolve);
    port1.postMessage({ id, gc });
  });
const t0 = Date.now();
const NOGC = process.env.LM_NOGC === "1";
const log = async (stage, extra = {}, gc = NOGC ? null : "major") => {
  const answer = await ask(gc);
  const line = { label, stage, s: Math.round((Date.now() - t0) / 100) / 10, load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], ...status(), cpuS: Math.round((process.cpuUsage().user + process.cpuUsage().system) / 1e5) / 10, oldMb: process.env.LM_OLD_MB ?? null, smaps: smaps(), driverHeapMiB: mib(v8.getHeapStatistics().total_physical_size), worker: answer.after, workerBeforeGc: answer.before, pauseMs: answer.pauseMs, ...extra };
  appendFileSync(out, `${JSON.stringify(line)}\n`);
  console.log(stage, line.rssMiB, "MiB RSS, worker live", answer.after.usedMiB, "MiB, before GC", answer.before.usedMiB);
};
const blob = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

await log("started", { listed: listed.length });
const opened = await call({ type: "open" });
await log("open", { answer: opened.type, reason: opened.reason });
if (opened.type === "off") process.exit(1);
const inputs = await call({ type: "inputs", paths: listed });
const lintable = inputs.inputs.map(([p]) => p);
const configBytes = inputs.inputs.reduce((n, [, i]) => n + i.config.length, 0);
const distinct = new Set(inputs.inputs.map(([, i]) => i.config));
await log("inputs", {
  lintable: lintable.length,
  wholeProgram: inputs.inputs.filter(([, i]) => i.wholeProgram).length,
  configJsonMiB: mib(configBytes),
  distinctConfigs: distinct.size,
  distinctConfigJsonMiB: mib([...distinct].reduce((n, c) => n + c.length, 0)),
});
const snap = await call({ type: "refresh", fresh: false });
await log("refresh", {
  closure: snap.env?.closure?.length,
  packages: snap.env?.packages?.length,
  program: snap.env?.program?.length,
  held: snap.delta?.held?.length,
  walked: snap.delta?.walked?.length,
  lookups: snap.delta?.lookups?.length,
});
let held = 0;
let walked = 0;
let unknown = 0;
let findings = 0;
let peakAnswerMiB = 0;
const heldPaths = new Set();
for (let i = 0; i < lintable.length; i += 16) {
  const files = lintable.slice(i, i + 16).map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, text: bytes.toString("utf8"), blob: blob(bytes) };
  });
  const answer = await call({ type: "lint", files });
  peakAnswerMiB = Math.max(peakAnswerMiB, mib(JSON.stringify(answer).length));
  for (const [path] of answer.delta.held) heldPaths.add(path);
  held += answer.delta.held.length;
  walked += answer.delta.walked.length;
  for (const [, r] of answer.results) {
    if ("unknown" in r) unknown++;
    else findings += r.messages.length;
  }
  if ((i / 16) % 40 === 0) await log(`lint-part-${i / 16}`, {}, null);
}
await log("linted", { unknown, findings, heldPathsTotal: heldPaths.size, heldEntriesSent: held, walkedSent: walked, peakAnswerMiB });
const idle = Number(process.env.LM_IDLE_S ?? 0);
for (let s = 5; s <= idle; s += 5) {
  await new Promise((r) => setTimeout(r, 5000));
  const answer = await ask(null);
  appendFileSync(out, `${JSON.stringify({ label, stage: `idle-${s}s`, ...status(), smaps: smaps(), worker: answer.after })}\n`);
}
await worker.terminate();
