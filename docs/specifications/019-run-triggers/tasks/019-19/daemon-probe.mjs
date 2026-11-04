// Row 019-19: 019-12's heap-probe.mjs (tasks/019-12/notes.md), and a heap snapshot of the daemon
// after the last cycle when <snapshot> is given. Usage:
//   node daemon-probe.mjs <squeal cli> <arm: slow|fast> <cycles> <port> <workdir> <node_modules> [<snapshot>]
// <squeal cli> is a build's dist/cli/index.js; <node_modules> holds Vitest, linked into the fixture.
// Builds a fixture repo under <workdir>/<arm>, starts the daemon of <squeal cli>
// in it with HOME and XDG dirs under <workdir>/<arm>, edits the module every
// test file imports <cycles> times, and after each pass reads the daemon's
// heap through its inspector (activated by SIGUSR1 on <port>) after two GCs.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [cli, arm, cyclesText, portText, workdir, nodeModules, snapshot] = process.argv.slice(2);
const cycles = Number(cyclesText);
const port = Number(portText);
const base = join(workdir, arm);
const repo = join(base, "repo");
rmSync(base, { recursive: true, force: true });
for (const dir of ["home", "config", "run", "repo/src", "repo/test/slow", "repo/test/fast"])
  mkdirSync(join(base, dir), { recursive: true, mode: 0o700 });
const env = {
  ...process.env,
  HOME: join(base, "home"),
  XDG_CONFIG_HOME: join(base, "config"),
  XDG_RUNTIME_DIR: join(base, "run"),
  NODE_OPTIONS: `--inspect-port=127.0.0.1:${port}`,
};
delete env.SQUEAL_DAEMON_CHILD;

const MODULES = 120;
const FILES = 10;
const data = (i) => JSON.stringify(Array.from({ length: 200 }, (_, j) => `m${i}-${j}-${"x".repeat(20)}`));
const writeM0 = (n) =>
  writeFileSync(join(repo, "src/m0.ts"), `export const edit = ${n};\nexport const data0 = ${data(0)};\nexport function f0(x: number): number { return x + edit; }\n`);
writeM0(0);
for (let i = 1; i < MODULES; i++)
  writeFileSync(join(repo, `src/m${i}.ts`), `import { f${i - 1} } from "./m${i - 1}.js";\nexport const data${i} = ${data(i)};\nexport function f${i}(x: number): number { return f${i - 1}(x) + data${i}.length; }\n`);
for (let t = 0; t < FILES; t++) {
  const m = MODULES - 1 - t;
  const tests = Array.from({ length: 5 }, (_, k) => `test("t${k}", () => { expect(f${m}(${k})).toBeGreaterThan(0); });`).join("\n");
  writeFileSync(join(repo, `test/slow/t${t}.test.ts`), `import { expect, test } from "vitest";\nimport { f${m} } from "../../src/m${m}.js";\n${tests}\n`);
}
writeFileSync(join(repo, "test/fast/f.test.ts"), `import { expect, test } from "vitest";\nimport { f0 } from "../../src/m0.js";\ntest("f", () => { expect(f0(1)).toBeGreaterThan(0); });\n`);
writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "heap-probe", private: true, type: "module" })}\n`);
const lifecycle = join(base, "lifecycle.log");
writeFileSync(join(repo, "setup.mjs"), `import { appendFileSync } from "node:fs";\nexport default function () {\n  appendFileSync(${JSON.stringify(lifecycle)}, "setup\\n");\n  return () => appendFileSync(${JSON.stringify(lifecycle)}, "teardown\\n");\n}\n`);
writeFileSync(join(repo, "vitest.config.mjs"), `export default { test: { include: ["test/**/*.test.ts"], globalSetup: ["./setup.mjs"] } };\n`);
writeFileSync(join(repo, ".gitignore"), "node_modules\n");
const slow = arm === "slow" ? { include: ["test/slow/**"], trigger: "continuous", quietMs: 0, maxLoadPerCpu: 1000 } : {};
writeFileSync(join(repo, "squeal.config.json"), `${JSON.stringify({ slow }, null, 2)}\n`);
symlinkSync(nodeModules, join(repo, "node_modules"));
const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
git("init", "-q");
git("add", "-A");
git("-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "fixture");

const squeal = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: repo, env, encoding: "utf8", timeout: 900_000 });
process.on("exit", () => squeal("stop", repo));
const started = squeal("start", repo);
if (started.status !== 0 && started.status !== 3) console.error(started.stdout, started.stderr);
const pid = Number(execFileSync("pgrep", ["-f", `index.js daemon ${repo}`], { encoding: "utf8" }).trim().split("\n")[0]);
const waited = () => squeal("status", "--wait", "600000");
const all = squeal("run", "--all", "--wait");
console.log(`baseline: exit ${all.status}`);
waited();

process.kill(pid, "SIGUSR1");
let url = null;
for (let i = 0; i < 50 && url === null; i++) {
  await sleep(100);
  try {
    url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0].webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(url);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const reply = JSON.parse(event.data);
  if (reply.method === "HeapProfiler.addHeapSnapshotChunk") appendFileSync(snapshot, reply.params.chunk);
  pending.get(reply.id)?.(reply);
});
const call = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const anon = () => {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  return Number(/^RssAnon:\s+(\d+)/m.exec(status)[1]) / 1024;
};
const mb = (b) => Math.round((b / 2 ** 20) * 10) / 10;
async function measure(label) {
  await call("HeapProfiler.collectGarbage");
  await call("HeapProfiler.collectGarbage");
  const reply = await call("Runtime.evaluate", { expression: "JSON.stringify(process.memoryUsage())", returnByValue: true });
  const usage = JSON.parse(reply.result.result.value);
  const children = execFileSync("sh", ["-c", `pgrep -P ${pid} | wc -l`], { encoding: "utf8" }).trim();
  const load = readFileSync("/proc/loadavg", "utf8").split(" ")[0];
  let lines = [];
  try {
    lines = readFileSync(lifecycle, "utf8").trim().split("\n");
  } catch {}
  const setups = lines.filter((l) => l === "setup").length;
  const teardowns = lines.filter((l) => l === "teardown").length;
  const row = { label, heapMb: mb(usage.heapUsed), heapTotalMb: mb(usage.heapTotal), externalMb: mb(usage.external), rssMb: mb(usage.rss), anonMb: Math.round(anon() * 10) / 10, children: Number(children), setups, teardowns, load: Number(load) };
  console.log(JSON.stringify(row));
}
await measure("start");
for (let c = 1; c <= cycles; c++) {
  const t0 = Date.now();
  writeM0(c);
  await sleep(1500);
  waited();
  await sleep(5000);
  await measure(`cycle ${c} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
if (snapshot) {
  writeFileSync(snapshot, "");
  await call("HeapProfiler.collectGarbage");
  await call("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
}
const status = squeal("status");
console.log(status.stdout.split("\n").slice(0, 4).join("\n"));
ws.close();
process.exit(0);
