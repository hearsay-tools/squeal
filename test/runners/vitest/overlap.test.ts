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

  /*
   * Task 001-264 (research 001-182 Finding 1): the run reads reverted bytes by
   * an import Vite cannot see, and a runner-part `invalidate` naming the file
   * lands while those bytes are still on disk, so it logs nothing and drops
   * the transform; the file is restored before the run ends.
   */
  it("drops a file whose run read bytes a mid-run invalidate dropped before they moved", async () => {
    const markers = mkdtempSync(join(tmpdir(), "squeal-001-264-"));
    markerDirs.push(markers);
    const loaded = join(markers, "loaded");
    const go = join(markers, "go");
    const fx = await openFixture("basic", {
      "src/mod.ts": NEW,
      [HELD.path]: [
        'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
        'import { setTimeout as delay } from "node:timers/promises";',
        'import { expect, it } from "vitest";',
        'it("loads the module while it is reverted", async () => {',
        '  const file = new URL("../src/mod.ts", import.meta.url);',
        '  const restored = readFileSync(file, "utf8");',
        `  writeFileSync(file, ${JSON.stringify(OLD)});`,
        '  const target = "../src/mod" + ".ts";',
        "  const { which } = await import(/* @vite-ignore */ target);",
        `  writeFileSync(${JSON.stringify(loaded)}, "");`,
        `  while (!existsSync(${JSON.stringify(go)})) await delay(20);`,
        "  writeFileSync(file, restored);",
        '  expect(which).toBe("new");',
        "}, 120_000);",
        "",
      ].join("\n"),
    });
    const run = fx.adapter.run([HELD], fx.runOptions());
    await expect.poll(() => existsSync(loaded), { timeout: 60_000 }).toBe(true);
    // A revision named src/mod.ts while it held the reverted bytes; its runner part lands now.
    await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);
    writeFileSync(go, "");

    const report = await run;
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.failure).toContain("src/mod.ts changed on disk after this run loaded it");
  });

  it("completes a run whose import a mid-run invalidate dropped with the bytes it read (001-264)", async () => {
    const { fx, run, release } = await heldRun();
    // Rewritten to the bytes the worker executed: the stat moves, the hash does not.
    fx.write("src/mod.ts", NEW);
    await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);

    release();
    const report = await run;
    expect(report.completedFiles).toEqual([HELD]);
    expect(outcomes(report)).toEqual(["pass"]);
  });

  /*
   * Task 001-343 (research `revert-restore-pass-2.md`): the invalidate lands
   * after Vite read the reverted bytes and before their transform is cached.
   * Vite returns that transform to the run but does not cache it, so `hold`
   * finds nothing cached to keep and the run's own check nothing to compare.
   */
  async function inFlightRun(revert: boolean): Promise<RunReport> {
    const markers = mkdtempSync(join(tmpdir(), "squeal-001-343-"));
    markerDirs.push(markers);
    const transforming = join(markers, "transforming");
    const go = join(markers, "go");
    const fx = await openFixture("basic", {
      // Holds the module's transform after Vite loaded it, until `go` exists.
      "vitest.config.ts": [
        'import { existsSync, writeFileSync } from "node:fs";',
        'import { setTimeout as delay } from "node:timers/promises";',
        'import { defineConfig } from "vitest/config";',
        'import { include } from "./vitest.shared.ts";',
        "export default defineConfig({",
        "  plugins: [{",
        '    name: "hold-transform",',
        "    async transform(_code, id) {",
        '      if (!id.endsWith("/src/mod.ts")) return null;',
        `      writeFileSync(${JSON.stringify(transforming)}, "");`,
        `      while (!existsSync(${JSON.stringify(go)})) await delay(20);`,
        "      return null;",
        "    },",
        "  }],",
        '  test: { include, setupFiles: ["test/setup.ts"], globalSetup: ["test/global-setup.ts"] },',
        "});",
        "",
      ].join("\n"),
      "src/mod.ts": NEW,
      [HELD.path]: [
        'import { readFileSync, writeFileSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        'it("loads the module", async () => {',
        '  const file = new URL("../src/mod.ts", import.meta.url);',
        '  const restored = readFileSync(file, "utf8");',
        ...(revert ? [`  writeFileSync(file, ${JSON.stringify(OLD)});`] : []),
        '  const target = "../src/mod" + ".ts";',
        "  const { which } = await import(/* @vite-ignore */ target);",
        "  writeFileSync(file, restored);",
        '  expect(which).toBe("new");',
        "}, 120_000);",
        "",
      ].join("\n"),
    });
    const run = fx.adapter.run([HELD], fx.runOptions());
    await expect.poll(() => existsSync(transforming), { timeout: 60_000 }).toBe(true);
    // A revision named src/mod.ts while its transform was in flight; its runner part lands now.
    await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);
    writeFileSync(go, "");
    return run;
  }

  it("drops a file whose run read bytes a mid-run invalidate dropped while their transform was in flight (001-343)", async () => {
    const report = await inFlightRun(true);
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.failure).toContain("src/mod.ts changed on disk after this run loaded it");
  });

  it("completes a run whose in-flight transform a mid-run invalidate dropped with the bytes on disk (001-343)", async () => {
    const report = await inFlightRun(false);
    expect(report.completedFiles).toEqual([HELD]);
    expect(outcomes(report)).toEqual(["pass"]);
  });
});
