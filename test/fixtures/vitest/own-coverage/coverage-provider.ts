import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Acts as `@vitest/coverage-v8` does where it touches the project (row 013-07,
 * `research/coverage-collection.md` Q1): `clean` deletes the reports directory,
 * each run writes a report there and prints a table, and a failed threshold
 * prints an error and sets `process.exitCode`. No coverage package needed.
 */
export default {
  getProvider() {
    let ctx;
    let options;
    let reports;
    return {
      name: "fixture",
      initialize(vitest) {
        ctx = vitest;
        options = vitest.config.coverage;
        reports = resolve(vitest.config.root, options.reportsDirectory);
      },
      resolveOptions: () => options,
      clean() {
        rmSync(reports, { recursive: true, force: true });
      },
      onAfterSuiteRun() {},
      generateCoverage: () => ({ lines: 0 }),
      reportCoverage(coverage) {
        mkdirSync(reports, { recursive: true });
        writeFileSync(join(reports, "coverage-final.json"), JSON.stringify(coverage));
        ctx.logger.log("File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s");
        const lines = options.thresholds?.lines ?? 0;
        if (coverage.lines < lines) {
          ctx.logger.error(`ERROR: Coverage for lines (0%) does not meet global threshold (${lines}%)`);
          process.exitCode = 1;
        }
      },
    };
  },
};
