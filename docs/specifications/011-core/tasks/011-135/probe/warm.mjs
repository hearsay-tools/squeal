// Row 011-135 probe, step 3: the same comparison inside one warm Vitest instance, as the daemon
// holds one per worktree (013 V1): whole file, focused, focused, timed per
// `runTestSpecifications` call, with the per-specification `testNamePattern` the adapter would
// pass. Usage: node warm.mjs <repo root> <test file> <pattern>
// Prints each call's wall time, the reporter's case counts by state, and the module duration.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, file, pattern] = process.argv.slice(2);
const { createVitest } = await import(pathToFileURL(resolve(root, "node_modules/vitest/dist/node.js")).href);
let counts = {};
const reporter = {
  onTestCaseResult(test) {
    const state = test.result().state;
    counts[state] = (counts[state] ?? 0) + 1;
  },
};
const vitest = await createVitest("test", { root, watch: false, reporters: [reporter], includeTaskLocation: true });
const abs = resolve(root, file);
const project = vitest.projects.find((p) => p.matchesTestGlob(abs));
if (!project) throw new Error(`no project holds ${file}`);
const steps = [
  ["whole", undefined],
  ["focused", { testNamePattern: new RegExp(pattern) }],
  ["focused", { testNamePattern: new RegExp(pattern) }],
];
for (const [label, options] of steps) {
  counts = {};
  const spec = project.createSpecification(abs, options);
  const t0 = performance.now();
  await vitest.runTestSpecifications([spec]);
  const wall = (performance.now() - t0) / 1000;
  const module = spec.testModule;
  const duration = module ? (module.diagnostic().duration / 1000).toFixed(1) : "?";
  console.log(`${label}\twall ${wall.toFixed(1)} s\tmodule ${duration} s\t${JSON.stringify(counts)}`);
}
await vitest.close();
