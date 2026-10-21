import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANCELLED } from "../../src/runners/vitest/run.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 011-51, tests 7 and 9 of `research/running-tier-yields.md` (spec 011
 * C4 step 5 as amended 2026-10-21), on a real Vitest adapter with forked
 * workers. #69: revision 5 changed a file the `b` project's `globalSetup`
 * imports while a tier of other files ran; the runner part recreates the
 * instance, which waits for the run in flight, so the revision was not
 * listed until the tier ended. Project `a` holds the basic fixture's tests
 * and `HELD`, whose worker waits while a marker exists; its last-known
 * duration is reported as `HELD_MS`, so the tier's remainder is long.
 */
const HELD = "test/held.test.ts";
const HELD_MS = 120_000;
const B_TEST = "b/x.test.ts";

const CONFIG = [
  'import { defineConfig } from "vitest/config";',
  "export default defineConfig({",
  "  test: {",
  "    projects: [",
  '      { test: { name: "a", include: ["test/**/*.test.ts"], testTimeout: 120_000 } },',
  '      { test: { name: "b", include: ["b/**/*.test.ts"], globalSetup: ["b/setup.ts"] } },',
  "    ],",
  "  },",
  "});",
  "",
].join("\n");

/** A test whose worker writes its pid to `started` and waits while `hold` exists. */
function heldTest(hold: string, started: string, version: number): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { it } from "vitest";',
    `it("waits while held (version ${version})", async () => {`,
    `  if (!existsSync(${JSON.stringify(hold)})) return;`,
    `  writeFileSync(${JSON.stringify(started)}, String(process.pid));`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    "}, 120_000);",
    "",
  ].join("\n");
}

const markerDirs: string[] = [];
// Before the harness's cleanup closes the adapter: removing the hold releases the worker.
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Whether a process `pid` is alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function openTwoProjects(hold: string, started: string): Promise<Harness> {
  const repo = createRepo("basic");
  const at = (path: string) => join(repo.main, path);
  writeFileSync(at("vitest.config.ts"), CONFIG);
  mkdirSync(at("b"));
  writeFileSync(at("b/dep.ts"), "export const dep = 1;\n");
  writeFileSync(at("b/setup.ts"), 'import { dep } from "./dep";\nexport default () => void dep;\n');
  writeFileSync(at(B_TEST), 'import { it } from "vitest";\nit("runs", () => {});\n');
  writeFileSync(at(HELD), heldTest(hold, started, 1));
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    runnerPartBesideRun: true,
  });
  // The held file's results report `HELD_MS`: its last-known duration, as a long file's would be.
  const run = h.runner.run.bind(h.runner);
  h.runner.run = async (files, options) => {
    const report = await run(files, options);
    const results = report.results.map((r) =>
      r.check.testPath === HELD ? { ...r, durationMs: HELD_MS } : r,
    );
    return { ...report, results };
  };
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(h.runsOf(HELD)).toHaveLength(1);
  return h;
}

describe(
  "a running Vitest tier yields (spec 011 C4 step 5 as amended 2026-10-21, row 011-51)",
  SLOW,
  () => {
    it("7, 9: a globalSetup import's change cuts the tier, the revision is listed, and no worker of the cut run is left", async () => {
      const markers = mkdtempSync(join(tmpdir(), "squeal-011-51-"));
      markerDirs.push(markers);
      const hold = join(markers, "hold");
      const started = join(markers, "started");
      const h = await openTwoProjects(hold, started);

      // An edit's tier of the held file: its worker is inside the test.
      let signal: AbortSignal | undefined;
      h.gate.before = (files, options) => {
        if (files.some((f) => f.path === HELD)) signal = options.signal;
      };
      writeFileSync(hold, "");
      h.write(HELD, heldTest(hold, started, 2));
      await h.batch(HELD);
      await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
      const pid = Number(readFileSync(started, "utf8"));
      expect(alive(pid)).toBe(true);
      const older = h.header().refinedRevision ?? 0;

      // The `b` project's global setup imports it: its runner part will recreate the instance,
      // which waits for the run in flight. The revision itself cuts the tier.
      h.write("b/dep.ts", "export const dep = 2;\n");
      await h.batch("b/dep.ts");
      const newer = older + 1;
      expect(signal?.aborted).toBe(true);
      // A named wait on the `b` file, which the revision re-keyed.
      await h.scheduler.promote([{ project: "b", path: B_TEST }], 60_000);

      // Listed while the hold still stands: the recreate did not wait for the held test.
      await expect.poll(() => h.header().refinedRevision, { timeout: 60_000 }).toBe(newer);
      expect(existsSync(hold)).toBe(true);
      const cut = h.runsOf(HELD)[1];
      expect(cut?.report.failure).toContain(CANCELLED);
      expect(cut?.report.completedFiles).toEqual([]);
      // The sweep: the cut run's worker is gone.
      await expect.poll(() => alive(pid), { timeout: 60_000 }).toBe(false);
      // The promoted file runs first; the held file, cut once at its key, runs again after it.
      await expect.poll(() => h.runsOf(B_TEST).length, { timeout: 60_000 }).toBe(2);
      expect(existsSync(hold)).toBe(true);

      rmSync(hold);
      await h.scheduler.idle();
      // The cut file ran again and stored: three runs, the last to its end.
      expect(h.runsOf(HELD)).toHaveLength(3);
      expect(h.runsOf(HELD)[2]?.report.completedFiles.map((f) => f.path)).toEqual([HELD]);
      expect(h.header()).toMatchObject({
        revision: newer,
        refinedRevision: newer,
        counts: { pending: 0, stale: 0, unknown: 0 },
      });
    });
  },
);
