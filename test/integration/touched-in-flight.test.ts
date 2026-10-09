import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { BASE, createRepo, slowOptions, stored, withSlowLanes } from "./stamps-repo.js";
import { touchHeard } from "./touched-repo.js";

/*
 * Task 001-159: a touch heard while a run is in flight. The run may have
 * read the file's other bytes from any cache, so none of its files is
 * stored; they are unknown with a reason that names the file, as task
 * 001-146 does for a file that moved during a run. An unknown file has no
 * stored state. The test file rewrites
 * `src/mod.ts` with its own bytes, then waits until the runner heard it.
 */

const HOLDS = [
  'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
  'import { setTimeout as sleep } from "node:timers/promises";',
  'import { expect, it } from "vitest";',
  'import { which } from "../src/mod.ts";',
  "",
  'const at = (path: string) => new URL("../" + path, import.meta.url);',
  'it("passes on the bytes on disk", async () => {',
  '  writeFileSync(at("src/mod.ts"), readFileSync(at("src/mod.ts")));',
  '  writeFileSync(at("flags/touched"), "");',
  '  for (let i = 0; i < 600 && !existsSync(at("flags/heard")); i++) await sleep(50);',
  '  expect(which).toBe("old");',
  "});",
  "",
].join("\n");

const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  "flags/.keep": "\n",
  "test/holds.test.ts": HOLDS,
  "test/other.test.ts": 'import { it } from "vitest";\nit("passes", () => {});\n',
};

/** Starts the scheduler; once the run touched `src/mod.ts`, hands over the batch and lets the run end. */
async function touchDuringRun(h: Harness): Promise<void> {
  const heard = touchHeard(h);
  await h.scheduler.start();
  const touched = join(h.root, "flags/touched");
  for (let i = 0; i < 1200 && !existsSync(touched); i++) await sleep(25);
  expect(existsSync(touched)).toBe(true);
  await h.batch("src/mod.ts");
  await heard;
  writeFileSync(join(h.root, "flags/heard"), "");
  await h.scheduler.idle();
}

const REASON = /src\/mod\.ts was written during this run and ended as it was.*task 001-159/;

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

describe("a touch heard during a run (task 001-159)", () => {
  it("stores none of the run's files", SLOW, async () => {
    const repo = createRepo(FILES);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 4,
      runnerPartBesideRun: true,
    });
    await touchDuringRun(h);

    expect(stored(h)).toEqual([]);
    expect(reasons(h, "test/holds.test.ts")).toEqual([expect.stringMatching(REASON)]);
    expect(reasons(h, "test/other.test.ts")).toEqual([expect.stringMatching(REASON)]);
  });

  // Spec 004 D2: the slow instance hears it at once, not before its next run.
  it("stores none of a slow run's files", SLOW, async () => {
    const repo = createRepo(FILES);
    const { slotDir, ...options } = slowOptions(["test/holds.test.ts", "test/other.test.ts"]);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      ...options,
      runnerPartBesideRun: true,
    });
    const lanes = withSlowLanes(h, repo.main, slotDir, async () => {});
    await touchDuringRun(h);

    // One slow file per run: the other ran after the touch, on an instance made after it.
    expect(lanes.made()).toBe(1);
    expect(stored(h)).toEqual([["", "test/other.test.ts", "current", "pass"]]);
    expect(reasons(h, "test/holds.test.ts")).toEqual([expect.stringMatching(REASON)]);
  });
});
