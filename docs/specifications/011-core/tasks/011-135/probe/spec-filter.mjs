// Row 011-135 probe: what Vitest's node API reports for a specification with a name filter,
// the seam the adapter would use (`project.createSpecification(path, { testNamePattern })`).
// Usage: node spec-filter.mjs <repo root> <test file> <pattern | -> [<testId>...]
// `-` runs the whole file; otherwise the pattern is a RegExp source. Extra arguments are
// Vitest task ids for `testIds` instead of a pattern. Prints one line per reporter event.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [root, file, pattern, ...ids] = process.argv.slice(2);
const { createVitest } = await import(pathToFileURL(resolve(root, "node_modules/vitest/dist/node.js")).href);
const events = [];
const reporter = {
  onTestCaseResult(test) {
    const r = test.result();
    events.push(`case ${r.state.padEnd(7)} ${test.fullName}`);
  },
  onTestModuleEnd(module) {
    events.push(`module end ${module.moduleId.slice(root.length + 1)} state=${module.state()}`);
  },
};
const vitest = await createVitest("test", { root, watch: false, reporters: [reporter], includeTaskLocation: true });
const abs = resolve(root, file);
const project = vitest.projects.find((p) => p.matchesTestGlob(abs)) ?? vitest.projects[0];
const options =
  ids.length > 0 ? { testIds: ids } : pattern === "-" ? undefined : { testNamePattern: new RegExp(pattern) };
const spec = project.createSpecification(abs, options);
const started = performance.now();
await vitest.runTestSpecifications([spec]);
const wall = performance.now() - started;
for (const e of events) console.log(e);
// Every task the module holds, with its mode, to see what a filter leaves out.
const module = spec.testModule;
if (module) {
  let skipped = 0;
  let total = 0;
  for (const t of module.children.allTests()) {
    total += 1;
    if (t.result().state === "skipped") skipped += 1;
  }
  console.log(`module tests ${total}, reported skipped ${skipped}, cases reported ${events.filter((e) => e.startsWith("case")).length}`);
  console.log(`module diagnostic duration ${Math.round(module.diagnostic().duration)} ms`);
}
console.log(`project ${project.name}; runTestSpecifications wall ${Math.round(wall)} ms`);
await vitest.close();
