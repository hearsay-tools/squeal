// Throwaway probe for research 011-52. Run only inside the scratch made by run-two-roots.sh.
// Question: in one Node process, what does a second Vitest instance for another root cost, and
// does a test run for root B see root B as its cwd while the process cwd is root A?
// Usage: node --expose-gc two-roots.mjs <mode> <rootA> [<rootB>]
//   mode "bare": no Vitest; "one": one instance (root A); "two": instances for A and B.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [mode, rootA, rootB] = process.argv.slice(2);
const priv = () => {
  const s = readFileSync("/proc/self/status", "utf8");
  const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
  return Math.round((kb("RssAnon") + kb("RssShmem")) / 1024);
};
const report = (label) => {
  globalThis.gc();
  const m = process.memoryUsage();
  console.log(JSON.stringify({ label, cwd: process.cwd(), privMiB: priv(),
    heapUsedMiB: Math.round(m.heapUsed / 2 ** 20), heapTotalMiB: Math.round(m.heapTotal / 2 ** 20),
    externalMiB: Math.round(m.external / 2 ** 20), load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0] }));
};
report("start");
if (mode === "bare") process.exit(0);
const { createVitest } = await import(pathToFileURL(join(rootA, "node_modules/vitest/dist/node.js")).href);
async function run(root, label) {
  const vitest = await createVitest("test", { root, watch: false, reporters: [["default", { summary: false }]] });
  const t = Date.now();
  await vitest.start();
  const files = vitest.state.getFiles().map((f) => `${f.name}:${f.result?.state}`);
  console.log(JSON.stringify({ label, root, files, ms: Date.now() - t }));
  report(`after ${label}`);
  return vitest;
}
process.chdir(rootA);
const a = await run(rootA, "A with cwd A");
if (mode === "two") {
  // The process cwd stays at A, as a shared process serving A would leave it.
  const b = await run(rootB, "B with cwd A");
  process.chdir(rootB);
  await b.close();
  const b2 = await run(rootB, "B with cwd B");
  await b2.close();
}
await a.close();
report("after close");
process.exit(0);
