import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { durationOf } from "../../src/core/scheduler/files.js";
import { readWhy } from "../../src/core/status/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 013-03 (gh-62): one cezar file's file-level check read 3.5 s where its
 * run log showed 112 s, since the check held only the time outside its
 * tests. Here a `beforeAll` and two tests each sleep: the file-level check
 * holds all of it, no more than the run took, and `why`'s durations read
 * that value; the file's duration counts it once.
 */

const FILE = "test/setup-heavy.test.ts";
const SLEEP_MS = 500;

it("records a file's whole time on its file-level check (013-03)", SLOW, async () => {
  const repo = createRepo();
  writeFileSync(
    join(repo.main, FILE),
    [
      'import { setTimeout as delay } from "node:timers/promises";',
      'import { beforeAll, it } from "vitest";',
      `beforeAll(() => delay(${SLEEP_MS}));`,
      `it("first", () => delay(${SLEEP_MS}));`,
      `it("second", () => delay(${SLEEP_MS}));`,
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "setup-heavy"]);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
  await h.scheduler.start();
  await h.scheduler.idle();

  const [run] = h.runsOf(FILE);
  const why = readWhy(h.root, `${FILE} (file-level)`);
  if (!("found" in why) || !why.found)
    throw new Error(`no file-level check: ${JSON.stringify(why)}`);
  const recorded = why.results[0]?.result.durationMs ?? 0;
  // Timers may fire a millisecond early; the three sleeps run one after another.
  expect(recorded).toBeGreaterThanOrEqual(3 * SLEEP_MS - 10);
  expect(recorded).toBeLessThanOrEqual(run?.report.durationMs ?? 0);
  expect(why.durations).toMatchObject({
    results: 1,
    minMs: recorded,
    medianMs: recorded,
    p95Ms: recorded,
    maxMs: recorded,
  });
  const key = h.keyOf(FILE);
  if (key === null) throw new Error(`${FILE} has no key`);
  expect(durationOf(store.results.byKey(key, 0))).toBe(recorded);
});
