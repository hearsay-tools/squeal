import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { coverageProvider, type V8Script } from "../../../src/core/code/coverage/index.js";

/*
 * Row 013-09: Vitest 4.1.10's worker calls `startCoverage({ isolate })` and
 * `takeCoverage({ moduleExecutionInfo })`, with no `reportsDirectory` and no
 * `coverageFilesDirectory`; its worker config holds `coverage.reportsDirectory`.
 * Vitest 5 passes both. The provider runs here in a child process, called
 * as each Vitest calls it, so its inspector session is not this worker's.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const WORKER_FILE = "/w/test/a.test.ts";

/** A child that loads the provider, runs `covered.mjs` under it and prints the payload's path. */
const CHILD = `
import { pathToFileURL } from "node:url";
const [provider, reports, shape, isolate] = process.argv.slice(2);
globalThis.__vitest_worker__ = {
  config: { coverage: { reportsDirectory: reports } },
  ctx: { files: [{ filepath: ${JSON.stringify(WORKER_FILE)} }] },
};
const { default: coverage } = await import(pathToFileURL(provider).href);
const start = { isolate: isolate === "true" };
const take = { moduleExecutionInfo: new Map() };
if (shape === "5") {
  start.reportsDirectory = reports;
  take.coverageFilesDirectory = reports + "/.tmp";
}
await coverage.startCoverage(start);
const { covered } = await import(pathToFileURL(process.env.COVERED).href);
covered();
const payload = await coverage.takeCoverage(take);
await coverage.stopCoverage(start);
process.stdout.write(JSON.stringify(payload ?? null));
`;

function takeAs(shape: "4" | "5", options: { isolate?: boolean; skip?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sq-provider-worker-"));
  temps.push(dir);
  const reports = join(dir, "reports");
  const covered = join(dir, "covered.mjs");
  writeFileSync(covered, "export function covered() {\n  return 1;\n}\n");
  writeFileSync(join(dir, "child.mjs"), CHILD);
  mkdirSync(reports);
  if (options.skip === true)
    writeFileSync(join(reports, "skip.json"), JSON.stringify([WORKER_FILE]));
  const provider = coverageProvider();
  if (provider === null) throw new Error("no coverage provider beside the sources");
  const out = execFileSync(
    process.execPath,
    [join(dir, "child.mjs"), provider, reports, shape, String(options.isolate ?? true)],
    { env: { ...process.env, COVERED: covered }, encoding: "utf8" },
  );
  return { payload: JSON.parse(out) as string | null, reports, covered };
}

describe("Squeal's provider, called as each Vitest's worker calls it", () => {
  it.each(["4", "5"] as const)(
    "Vitest %s: writes a payload under <reports>/.tmp that holds the code it ran",
    (shape) => {
      const { payload, reports, covered } = takeAs(shape);

      expect(payload?.startsWith(join(reports, ".tmp", "coverage-"))).toBe(true);
      if (payload === null || !existsSync(payload)) throw new Error("no payload");
      const { result } = JSON.parse(readFileSync(payload, "utf8")) as { result: V8Script[] };
      const script = result.find((s) => s.url === pathToFileURL(covered).href);
      expect(
        script?.functions.some((f) => f.functionName === "covered" && f.ranges[0]?.count === 1),
      ).toBe(true);
    },
  );

  it.each(["4", "5"] as const)(
    "Vitest %s: takes none for a file the daemon listed, nor with isolate off",
    (shape) => {
      expect(takeAs(shape, { skip: true }).payload).toBeNull();
      expect(takeAs(shape, { isolate: false }).payload).toBeNull();
    },
  );
});
