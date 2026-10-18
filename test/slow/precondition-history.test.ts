import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skippedLaneVerdict } from "../../src/cli/run-skipped.js";
import { slowWaitCode } from "../../src/cli/status-wait.js";
import type { EndedWait } from "../../src/cli/status-wait-lines.js";
import { readHeader } from "../../src/core/delivery/index.js";
import { readSlowSkips, skippedReason, slowSkipsMetaKey } from "../../src/core/state/index.js";
import { readTransaction } from "../../src/core/store/index.js";
import type { StatusHeader, Store } from "../../src/core/types/index.js";
import type { Harness } from "../scheduler/helpers.js";
import { openRepoStore, SLOW } from "../scheduler/helpers.js";
import { waitFor } from "../watcher/helpers.js";
import {
  line,
  open,
  reopen,
  SLOW_FILES,
  skipReason,
  slowRuns,
  UPPER,
} from "./precondition-helpers.js";

/*
 * Review wave-8.1 B1 (spec 004 D8 as amended 2026-10-17): a forced checkpoint
 * whose precondition is unmet skips slow files whose keys already have
 * stored results. Each is not run at this revision with the skip's reason,
 * never current, on every surface that reads the slow tier; the result
 * stays as history and becomes current again only through a run at a later
 * checkpoint whose precondition is met.
 */

const READY = "ready matches no file (slow.precondition.exists)";
const FAILING_UPPER = [
  'import { expect, it } from "vitest";',
  'it("fails", () => expect(1).toBe(2));',
  "",
].join("\n");

/** Ready, run to idle (both slow files have results), then a revision removing `ready` and editing a fast source. */
async function ranThenUnready(upper?: string) {
  const h = await open(
    { exists: ["ready"] },
    {
      setup: (h) => {
        h.write("ready", "");
        if (upper !== undefined) h.write(UPPER, upper);
      },
    },
  );
  expect(slowRuns(h)).toHaveLength(2);
  rmSync(join(h.root, "ready"));
  h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
  await h.batch("src/math.ts", "ready");
  await h.scheduler.idle();
  return h;
}

async function forcedSkip(h: Harness) {
  const checkpoint = await h.scheduler.requestFullSuite({ force: true });
  await h.scheduler.idle();
  const record = h.store.checkpoints.get(checkpoint.id);
  expect(record?.end).toBe("abandoned");
  return record;
}

function expectSkippedEverywhere(h: Harness) {
  const tier = h.header().slowTier;
  expect(tier).toMatchObject({ current: 0, pending: 0, notRun: 2, skipped: READY });
  expect(skippedReason(tier)).toBe(READY);
  expect(line(h)).toContain(`2 not run at revision ${h.header().revision}, skipped: ${READY}`);
  const wait = { outcome: "quiet", result: { slowTier: tier } } as unknown as EndedWait;
  expect(slowWaitCode(wait)).toBe(3);
}

describe("a forced skip over stored results (review wave-8.1 B1)", SLOW, () => {
  it("counts the passing files as not run, and runs them at the next met checkpoint", async () => {
    const h = await ranThenUnready();
    expect(h.header().slowTier).toMatchObject({ current: 2 });
    const record = await forcedSkip(h);
    expect(slowRuns(h)).toHaveLength(2);
    expect(skipReason(h)).toBe(READY);
    expectSkippedEverywhere(h);
    expect(record && skippedLaneVerdict(h.store, record)?.[1]).toBe(3);

    // Met with no revision, as a build output the watcher ignores: a plain run --all checks again.
    h.write("ready", "");
    const next = await h.scheduler.requestFullSuite();
    await waitFor(() => slowRuns(h).length === 4, 60_000);
    await h.scheduler.idle();
    expect(h.store.checkpoints.get(next.id)?.end).toBe("completed");
    expect(h.header().slowTier).toMatchObject({ current: 2, notRun: 0 });
    expect(skipReason(h)).toBeNull();
    expect(line(h)).not.toContain("skipped");
  });

  it("counts a failing file as not run, never a current failure of the slow tier", async () => {
    const h = await ranThenUnready(FAILING_UPPER);
    expect(h.header().slowTier).toMatchObject({ current: 2 });
    await forcedSkip(h);
    expectSkippedEverywhere(h);

    // A revision that creates the path the glob selects checks again and runs both.
    h.write("ready", "");
    await h.batch("ready");
    await waitFor(() => slowRuns(h).length === 4, 60_000);
    await h.scheduler.idle();
    expect(h.header().slowTier).toMatchObject({ current: 2, notRun: 0 });
    expect(skipReason(h)).toBeNull();
  });

  it("checks a forced skip again at run --slow, running the files with results", async () => {
    const h = await ranThenUnready();
    await forcedSkip(h);
    expect(skipReason(h)).toBe(READY);
    h.write("ready", "");
    expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: SLOW_FILES.length });
    await waitFor(() => slowRuns(h).length === 4, 60_000);
    await h.scheduler.idle();
    expect(h.header().slowTier).toMatchObject({ current: 2, notRun: 0 });
  });
});

/** The known states of the slow files' checks, file and test. */
const slowStates = (h: Harness) =>
  h.store.knownStates.list(h.worktreeId).filter((s) => SLOW_FILES.includes(s.check.testPath));

/** Of the fixture's five test files, the three fast ones' file checks alone read current. */
function expectSkippedNotCurrent(h: Harness) {
  expect(h.header().fileLevelCounts?.current).toBe(3);
  const states = slowStates(h);
  expect(states.length).toBeGreaterThan(0);
  for (const state of states) expect(state.validity).toBe("stale");
}

describe(
  "a skipped file's stored checks in the main header and checkpoints (review wave-8.1 B1 re-review)",
  SLOW,
  () => {
    it("counts no check of a skipped file current, a prior failure kept as stale history", async () => {
      const h = await ranThenUnready(FAILING_UPPER);
      expect(h.header().fileLevelCounts?.current).toBe(5);
      await forcedSkip(h);
      expectSkippedNotCurrent(h);
      const failing = slowStates(h).filter((s) => s.outcome === "fail");
      expect(failing.map((s) => s.check.testPath)).toContain(UPPER);
    });

    it("completes no checkpoint over a persisted skip after a restart, then a met one restores current", async () => {
      const first = await ranThenUnready();
      await forcedSkip(first);
      const h = await reopen(first, { exists: ["ready"] });
      expect(h.header().fullSuite.atCurrentRevision).toBe(false);
      expect(h.header().slowTier).toMatchObject({ current: 0, notRun: 2, skipped: READY });
      expectSkippedNotCurrent(h);
      expect(slowRuns(h)).toHaveLength(0);

      h.write("ready", "");
      const next = await h.scheduler.requestFullSuite();
      await waitFor(() => slowRuns(h).length === 2, 60_000);
      await h.scheduler.idle();
      expect(h.store.checkpoints.get(next.id)?.end).toBe("completed");
      expect(h.header().fullSuite.atCurrentRevision).toBe(true);
      expect(h.header().fileLevelCounts?.current).toBe(5);
      for (const state of slowStates(h)) expect(state.validity).toBe("current");
      expect(skipReason(h)).toBeNull();
    });
  },
);

/** What another connection reads of the worktree in one committed state: the skip and the header. */
function readBeside(reader: Store, h: Harness): { skipped: number; header: StatusHeader } {
  return readTransaction(reader, () => ({
    skipped: readSlowSkips(reader, h.worktreeId).length,
    header: readHeader(reader, h.worktreeId),
  }));
}

describe(
  "a skip and the checks it governs commit together (review wave-8.1, third round)",
  SLOW,
  () => {
    it("never shows another connection the skip beside a skipped file's check still current", async () => {
      const h = await ranThenUnready(FAILING_UPPER);
      const commonDir = execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        {
          cwd: h.root,
          encoding: "utf8",
        },
      ).trim();
      const reader = openRepoStore(commonDir);
      try {
        const seen: { skipped: number; header: StatusHeader }[] = [];
        const meta = h.store.meta;
        const set = meta.set.bind(meta);
        meta.set = (key, value) => {
          set(key, value);
          if (key === slowSkipsMetaKey(h.worktreeId)) seen.push(readBeside(reader, h));
        };
        await forcedSkip(h);
        meta.set = set;
        expect(seen.length).toBeGreaterThan(0);
        // Inside the writer's transaction the other connection still reads the state before the skip.
        for (const { skipped, header } of seen) {
          expect(skipped).toBe(0);
          expect(header.fileLevelCounts?.current).toBe(5);
        }
        const after = readBeside(reader, h);
        expect(after.skipped).toBe(1);
        expect(after.header.fileLevelCounts?.current).toBe(3);
        expectSkippedNotCurrent(h);
      } finally {
        reader.close();
      }
    });
  },
);
