// Throwaway probe (015-01): one v8 run over a sample, each batch mapped to
// source through the provider's `convertCoverage`, reduced to what a compact
// per-test-file record would hold: per source, its executable lines, the
// covered ones, and per function its name, line and hits. Writes one JSON.
//
// node lines.mjs <node_modules dir> <root> <list file> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const [modules, root, listFile, out] = process.argv.slice(2);
const wanted = new Set(readFileSync(listFile, "utf8").split("\n").filter(Boolean));
const { createVitest } = await import(pathToFileURL(join(modules, "vitest/dist/node.js")).href);
const reports = "/tmp/sq015-rep/lines";
const vitest = await createVitest("test", {
  root,
  watch: false,
  reporters: [{}],
  update: "none",
  includeTaskLocation: true,
  fsModuleCache: false,
  maxWorkers: 4,
  coverage: { enabled: true, provider: "v8", reporter: [], reportsDirectory: reports, include: ["src/**"] },
});
await vitest.standalone();
const provider = vitest.coverageProvider;
const batches = [];
const original = provider.onAfterSuiteRun.bind(provider);
provider.onAfterSuiteRun = (meta) => {
  batches.push({ testFiles: meta.testFiles, environment: meta.environment, raw: readFileSync(meta.coverage, "utf8") });
  return original(meta);
};
const specs = (await vitest.globTestSpecifications()).filter((s) => wanted.has(relative(root, s.moduleId)));
await vitest.runTestSpecifications(specs);
const records = {};
for (const b of batches) {
  const map = await provider.convertCoverage(JSON.parse(b.raw), vitest.getRootProject(), b.environment);
  const sources = {};
  for (const path of map.files()) {
    const fc = map.fileCoverageFor(path);
    const lines = fc.getLineCoverage();
    const data = fc.toJSON();
    sources[relative(root, path)] = {
      lines: Object.keys(lines).map(Number),
      covered: Object.entries(lines)
        .filter(([, n]) => n > 0)
        .map(([l]) => Number(l)),
      functions: Object.entries(data.fnMap).map(([id, fn]) => [fn.name, fn.decl.start.line, data.f[id]]),
    };
  }
  records[relative(root, b.testFiles[0])] = sources;
}
await vitest.close();
writeFileSync(out, JSON.stringify(records));
console.log(`wrote ${Object.keys(records).length} records`);
