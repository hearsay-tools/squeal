// Throwaway (row 019-08): the cost of one more Vitest instance in one process.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, countArg = "5", workersArg = "2", filter = "", limitArg = "0"] = process.argv.slice(2);
const limit = Number(limitArg);
const count = Number(countArg);
const workers = Number(workersArg);
const { createVitest } = await import(pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href);

const mb = (bytes) => Math.round(bytes / 1048576);
function rssOf(pid) {
  try {
    const line = readFileSync(`/proc/${pid}/status`, "utf8").split("\n").find((l) => l.startsWith("VmRSS:"));
    return Number(line.split(/\s+/)[1]) * 1024;
  } catch {
    return 0;
  }
}
function descendants(pid) {
  const out = [];
  for (const task of readdirSync(`/proc/${pid}/task`)) {
    let kids = "";
    try {
      kids = readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim();
    } catch {}
    for (const kid of kids.split(/\s+/).filter(Boolean)) out.push(Number(kid), ...descendants(Number(kid)));
  }
  return out;
}
const childRss = () => descendants(process.pid).reduce((sum, pid) => sum + rssOf(pid), 0);
const self = () => {
  global.gc?.();
  const m = process.memoryUsage();
  return { rss: mb(m.rss), heap: mb(m.heapUsed) };
};

let peakChildren = 0;
let peakCount = 0;
const sampler = setInterval(() => {
  const kids = descendants(process.pid);
  const rss = kids.reduce((sum, pid) => sum + rssOf(pid), 0);
  if (rss > peakChildren) peakChildren = rss;
  if (kids.length > peakCount) peakCount = kids.length;
}, 20);

console.log(JSON.stringify({ step: "baseline", ...self() }));
const instances = [];
for (let i = 1; i <= count; i += 1) {
  let t = performance.now();
  const vitest = await createVitest("test", { root, watch: false, reporters: [], fsModuleCache: false, maxWorkers: workers });
  await vitest.standalone();
  const startMs = Math.round(performance.now() - t);
  const afterStart = self();
  const all = await vitest.globTestSpecifications(filter === "" ? undefined : [filter]);
  const specs = limit > 0 ? all.slice(0, limit) : all;
  peakChildren = 0;
  peakCount = 0;
  t = performance.now();
  const first = await vitest.runTestSpecifications(specs);
  const firstMs = Math.round(performance.now() - t);
  const firstPeak = { children: mb(peakChildren), processes: peakCount };
  const afterFirst = self();
  peakChildren = 0;
  t = performance.now();
  await vitest.runTestSpecifications(specs);
  const secondMs = Math.round(performance.now() - t);
  await new Promise((r) => setTimeout(r, 300));
  const afterSecond = self();
  const ok = first.testModules.every((m) => m.ok());
  console.log(
    JSON.stringify({
      step: `instance ${i}`,
      files: specs.length,
      ok,
      startMs,
      firstRunMs: firstMs,
      secondRunMs: secondMs,
      afterStart,
      afterFirst,
      afterSecond,
      workersDuringFirstRun: firstPeak,
      workersAfterRun: { rss: mb(childRss()), processes: descendants(process.pid).length },
    }),
  );
  instances.push(vitest);
}
let t = performance.now();
for (const vitest of instances) await vitest.close();
const closeMs = Math.round(performance.now() - t);
instances.length = 0;
await new Promise((r) => setTimeout(r, 300));
console.log(JSON.stringify({ step: "closed all", closeMs, ...self() }));
clearInterval(sampler);
