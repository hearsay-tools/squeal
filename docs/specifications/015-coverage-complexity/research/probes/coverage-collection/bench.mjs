// Throwaway probe (015-01): one warm Vitest instance over a sample of test
// files, Squeal's options, `maxWorkers: 4`, coverage off or on. Times one
// warm-up-free run (what a Squeal tier pays) and, for v8, the per-test-file
// conversion to source (`convertCoverage` per batch).
//
// node bench.mjs <node_modules dir> <root> <mode: off|v8|istanbul|own> <reports dir> <list file>
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const [modules, root, mode, reports, listFile] = process.argv.slice(2);
const wanted = new Set(readFileSync(listFile, "utf8").split("\n").filter(Boolean));
const { createVitest } = await import(pathToFileURL(join(modules, "vitest/dist/node.js")).href);
const states = {};
const coverage = {
  off: {},
  v8: { coverage: { enabled: true, provider: "v8", reporter: [], reportsDirectory: reports, include: ["src/**"] } },
  istanbul: {
    coverage: { enabled: true, provider: "istanbul", reporter: [], reportsDirectory: reports, include: ["src/**"] },
  },
  own: {
    coverage: {
      enabled: true,
      provider: "custom",
      customProviderModule: new URL("./own-provider.mjs", import.meta.url).pathname,
      reportsDirectory: reports,
    },
  },
}[mode];
const vitest = await createVitest("test", {
  root,
  watch: false,
  reporters: [{ onTestModuleEnd: (m) => (states[relative(root, m.moduleId)] = m.state()) }],
  update: "none",
  includeTaskLocation: true,
  fsModuleCache: false,
  maxWorkers: 4,
  ...coverage,
});
await vitest.standalone();
const batches = [];
const provider = vitest.coverageProvider;
const keep = join(reports, "batches");
mkdirSync(keep, { recursive: true });
if (provider) {
  const original = provider.onAfterSuiteRun.bind(provider);
  provider.onAfterSuiteRun = (meta) => {
    const copy = join(keep, `${batches.length}.json`);
    copyFileSync(meta.coverage, copy);
    batches.push({ testFiles: meta.testFiles, environment: meta.environment, copy, bytes: statSync(copy).size });
    return original(meta);
  };
}
const specs = (await vitest.globTestSpecifications()).filter((s) => wanted.has(relative(root, s.moduleId)));
const cpu0 = process.cpuUsage();
const t0 = performance.now();
await vitest.runTestSpecifications(specs);
const runMs = performance.now() - t0;
const mainCpu = process.cpuUsage(cpu0);
let convertMs = null;
let mappedBytes = null;
if (mode === "v8") {
  const c0 = performance.now();
  mappedBytes = [];
  for (const b of batches) {
    const map = await provider.convertCoverage(JSON.parse(readFileSync(b.copy, "utf8")), vitest.getRootProject(), b.environment);
    mappedBytes.push(JSON.stringify(map.toJSON()).replaceAll(root, "").length);
  }
  convertMs = Math.round(performance.now() - c0);
}
await vitest.close();
const counts = {};
for (const s of Object.values(states)) counts[s] = (counts[s] ?? 0) + 1;
const failed = Object.entries(states).filter(([, s]) => s !== "passed").map(([f]) => f);
console.log(
  `RESULT ${JSON.stringify({
    mode,
    files: specs.length,
    runMs: Math.round(runMs),
    mainCpuMs: Math.round((mainCpu.user + mainCpu.system) / 1000),
    mainRssMb: Math.round(process.memoryUsage().rss / 1048576),
    states: counts,
    failed,
    batches: batches.length,
    rawBytes: batches.map((b) => b.bytes),
    convertMs,
    mappedBytes,
  })}`,
);
