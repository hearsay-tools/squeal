// Creates, runs and closes Vitest instances in one process, then counts the ones still reachable.
//   node --expose-gc repro.mjs [cycles] [snapshot.heapsnapshot]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { writeHeapSnapshot } from "node:v8";
import { createVitest } from "vitest/node";

const [cyclesText = "5", snapshot] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const version = (name) => {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return "none";
  }
};
const collect = async () => {
  for (let i = 0; i < 3; i++) {
    await sleep(50);
    globalThis.gc();
  }
};
const mib = (bytes) => Math.round((bytes / 2 ** 20) * 10) / 10;
const rssAnon = () => mib(Number(/RssAnon:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))[1]) * 1024);

const instances = [];
const reporters = [];
async function cycle() {
  // A reporter of the embedding tool, as any tool that runs Vitest through its Node API passes one.
  const reporter = { name: "tool", onTestRunEnd() {} };
  const vitest = await createVitest("test", { watch: false, reporters: [reporter] });
  await vitest.start();
  await vitest.close();
  instances.push(new WeakRef(vitest));
  reporters.push(new WeakRef(reporter));
}

await collect();
const heap0 = process.memoryUsage().heapUsed;
const anon0 = rssAnon();
for (let i = 0; i < Number(cyclesText); i++) await cycle();
await collect();
const heap = process.memoryUsage().heapUsed;
const anon = rssAnon();
if (snapshot) writeHeapSnapshot(snapshot);
console.log(
  JSON.stringify({
    node: process.version,
    vitest: version("vitest"),
    vite: version("vite"),
    rolldown: version("rolldown"),
    cycles: instances.length,
    instancesAlive: instances.filter((ref) => ref.deref() !== undefined).length,
    reportersAlive: reporters.filter((ref) => ref.deref() !== undefined).length,
    heapUsedMiB: [mib(heap0), mib(heap)],
    rssAnonMiB: [anon0, anon],
  }),
);
