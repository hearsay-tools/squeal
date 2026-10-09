import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { RunReport } from "../../../src/core/types/index.js";
import { type FixtureProject, openFixture, outcomes, paths, ref, SLOW } from "./helpers.js";

/*
 * Task 001-150 (D5 as amended): the adapter's runner part (`invalidate`
 * without a recreate, `affected`, `closure`, `enumerate`, `testFiles`,
 * `environment`) overlaps its run; a recreate waits for the run, and the
 * run's check of the bytes it read (001-146) still sees what the runner
 * part invalidated meanwhile. A real worker is held inside the test file.
 */

const NEW = 'export const which = "new";\n';
const OLD = 'export const which = "old";\n';
const HELD = ref("test/held.test.ts");

const markerDirs: string[] = [];
// Before the fixture's own `afterEach` closes the adapter (hooks run as a
// stack): removing the hold releases the worker, so a failed test still closes.
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const MATH = ref("test/math.test.ts");

/** Imports `src/mod.ts`, writes `started`, waits while `hold` exists. */
function heldTest(hold: string, started: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { which } from "../src/mod.ts";',
    'it("reads new after the hold", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    '  expect(which).toBe("new");',
    "}, 120_000);",
    "",
  ].join("\n");
}

/** A run of the held file, its worker inside the test. */
async function heldRun(): Promise<{
  fx: FixtureProject;
  run: Promise<RunReport>;
  settled: () => boolean;
  release: () => void;
}> {
  const markers = mkdtempSync(join(tmpdir(), "squeal-001-150-"));
  const hold = join(markers, "hold");
  const started = join(markers, "started");
  writeFileSync(hold, "");
  markerDirs.push(markers);
  const fx = await openFixture("basic", {
    "src/mod.ts": NEW,
    [HELD.path]: heldTest(hold, started),
  });
  let done = false;
  const run = fx.adapter.run([HELD], fx.runOptions());
  void run.finally(() => {
    done = true;
  });
  await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
  return { fx, run, settled: () => done, release: () => rmSync(hold, { force: true }) };
}

describe("vitest adapter: the runner part beside a run (001-150)", SLOW, () => {
  it("answers every runner-part call while a worker is mid-run", async () => {
    const { fx, run, settled, release } = await heldRun();

    const [invalidated, affected, closure, checks, files, environments] = await Promise.all([
      fx.adapter.invalidate([{ path: "src/math.ts", kind: "change" }]),
      fx.adapter.affected(["src/math.ts"]),
      fx.adapter.closure(MATH),
      fx.adapter.enumerate(MATH),
      fx.adapter.testFiles(),
      fx.adapter.environment(),
    ]);
    expect(settled()).toBe(false);
    expect(invalidated).toEqual({ recreatedProjects: [] });
    expect(paths(affected)).toContain(MATH.path);
    expect(paths(affected)).not.toContain(HELD.path);
    expect(closure.paths).toContain("src/math.ts");
    expect(checks.length).toBeGreaterThan(0);
    expect(files).toContainEqual(HELD);
    expect(environments.map((e) => e.project)).toEqual([""]);

    release();
    const report = await run;
    expect(report.completedFiles).toEqual([HELD]);
    expect(outcomes(report)).toEqual(["pass"]);
  });

  it("recreates only after the run in flight, and the next run uses the new instance", async () => {
    const { fx, run, settled, release } = await heldRun();
    const order: string[] = [];
    void run.then(() => order.push("run"));
    const recreate = fx.adapter
      .invalidate([{ path: "vitest.config.ts", kind: "change" }])
      .then((result) => {
        order.push("recreate");
        return result;
      });
    // The recreate is asked during the run; a run asked after it waits for it.
    const next = fx.adapter.run([MATH], fx.runOptions()).then((report) => {
      order.push("next");
      return report;
    });
    await delay(1_000);
    expect(order).toEqual([]);
    expect(settled()).toBe(false);

    release();
    expect(outcomes(await run)).toEqual(["pass"]);
    expect(await recreate).toEqual({ recreatedProjects: [""] });
    expect(outcomes(await next)).toEqual(["pass", "pass"]);
    expect(order).toEqual(["run", "recreate", "next"]);
  });

  it("drops a file whose import moved and was invalidated by the runner part mid-run (001-146)", async () => {
    const { fx, run, release } = await heldRun();
    // The worker has executed `src/mod.ts`; its bytes move, and an invalidate
    // that does not name it finds it stale and drops its transform.
    fx.write("src/mod.ts", OLD);
    await fx.adapter.invalidate([{ path: "src/math.ts", kind: "change" }]);

    release();
    const report = await run;
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.failure).toContain("src/mod.ts changed on disk after this run loaded it");
  });
});
