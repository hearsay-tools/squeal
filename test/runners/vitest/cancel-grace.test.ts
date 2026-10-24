import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CancelCause } from "../../../src/core/types/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-137 (`tasks/011-137/notes.md`): a step-down's cancel dropped every
 * module that ended in its grace, about 21 of them whole in ten step-downs.
 * Under a step-down, a module that ended passed counts as completed when each
 * test it was to run reported a pass or a fail before the cancel was asked:
 * only its hooks ran in the grace. Under any other cause, a stop included, it
 * stays dropped (the coordinator's decision (a)). A test the cancel reached
 * can end `passed` all the same (review 0.1.287 B1), so a final state proves
 * nothing.
 */

const WHOLE = "test/whole.test.ts";
const CUT = "test/cut.test.ts";
const FAILS = "test/cut-fails.test.ts";
const HOOK_FAILS = "test/hook-fails.test.ts";

/** Waits for `release`; the cancel arrives while it waits. */
const waitFor = (release: string) => `{
  const deadline = Date.now() + 30_000;
  while (!existsSync(${JSON.stringify(release)}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 10));
  }
}`;

/** The marker a fixture file writes once the cancel may come, and that path as a source literal. */
const markerOf = (markers: string, path: string) => join(markers, basename(path));
const marker = (markers: string, path: string) => JSON.stringify(markerOf(markers, path));
const release = (markers: string) => join(markers, "release");
const FS = 'import { existsSync, writeFileSync } from "node:fs";';

/**
 * Its one test passes, its skip is declared; its `afterAll` holds the module
 * open until `release`. It says so 500 ms after the test ended, so the test's
 * result reaches the reporter before the cancel: a worker sends results at
 * most every 100 ms.
 */
function wholeFile(markers: string): string {
  return [
    FS,
    'import { afterAll, it } from "vitest";',
    'it("passes", () => {});',
    'it.skip("is declared skipped", () => {});',
    "afterAll(async () => {",
    "  await new Promise((done) => setTimeout(done, 500));",
    `  writeFileSync(${marker(markers, WHOLE)}, "");`,
    `  ${waitFor(release(markers))}`,
    "});",
    "",
  ].join("\n");
}

/** Its first test runs at the cancel, so the cancel skips it and the test after it. */
function cutFile(markers: string): string {
  return [
    FS,
    'import { it } from "vitest";',
    'it("runs at the cancel", async () => {',
    `  writeFileSync(${marker(markers, CUT)}, "");`,
    `  ${waitFor(release(markers))}`,
    "}, 60_000);",
    'it("after it", () => {});',
    "",
  ].join("\n");
}

/**
 * Review 0.1.287 B1, its reproduction: an expected failure that runs at the
 * cancel. The cancel interrupts it and its cleanup throws on the abort, so
 * `it.fails` turns the error into a pass.
 */
function failsFile(markers: string): string {
  return [
    FS,
    'import { afterEach, it } from "vitest";',
    'it.fails("should fail naturally", async () => {',
    `  writeFileSync(${marker(markers, FAILS)}, "");`,
    `  ${waitFor(release(markers))}`,
    "});",
    "afterEach((ctx) => {",
    '  if (ctx.signal.aborted) throw new Error("cleanup aborted");',
    "});",
    "",
  ].join("\n");
}

/** The same, cut in its cleanup: the body passed, so the cancel leaves no abort note. */
function hookFailsFile(markers: string): string {
  return [
    FS,
    'import { afterEach, it } from "vitest";',
    'it.fails("passes, then its cleanup is cut", () => {});',
    "afterEach(async (ctx) => {",
    `  writeFileSync(${marker(markers, HOOK_FAILS)}, "");`,
    `  ${waitFor(release(markers))}`,
    '  if (ctx.signal.aborted) throw new Error("cleanup aborted");',
    "});",
    "",
  ].join("\n");
}

type Sources = (markers: string) => Record<string, string>;
const GRACE: Sources = (m) => ({ [WHOLE]: wholeFile(m), [CUT]: cutFile(m) });
const EXPECTED_FAILURES: Sources = (m) => ({
  [FAILS]: failsFile(m),
  [HOOK_FAILS]: hookFailsFile(m),
});

const markerDirs: string[] = [];
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A run of the files of `sources`; with `cause`, cancelled once each waits and released 50 ms later. */
async function runOf(sources: Sources, cause?: CancelCause) {
  const markers = mkdtempSync(join(tmpdir(), "squeal-011-137-"));
  markerDirs.push(markers);
  const files = sources(markers);
  const paths = Object.keys(files);
  const fx = await openFixture("basic", files);
  await fx.adapter.invalidate(paths.map((path) => ({ path, kind: "add" as const })));
  if (cause === undefined) writeFileSync(release(markers), "");
  const controller = new AbortController();
  const ended: string[] = [];
  const options = fx.runOptions({
    signal: controller.signal,
    fileEnded: (testFile) => ended.push(testFile.path),
  });
  const running = fx.adapter.run(
    paths.map((path) => ref(path)),
    options,
  );
  if (cause !== undefined) {
    const started = () => paths.every((path) => existsSync(markerOf(markers, path)));
    await expect.poll(started, { timeout: 60_000 }).toBe(true);
    controller.abort(cause);
    // The cancel is asked before any module can end: each ends in its grace.
    await new Promise((done) => setTimeout(done, 50));
    writeFileSync(release(markers), "");
  }
  return { report: await running, ended };
}

const outcomes = (report: Awaited<ReturnType<typeof runOf>>["report"]) =>
  report.results.map((r) => [r.check.testPath, r.check.fullName, r.outcome]).sort();

describe("vitest adapter: a module that ends whole in a cancel's grace (row 011-137)", SLOW, () => {
  it("counts as completed under a step-down, its results kept; a cut module does not", async () => {
    const { report, ended } = await runOf(GRACE, "step-down");

    expect(report.completedFiles).toEqual([ref(WHOLE)]);
    // A declared skip is no test the cancel cut.
    expect(outcomes(report)).toEqual([
      [WHOLE, "is declared skipped", "skip"],
      [WHOLE, "passes", "pass"],
    ]);
    expect(report.fileErrors).toEqual([]);
    // It ended after the cancel: the scheduler hears of no end during the run (row 011-54).
    expect(ended).toEqual([]);
  });

  it("stays dropped under a stop, as before", async () => {
    const { report } = await runOf(GRACE, "stop");

    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
  });

  it("an expected failure the cancel reached is not completed, though it ends passed (review 0.1.287 B1)", async () => {
    // Run whole, each file fails: its test passed, which `it.fails` does not expect.
    const ordinary = await runOf(EXPECTED_FAILURES);
    expect(ordinary.report.completedFiles).toEqual([ref(FAILS), ref(HOOK_FAILS)]);
    expect(outcomes(ordinary.report)).toEqual([
      [FAILS, "should fail naturally", "fail"],
      [HOOK_FAILS, "passes, then its cleanup is cut", "fail"],
    ]);

    const { report, ended } = await runOf(EXPECTED_FAILURES, "step-down");
    // Neither completes, so no pass is stored and the scheduler queues both for the successor.
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(ended).toEqual([]);
    expect(report.failure).toMatch(/^run cancelled: the daemon stepped down/);
  });
});
