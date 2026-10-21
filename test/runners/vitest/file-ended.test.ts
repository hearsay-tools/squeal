import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-54: the adapter names each test file as its module ends
 * (`RunOptions.fileEnded`, from `onTestModuleEnd`), while the run goes on,
 * so the scheduler's supersession cancel takes only the unfinished files. A
 * module that ends after a cancel is not named, as it is not completed.
 */

const HELD = "test/held.test.ts";
const QUICK = "test/strings.test.ts";

/** A test whose worker writes `started` and waits while `hold` exists. */
function heldTest(hold: string, started: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { it } from "vitest";',
    'it("waits while held", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    "}, 120_000);",
    "",
  ].join("\n");
}

const markerDirs: string[] = [];
// Before the fixture's cleanup closes the adapter: removing the hold releases the worker.
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function heldFixture() {
  const markers = mkdtempSync(join(tmpdir(), "squeal-011-54-"));
  markerDirs.push(markers);
  const hold = join(markers, "hold");
  const started = join(markers, "started");
  const fx = await openFixture("basic", { [HELD]: heldTest(hold, started) });
  await fx.adapter.invalidate([{ path: HELD, kind: "add" }]);
  writeFileSync(hold, "");
  const ended: string[] = [];
  const fileEnded = (testFile: TestFileRef) => ended.push(testFile.path);
  return { fx, hold, started, ended, fileEnded };
}

describe("vitest adapter: each file's end during the run (row 011-54)", SLOW, () => {
  it("names a file as its module ends, before the run's report", async () => {
    const { fx, hold, started, ended, fileEnded } = await heldFixture();

    const running = fx.adapter.run([ref(QUICK), ref(HELD)], fx.runOptions({ fileEnded }));
    await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => ended, { timeout: 60_000 }).toEqual([QUICK]);

    rmSync(hold);
    const report = await running;
    expect(ended).toEqual([QUICK, HELD]);
    expect(report.completedFiles).toEqual([ref(HELD), ref(QUICK)]);
  });

  /*
   * Vitest catches a reporter hook that throws as an unhandled reporter
   * error, which would end the run crashed and store nothing (D12).
   */
  it("ends no run and loses no result when the callback throws", async () => {
    const fx = await openFixture();
    const options = fx.runOptions({
      fileEnded: () => {
        throw new Error("boom 011-54");
      },
    });

    const report = await fx.adapter.run([ref(QUICK)], options);

    expect(report.end).toBe("completed");
    expect(report.failure).toBeNull();
    expect(report.completedFiles).toEqual([ref(QUICK)]);
    expect(report.results.length).toBeGreaterThan(0);
    const log = readFileSync(join(options.logDir, "vitest.log"), "utf8");
    expect(log).toContain(`squeal: fileEnded of ${QUICK} threw: Error: boom 011-54`);
  });

  it("does not name a file whose module ends after a cancel", async () => {
    const { fx, started, ended, fileEnded } = await heldFixture();
    const controller = new AbortController();

    const running = fx.adapter.run(
      [ref(QUICK), ref(HELD)],
      fx.runOptions({ fileEnded, signal: controller.signal }),
    );
    await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => ended, { timeout: 60_000 }).toEqual([QUICK]);

    controller.abort();
    const report = await running;
    expect(ended).toEqual([QUICK]);
    expect(report.completedFiles).toEqual([ref(QUICK)]);
  });
});
