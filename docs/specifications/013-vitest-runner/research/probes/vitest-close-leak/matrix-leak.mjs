// Throwaway probe for research 013-05. Does a closed Vitest instance stay alive?
//   node --expose-gc matrix-leak.mjs <root> <cycles> [break|break-noplugins]
// Each cycle: createVitest with the options Squeal's adapter passes (V1), standalone(), run
// one test file, close(). A WeakRef is kept on each instance. After each close: two full GCs,
// each in its own macrotask (a WeakRef deref keeps its target until the job ends), then the
// count of instances still alive, heapUsed and private memory (RssAnon). With "break", the
// closed instance's retainer is cut first (break.mjs, the fix candidate of question 3);
// "break-noplugins" leaves plugin objects alone.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, cyclesArg, mode] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const version = (p) => { try { return require(`${p}/package.json`).version; } catch { return "none"; } };
const versions = { vitest: version("vitest"), vite: version("vite"), rolldown: version("rolldown") };
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const { breakRetainer } = await import("./break.mjs");
const cut = mode === "break" ? (v) => breakRetainer(v) : mode === "break-noplugins" ? (v) => breakRetainer(v, { plugins: false }) : null;
process.chdir(root);
const tick = () => new Promise((r) => setTimeout(r, 0));
const gc = async () => { for (let i = 0; i < 2; i++) { await tick(); globalThis.gc(); } await tick(); };
const mib = (n) => Math.round(n / 2 ** 20);
const priv = () => Math.round(Number(/RssAnon:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))[1]) / 1024);
const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const refs = [];
await gc();
console.log(JSON.stringify({ versions, mode: mode ?? "plain", cycle: 0, load1: load1(), heapUsedMiB: mib(process.memoryUsage().heapUsed), privMiB: priv() }));
for (let cycle = 1; cycle <= Number(cyclesArg); cycle++) {
  let vitest = await createVitest("test", {
    root, watch: false, reporters: [{}], update: "none", includeTaskLocation: true, fsModuleCache: false, maxWorkers: 2,
  });
  await vitest.standalone();
  const specs = await vitest.globTestSpecifications();
  const one = specs.filter((s) => s.moduleId.endsWith("m1.test.ts"));
  const result = await vitest.runTestSpecifications(one);
  const failed = result.testModules.filter((m) => m.state() !== "passed").length;
  refs.push(new WeakRef(vitest));
  await vitest.close();
  if (cut) cut(vitest);
  vitest = null;
  await gc();
  const alive = refs.filter((r) => r.deref() !== undefined).length;
  await gc();
  console.log(JSON.stringify({ versions, mode: mode ?? "plain", cycle, failed, alive, load1: load1(), heapUsedMiB: mib(process.memoryUsage().heapUsed), privMiB: priv() }));
}
process.exit(0);
