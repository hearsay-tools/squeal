// Throwaway probe (015-01): a coverage provider of Squeal's own, loaded through
// Vitest's `coverage.provider: "custom"`, so the project needs no
// `@vitest/coverage-*` package. The worker side is what `@vitest/coverage-v8`
// 5.0.3 does (`startCoverage`, `takeCoverage`, `stopCoverage` over
// `node:inspector` precise coverage); the main side keeps each batch's file and
// writes no report.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import inspector from "node:inspector/promises";
import { join } from "node:path";

// The module runner may evaluate this module more than once per worker (seen:
// `takeCoverage` found no session), so the session lives on the process.
const SLOT = Symbol.for("squeal.probe.coverageSession");
const slot = () => globalThis[SLOT];

export default {
  async startCoverage({ isolate }) {
    if (isolate === false && slot()) return;
    globalThis[SLOT] ??= new inspector.Session();
    const session = slot();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  },
  async takeCoverage(options) {
    const { result } = await slot().post("Profiler.takePreciseCoverage");
    const kept = result.filter((s) => s.url.startsWith("file://") && !s.url.includes("/node_modules/"));
    const file = join(options.coverageFilesDirectory, `coverage-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({ result: kept }));
    return file;
  },
  async stopCoverage({ isolate }) {
    if (isolate === false) return;
    const session = slot();
    await session.post("Profiler.stopPreciseCoverage");
    await session.post("Profiler.disable");
    session.disconnect();
    globalThis[SLOT] = undefined;
  },
  getProvider() {
    return {
      name: "squeal-probe",
      batches: [],
      initialize(ctx) {
        this.options = { ...ctx.config.coverage, coverageFilesDirectory: undefined };
        this.dir = join(ctx.config.coverage.reportsDirectory, ".tmp");
        mkdirSync(this.dir, { recursive: true });
        this.options.coverageFilesDirectory = this.dir;
      },
      resolveOptions() {
        return this.options;
      },
      clean() {
        mkdirSync(this.dir, { recursive: true });
      },
      onAfterSuiteRun(meta) {
        this.batches.push(meta);
      },
      generateCoverage() {
        return null;
      },
      reportCoverage() {},
    };
  },
};
