import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { cancelled } from "../../src/runners/vitest/run.js";
import { git } from "../hash/git-repo.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { CUT_WITHIN_MS, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-54 on a real Vitest adapter (spec 011 C4 step 5; review
 * `reviews/0.1.237.md` B2). `HELD` imports `src/math.ts` like
 * `test/math.test.ts`, so one edit of it re-keys both into one edit's tier.
 * Math's module ends at once; HELD's worker waits while a marker exists. A
 * save of HELD alone then re-keys every file of the tier that has not
 * ended, which cancels it at once; math's result lands only with the run's
 * report, and HELD runs again at its new key.
 */
const HELD = "test/held.test.ts";
const MATH = "test/math.test.ts";

function heldTest(hold: string, started: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { add } from "../src/math.ts";',
    'it("waits while held", async () => {',
    '  expect(typeof add).toBe("function");',
    `  if (!existsSync(${JSON.stringify(hold)})) return;`,
    `  writeFileSync(${JSON.stringify(started)}, "");`,
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

it(
  "cancels a tier once every file left in it is re-keyed; the ended file keeps its result (011-54)",
  SLOW,
  async () => {
    const markers = mkdtempSync(join(tmpdir(), "squeal-011-54-"));
    markerDirs.push(markers);
    const hold = join(markers, "hold");
    const started = join(markers, "started");
    const repo = createRepo();
    writeFileSync(join(repo.main, HELD), heldTest(hold, started));
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "held"]);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      runnerPartBesideRun: true,
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    let signal: AbortSignal | undefined;
    h.gate.before = (files, options) => {
      if (files.some((f) => f.path === HELD)) signal = options.signal;
    };
    writeFileSync(hold, "");
    const math = readFileSync(join(h.root, "src/math.ts"), "utf8");
    h.write("src/math.ts", `${math}\nexport const edited = 1;\n`);
    await h.batch("src/math.ts");
    await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
    const mathKey = h.keyOf(MATH);
    if (mathKey === null) throw new Error(`${MATH} has no key`);
    // Math has ended, and nothing is stored before the run's report.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(signal?.aborted).toBe(false);
    expect(store.results.byKey(mathKey, 0)).toEqual([]);

    // A save of HELD alone: every file of the tier that has not ended is re-keyed.
    h.write(HELD, 'import { it } from "vitest";\nit("runs", () => {});\n');
    await h.batch(HELD);
    await expect.poll(() => signal?.aborted, { timeout: CUT_WITHIN_MS }).toBe(true);
    await h.scheduler.idle();

    const [cut, rerun] = h.runsOf(HELD).slice(-2);
    expect(cut?.report.failure).toContain(cancelled("supersession"));
    expect(cut?.report.completedFiles.map((f) => f.path)).toEqual([MATH]);
    expect(rerun?.report.completedFiles.map((f) => f.path)).toEqual([HELD]);
    expect(h.runsOf(MATH).slice(-1)[0]).toBe(cut);
    expect(store.results.byKey(mathKey, 0).length).toBeGreaterThan(0);
    expect(existsSync(hold)).toBe(true);
    expect(h.header()).toMatchObject({ counts: { pending: 0, stale: 0, unknown: 0 } });
  },
);
