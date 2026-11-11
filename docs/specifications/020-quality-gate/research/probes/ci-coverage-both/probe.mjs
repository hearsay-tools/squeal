// Throwaway probe for research/ci-coverage-both.md (row 020-26, #189).
// Runs in an installed copy of ./fixture (see run.sh), one Vitest run per call:
//
//   node probe.mjs <mode> <outDir> [file filters...]
//
// Modes:
//   plain       the project's own V8 provider, nothing of Squeal's
//   squeal      today's `ci record`: coverage.enabled off, Squeal's provider
//               through `coverage.cjs`'s `startCoverage`, as the ci runtime calls it
//   tee         the project's V8 provider stays; its `onAfterSuiteRun` is wrapped,
//               each payload is copied (Vitest 5: a path) or written (Vitest 4.1:
//               an object) for Squeal, and `coverage.cjs` maps the copies
//   tee-nocopy  as tee, but Squeal's mapper gets the provider's own payload path
//               (the mapper deletes a payload once read)
//
// Env: SQUEAL_COVERAGE_CJS (src/runners/vitest/ci-runtime/coverage.cjs),
// SQUEAL_PROVIDER (dist/coverage/provider.mjs), SQUEAL_MAPPER
// (dist/cli/coverage-map.mjs), NAME_FILTER (a -t pattern).
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { createVitest } from "vitest/node";

const require = createRequire(import.meta.url);
const [mode, outArg, ...filters] = process.argv.slice(2);
const out = resolve(outArg, mode);
// A run with no report of its own must not show the last run's.
rmSync(join(process.cwd(), "coverage"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const { startCoverage } = require(process.env.SQUEAL_COVERAGE_CJS);
const settings = {
  provider: process.env.SQUEAL_PROVIDER,
  worker: { script: process.env.SQUEAL_MAPPER },
  dir: join(out, "squeal-dir"),
  root: process.cwd(),
  format: "sha1",
};
const name = process.env.NAME_FILTER;
const options = {
  watch: false,
  reporters: [],
  // COVERAGE=1: `--coverage.enabled`, as cezarion's PR shards pass it.
  ...(process.env.COVERAGE === "1" ? { coverage: { enabled: true } } : {}),
  ...(mode === "squeal" ? { coverage: { enabled: false } } : {}),
  ...(name ? { testNamePattern: name } : {}),
  // A real CI shard (cezar-shard.sh): SHARD=1/4 MAX_WORKERS=4.
  ...(process.env.SHARD ? { shard: process.env.SHARD } : {}),
  ...(process.env.MAX_WORKERS ? { maxWorkers: Number(process.env.MAX_WORKERS) } : {}),
  ...(process.env.PROJECTS ? { project: process.env.PROJECTS.split(",") } : {}),
};

const teeDir = join(out, "tee");
const teeLog = [];
let coverage = null;
let vitest;

/** Tee: the project's provider keeps every payload; Squeal gets a copy. */
function patchProvider(nocopy) {
  const provider = vitest.coverageProvider;
  const batches = [];
  const original = provider.onAfterSuiteRun.bind(provider);
  let n = 0;
  provider.onAfterSuiteRun = (meta) => {
    const result = original(meta);
    try {
      let payload = meta.coverage;
      mkdirSync(teeDir, { recursive: true });
      if (typeof payload === "string") {
        if (!nocopy) {
          const copy = join(teeDir, basename(payload));
          copyFileSync(payload, copy);
          payload = copy;
        }
      } else if (payload && typeof payload === "object") {
        const file = join(teeDir, `object-${n++}.json`);
        writeFileSync(file, JSON.stringify(payload));
        payload = file;
      }
      teeLog.push({ type: typeof meta.coverage, testFiles: meta.testFiles, project: meta.projectName });
      batches.push({ ...meta, coverage: payload });
    } catch (error) {
      teeLog.push({ error: String(error) });
    }
    return result;
  };
  provider.takeBatches = () => batches.splice(0);
  if (nocopy) {
    // Give Squeal's mapper time to finish before the provider reads its
    // payloads, as on a long run where early files are mapped long before
    // the run ends.
    const generate = provider.generateCoverage.bind(provider);
    provider.generateCoverage = async (...args) => {
      await new Promise((r) => setTimeout(r, 2000));
      return generate(...args);
    };
  }
}

const modules = new Map();
const reporter = {
  onTestRunStart(specifications) {
    if (mode.startsWith("tee")) patchProvider(mode === "tee-nocopy");
    coverage?.runStart(specifications);
  },
  onTestModuleEnd(module) {
    modules.set(`${module.project.name}\0${module.moduleId}`, {
      project: module.project.name,
      moduleId: module.moduleId,
    });
    coverage?.take();
  },
  async onTestRunEnd() {
    if (coverage === null) return;
    const ended = await coverage.end([...modules.values()]);
    const files = {};
    for (const [key, value] of ended.files) {
      const [project, id] = key.split("\0");
      const file = `${project}:${id.slice(process.cwd().length + 1)}`;
      files[file] =
        "record" in value
          ? { paths: value.record.paths, unread: value.record.unread, parts: value.record.parts }
          : { none: value.none };
    }
    writeFileSync(join(out, "records.json"), JSON.stringify({ header: ended.header, files }, null, 1));
  },
};
options.reporters = [reporter];

vitest = await createVitest("test", options);
if (mode === "squeal") {
  coverage = startCoverage(vitest, settings);
} else if (mode.startsWith("tee")) {
  // `coverage.cjs` as it is, shown a view of the run whose own coverage is
  // off, so it maps batches from `coverageProvider.takeBatches` and leaves
  // the project's provider in place (the override goes to a throwaway).
  const view = Object.create(vitest, {
    config: { value: { ...vitest.config, coverage: { ...vitest.config.coverage, enabled: false } } },
    configOverride: { value: {} },
  });
  coverage = startCoverage(view, settings);
}
let error = null;
try {
  await vitest.start(filters);
} catch (e) {
  error = String(e?.stack ?? e);
}
const exitCode = process.exitCode ?? 0;
await vitest.close();
const report = vitest.config.coverage?.reportsDirectory ?? join(process.cwd(), "coverage");
if (existsSync(report)) cpSync(report, join(out, "report"), { recursive: true });
const failed = vitest.state.getCountOfFailedTests();
writeFileSync(
  join(out, "run.json"),
  JSON.stringify({ mode, vitest: vitest.version, exitCode, failed, error, filters, name, teeLog }, null, 1),
);
console.log(JSON.stringify({ mode, vitest: vitest.version, exitCode, failed, error: error?.split("\n")[0] ?? null }));
process.exit(exitCode);
