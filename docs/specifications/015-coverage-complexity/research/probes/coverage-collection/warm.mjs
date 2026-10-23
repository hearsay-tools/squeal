// Throwaway probe (015-01). Drives one warm Vitest instance with the options
// Squeal's adapter passes (`src/runners/vitest/adapter.ts`, `#start`), plus a
// coverage option, and captures each worker batch's raw coverage payload as
// `onAfterSuiteRun` hands it to the provider.
//
// node warm.mjs <node_modules dir> <project root> <mode> [config file] [runs] [files...]
//   mode: none | v8 | istanbul | own (own-provider.mjs) | project (no coverage option; the config's own)
// Prints one JSON object.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modules, rootArg, mode, configArg, runsArg, ...only] = process.argv.slice(2);
const root = resolve(rootArg);
const { createVitest } = await import(pathToFileURL(join(modules, "vitest/dist/node.js")).href);

const states = {};
const seen = [];
const runErrors = [];
const reporter = {
  onUserConsoleLog(log) {
    if (log.content.startsWith("SEEN ")) seen.push(JSON.parse(log.content.slice(5)));
  },
  onTestRunEnd(_modules, errors) {
    for (const e of errors) runErrors.push(String(e.message).slice(0, 300));
  },
  onTestModuleEnd(m) {
    states[relative(root, m.moduleId)] = m.state();
  },
};
const keep = join(root, "..", `${mode}-payloads`);
mkdirSync(keep, { recursive: true });
const coverage =
  mode === "v8" || mode === "istanbul"
    ? {
        coverage: {
          enabled: true,
          provider: mode,
          reporter: [],
          reportsDirectory: join(root, "..", `${mode}-reports`),
          include: ["src/**"],
        },
      }
    : mode === "own"
      ? {
          coverage: {
            enabled: true,
            provider: "custom",
            customProviderModule: new URL("./own-provider.mjs", import.meta.url).pathname,
            reportsDirectory: join(root, "..", "own-reports"),
          },
        }
      : {};
const t0 = performance.now();
const vitest = await createVitest("test", {
  root,
  ...(configArg && configArg !== "-" ? { config: configArg } : {}),
  watch: false,
  reporters: [reporter],
  update: "none",
  includeTaskLocation: true,
  fsModuleCache: false,
  ...coverage,
});
await vitest.standalone();
const startMs = performance.now() - t0;
const batches = [];
const provider = vitest.coverageProvider;
if (provider) {
  const original = provider.onAfterSuiteRun.bind(provider);
  provider.onAfterSuiteRun = (meta) => {
    const copy = join(keep, `${batches.length}.json`);
    copyFileSync(meta.coverage, copy);
    batches.push({ testFiles: meta.testFiles.map((f) => relative(root, f)), environment: meta.environment, copy, bytes: statSync(copy).size });
    return original(meta);
  };
}
let specs = await vitest.globTestSpecifications();
if (only.length > 0) specs = specs.filter((s) => only.some((o) => s.moduleId.endsWith(o)));
const runs = [];
for (let i = 0; i < Number(runsArg || 1); i++) {
  const before = batches.length;
  const r0 = performance.now();
  await vitest.runTestSpecifications(specs);
  runs.push({ ms: Math.round(performance.now() - r0), batches: batches.length - before });
}
const exitCode = process.exitCode;
// PROBE_CONVERT=1 with mode v8: map each batch to source through the provider's
// own `convertCoverage` (v8 ranges + transform source map -> istanbul), per test file.
const converted = [];
if (process.env.PROBE_CONVERT === "1" && provider?.name === "v8") {
  for (const b of batches) {
    const c0 = performance.now();
    const map = await provider.convertCoverage(JSON.parse(readFileSync(b.copy, "utf8")), vitest.getRootProject(), b.environment);
    const ms = performance.now() - c0;
    const json = JSON.stringify(map.toJSON()).replaceAll(root, "<root>");
    writeFileSync(`${b.copy}.istanbul.json`, json);
    converted.push({
      testFiles: b.testFiles,
      ms: Math.round(ms * 10) / 10,
      bytes: json.length,
      files: Object.values(map.toJSON()).map((fc) => ({
        path: relative(root, fc.path),
        functions: Object.entries(fc.fnMap).map(([id, fn]) => `${fn.name}@${fn.decl.start.line}:${fc.f[id]}`),
        branches: Object.entries(fc.branchMap).map(([id, br]) => `${br.type}@${br.loc.start.line}:${fc.b[id].join("/")}`),
        coveredLines: Object.entries(map.fileCoverageFor(fc.path).getLineCoverage()).filter(([, n]) => n > 0).map(([l]) => Number(l)),
      })),
    });
  }
}
await vitest.close();

function summarize(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(data.result)) {
    // v8: ScriptCoverage[]; keep project sources only.
    return data.result
      .filter((s) => s.url.includes("/src/"))
      .map((s) => ({
        url: s.url.replace(pathToFileURL(root).href, "<root>"),
        functions: s.functions.map((f) => ({
          name: f.functionName,
          count: f.ranges[0].count,
          ranges: f.ranges.length,
          blockCoverage: f.isBlockCoverage,
        })),
      }));
  }
  // istanbul: { [path]: FileCoverage }
  return Object.values(data).map((fc) => ({
    path: relative(root, fc.path),
    functions: Object.entries(fc.fnMap).map(([id, fn]) => ({ name: fn.name, line: fn.loc.start.line, count: fc.f[id] })),
    branches: Object.keys(fc.branchMap).length,
    statements: Object.keys(fc.statementMap).length,
  }));
}

console.log(
  JSON.stringify(
    {
      mode,
      startMs: Math.round(startMs),
      runs,
      states,
      seen,
      runErrors,
      exitCode: exitCode ?? null,
      providerName: provider?.name ?? null,
      wroteInRoot: ["coverage", "html", "lcov-report"].filter((d) => existsSync(join(root, d))),
      converted,
      batches: batches.map((b) => ({ ...b, coverage: summarize(b.copy) })),
    },
    null,
    1,
  ),
);
