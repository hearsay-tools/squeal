import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach } from "vitest";
import { type CoverageRun, coverageProvider } from "../../../src/core/code/coverage/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";

/*
 * Spec 015 D8 (row 015-11): an adapter that collects coverage through
 * Squeal's own provider, wrapped so a test sees every payload a worker
 * wrote, kept or deleted since.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface Covering {
  readonly runs: CoverageRun[];
  readonly notes: string[];
  readonly tempDir: string;
  /** Every payload the provider's workers wrote, in the order they wrote them. */
  readonly payloads: () => string[];
  readonly create: (root: string) => ReturnType<typeof createVitestAdapter>;
}

/**
 * Squeal's provider with a `takeCoverage` that logs each payload's path to
 * `log`; Vitest loads it by path in each worker as it loads the provider.
 */
function loggingProvider(dir: string, log: string): string {
  const provider = coverageProvider();
  if (provider === null) throw new Error("no coverage provider beside the sources");
  const file = join(dir, "logging-provider.mjs");
  writeFileSync(
    file,
    [
      'import { appendFileSync } from "node:fs";',
      `import provider from ${JSON.stringify(pathToFileURL(provider).href)};`,
      "export default {",
      "  ...provider,",
      "  async takeCoverage(options) {",
      "    const payload = await provider.takeCoverage(options);",
      `    if (payload !== undefined) appendFileSync(${JSON.stringify(log)}, payload + "\\n");`,
      "    return payload;",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  return file;
}

export function covering(
  options: { on?: () => boolean; collected?: (run: CoverageRun) => void } = {},
): Covering {
  const tempDir = mkdtempSync(join(tmpdir(), "sq-own-provider-"));
  const logDir = mkdtempSync(join(tmpdir(), "sq-own-provider-log-"));
  temps.push(tempDir, logDir);
  const log = join(logDir, "payloads.log");
  const provider = loggingProvider(logDir, log);
  const runs: CoverageRun[] = [];
  const notes: string[] = [];
  const collected = (run: CoverageRun) => {
    runs.push(run);
    options.collected?.(run);
  };
  return {
    runs,
    notes,
    tempDir,
    payloads: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []),
    create: (root) =>
      createVitestAdapter({
        root,
        note: (text) => notes.push(text),
        coverage: { enabled: options.on ?? (() => true), provider, tempDir, collected },
      }),
  };
}
