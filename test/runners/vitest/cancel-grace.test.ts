import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CancelCause } from "../../../src/core/types/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-137 (`tasks/011-137/notes.md`): a step-down's cancel dropped every
 * module that ended in its grace, about 21 of them whole in ten step-downs.
 * Vitest skips each test the cancel reaches, the running one included, so a
 * module that ended passed with no test skipped that was to run ran whole.
 * Under a step-down it counts as completed; under any other cause, a stop
 * included, it stays dropped (the coordinator's decision (a)).
 */

const WHOLE = "test/whole.test.ts";
const CUT = "test/cut.test.ts";

/** Waits for `release`; the cancel arrives while it waits. */
const waitFor = (release: string) => `{
  const deadline = Date.now() + 30_000;
  while (!existsSync(${JSON.stringify(release)}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 10));
  }
}`;

/** Its one test passes; its `afterAll` holds the module open until `release`. */
function wholeFile(markers: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { afterAll, it } from "vitest";',
    'it("passes", () => {});',
    "afterAll(async () => {",
    `  writeFileSync(${JSON.stringify(join(markers, "whole"))}, "");`,
    `  ${waitFor(join(markers, "release"))}`,
    "});",
    "",
  ].join("\n");
}

/** Its first test runs at the cancel, so the cancel skips it and the test after it. */
function cutFile(markers: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { it } from "vitest";',
    'it("runs at the cancel", async () => {',
    `  writeFileSync(${JSON.stringify(join(markers, "cut"))}, "");`,
    `  ${waitFor(join(markers, "release"))}`,
    "}, 60_000);",
    'it("after it", () => {});',
    "",
  ].join("\n");
}

const markerDirs: string[] = [];
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A run of both files cancelled with `cause` while each waits, released 50 ms after the cancel. */
async function cancelledWhileWaiting(cause: CancelCause) {
  const markers = mkdtempSync(join(tmpdir(), "squeal-011-137-"));
  markerDirs.push(markers);
  const fx = await openFixture("basic", { [WHOLE]: wholeFile(markers), [CUT]: cutFile(markers) });
  await fx.adapter.invalidate([
    { path: WHOLE, kind: "add" },
    { path: CUT, kind: "add" },
  ]);
  const controller = new AbortController();
  const ended: string[] = [];
  const options = fx.runOptions({
    signal: controller.signal,
    fileEnded: (testFile) => ended.push(testFile.path),
  });
  const running = fx.adapter.run([ref(CUT), ref(WHOLE)], options);
  const started = () => ["whole", "cut"].every((name) => existsSync(join(markers, name)));
  await expect.poll(started, { timeout: 60_000 }).toBe(true);
  controller.abort(cause);
  // The cancel is asked before either module can end: both end in its grace.
  await new Promise((done) => setTimeout(done, 50));
  writeFileSync(join(markers, "release"), "");
  return { report: await running, ended };
}

describe("vitest adapter: a module that ends whole in a cancel's grace (row 011-137)", SLOW, () => {
  it("counts as completed under a step-down, its results kept; a cut module does not", async () => {
    const { report, ended } = await cancelledWhileWaiting("step-down");

    expect(report.completedFiles).toEqual([ref(WHOLE)]);
    expect(report.results.map((r) => [r.check.testPath, r.check.fullName, r.outcome])).toEqual([
      [WHOLE, "passes", "pass"],
    ]);
    expect(report.fileErrors).toEqual([]);
    // It ended after the cancel: the scheduler hears of no end during the run (row 011-54).
    expect(ended).toEqual([]);
  });

  it("stays dropped under a stop, as before", async () => {
    const { report } = await cancelledWhileWaiting("stop");

    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
  });
});
