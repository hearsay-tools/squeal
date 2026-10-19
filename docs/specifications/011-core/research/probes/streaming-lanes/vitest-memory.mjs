// THROWAWAY probe (011-core/research/streaming-lanes.md). What a second Vitest instance of a real
// project costs the daemon's process: two `createVitest` instances on a scratch clone of Squeal
// (its own vitest.config.ts and globalSetup), each running the same unit test files once.
// RSS and heap of this process after each step, and each instance's start and first run time.
//   node vitest-memory.mjs <project-root> <out.json> <test files...>
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, out, ...files] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const mem = () => {
  global.gc?.();
  const m = process.memoryUsage();
  return { rssMiB: Math.round(m.rss / 2 ** 20), heapMiB: Math.round(m.heapUsed / 2 ** 20) };
};
const steps = [{ step: "start", ...mem() }];
const instances = [];
for (const tag of ["first", "second"]) {
  let t = performance.now();
  const v = await createVitest("test", { root, watch: false, reporters: [] }, {}, {});
  const startMs = Math.round(performance.now() - t);
  steps.push({ step: `${tag} created`, startMs, ...mem() });
  t = performance.now();
  const specs = files.map((f) => v.getRootProject().createSpecification(join(root, f)));
  const run = await v.runTestSpecifications(specs);
  const runMs = Math.round(performance.now() - t);
  const passed = run.testModules.filter((m) => m.state() === "passed").length;
  steps.push({ step: `${tag} ran`, runMs, passed, of: files.length, ...mem() });
  instances.push(v);
}
for (const v of instances) await v.close();
steps.push({ step: "closed", ...mem() });
writeFileSync(out, `${JSON.stringify({ root, files, steps }, null, 2)}\n`);
console.table(steps);
process.exit(0);
