import { describe, expect, it } from "vitest";
import { classLines, fileEntry, reasonGroups } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { publishedYieldRow } from "../../src/core/scheduler/yields.js";
import { standingsOf } from "../../src/core/status/standing.js";
import { timeText } from "../../src/core/text.js";
import type { RunOptions, RunReport, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { completions, heldRun, holdRuns, pause, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-274 (gh-111, `research/issue-111.md`; spec 011 C4 step 5, C15): a
 * named wait on a file whose module ended while its tier still runs says it
 * ended, at which revision, that it awaits the tier's final checks, and the
 * tier's files not reported ended as of the daemon's last write. Ended is
 * never current or passing: the file stays pending until the tier's report,
 * stability check and completion barrier store its result.
 */
const FAST = "test/fast.test.ts";
const SLOW = "test/slow.test.ts";
const FILES: CatchUpFile[] = [
  { path: FAST, ms: 100, imports: ["src/s.ts", "src/f.ts"] },
  { path: SLOW, ms: 200, imports: ["src/s.ts"] },
];

type Run = (refs: readonly TestFileRef[], options: RunOptions) => Promise<RunReport>;

/**
 * A side whose tier of both files names `ended` ended as it starts, in that
 * order 100 ms apart, as Vitest's `onTestModuleEnd` would; `report` may
 * change that run's report. The slow file's runs are held.
 */
async function tierOfBoth(
  ended: readonly string[],
  report: (r: RunReport) => RunReport = (r) => r,
): Promise<{ side: CatchUpSide; stop: () => void }> {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 8, policy: RUN_MISSING });
  await side.scheduler.start();
  await side.scheduler.idle();
  const run: Run = side.runner.run.bind(side.runner);
  side.runner.run = async (refs, options) => {
    if (refs.length < 2) return run(refs, options);
    ended.forEach((path, i) => {
      setTimeout(() => options.fileEnded?.(ref(path)), 100 * i);
    });
    return report(await run(refs, options));
  };
  const base = side.runner.runs.length;
  const hold = holdRuns(side.runner, (path) => path === SLOW);
  await side.edit("watch", "src/s.ts");
  await heldRun(side, SLOW, base);
  return { side, stop: () => hold.stop() };
}

/** Each named file as a named wait reads it now. */
function read(side: CatchUpSide, paths: readonly string[] = [FAST, SLOW]) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  return standingsOf(store, worktreeId, root, daemon, now)(paths.map((path) => ref(path)));
}

/** The `--json` entry of `path`. */
function entryOf(side: CatchUpSide, path: string) {
  const file = read(side, [path])[0];
  if (file === undefined) throw new Error(`no ${path}`);
  return fileEntry(file, "squeal");
}

/** When the daemon last wrote its `yields` row. */
function writtenAt(side: CatchUpSide): number {
  const started = side.store.worktrees.get(side.worktreeId)?.daemon?.startedAt ?? 0;
  const at = publishedYieldRow(side.store, side.worktreeId, started).at;
  if (at === undefined) throw new Error("no yields row");
  return at;
}

describe("a named wait on a file that ended while its tier runs (row 011-274, gh-111)", {
  timeout: 120_000,
}, () => {
  it("a fast file behind a slow peer says it ended and names the peer, and is never current", async () => {
    const { side, stop } = await tierOfBoth([FAST]);
    await expect.poll(() => entryOf(side, FAST).fileEnd, { timeout: 10_000 }).toBeDefined();
    const entry = entryOf(side, FAST);
    const asOf = timeText(writtenAt(side));
    expect(entry).toMatchObject({
      state: "pending",
      ended: 1,
      fileEnd: { unreported: [ref(SLOW)], unreportedCount: 1 },
    });
    expect(entry.verdict).toBeUndefined();
    const revision = entry.fileEnd?.revision;
    expect(revision).toBeGreaterThan(0);
    const reason = `ended at revision ${revision}, awaiting the tier's final checks and 1 file not reported ended as of ${asOf} (${SLOW}), in the vitest tier of 2 test files running since `;
    expect(entry.reason?.startsWith(reason)).toBe(true);
    // Text and JSON agree: the class line and the verdict line say what `--json` says.
    const lines = classLines(read(side), "squeal");
    expect(lines[0]).toBe("Pending (2):");
    const fast = lines.find((line) =>
      line.endsWith(`: ${FAST}; no command runs it sooner (a running tier is not interrupted)`),
    );
    expect(fast).toBe(`  1 ${entry.reason}: ${FAST}; ${entry.next}`);
    // The slow peer reads as a running file of the tier, with no end of its own.
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^ {2}1 in the vitest tier of 2 test files running since \S+, 1 of them ended: test\/slow/,
      ),
    );
    expect(entryOf(side, SLOW).fileEnd).toBeUndefined();
    const verdict = reasonGroups(read(side), "squeal");
    expect(verdict).toContain(`1 ${reason}`);
    expect([...lines, verdict].join("\n")).not.toMatch(/current|passed|pass\b/);
    stop();
    await side.scheduler.idle();
    expect(read(side).map((f) => [f.state, f.verdict])).toEqual([
      ["current", "pass"],
      ["current", "pass"],
    ]);
  });

  it("a late run error after a file ended leaves it without a result, not passing", async () => {
    const crashed = (r: RunReport): RunReport => ({
      ...r,
      end: "crashed",
      completedFiles: [],
      results: [],
      failure: "an unhandled error no test file owns",
    });
    const { side, stop } = await tierOfBoth([FAST], crashed);
    await expect.poll(() => entryOf(side, FAST).fileEnd, { timeout: 10_000 }).toBeDefined();
    expect(entryOf(side, FAST).state).toBe("pending");
    stop();
    await side.scheduler.idle();
    const fast = entryOf(side, FAST);
    expect(fast.state).not.toBe("current");
    expect(fast.verdict).not.toBe("pass");
    expect(fast.fileEnd).toBeUndefined();
    expect(fast.reason ?? "").not.toMatch(/ended/);
  });

  it("changed inputs after a file ended: no end at the new key, and it runs again", async () => {
    const { side, stop } = await tierOfBoth([FAST]);
    await expect.poll(() => entryOf(side, FAST).fileEnd, { timeout: 10_000 }).toBeDefined();
    const ran = completions(side, FAST, 0);
    await side.edit("watch", "src/f.ts");
    // Its key moved: the end of its run at the old key says nothing of the new one.
    await expect.poll(() => entryOf(side, FAST).fileEnd, { timeout: 10_000 }).toBeUndefined();
    expect(entryOf(side, FAST)).toMatchObject({ state: "pending" });
    expect(entryOf(side, FAST).verdict).toBeUndefined();
    stop();
    await side.scheduler.idle();
    expect(completions(side, FAST, 0)).toBeGreaterThan(ran);
    expect(side.current(FAST)).toBe(true);
  });

  it("a delayed end report: a peer that ended after the last write reads not reported, as of that write", async () => {
    // The slow file ends 100 ms after the fast one, inside the 2 s bound on the count's write.
    const { side, stop } = await tierOfBoth([FAST, SLOW]);
    await expect.poll(() => entryOf(side, FAST).fileEnd, { timeout: 10_000 }).toBeDefined();
    await pause(300);
    const at = writtenAt(side);
    const fast = entryOf(side, FAST);
    expect(fast.fileEnd).toEqual({
      revision: fast.fileEnd?.revision,
      asOf: at,
      unreported: [ref(SLOW)],
      unreportedCount: 1,
    });
    expect(fast.reason).toContain(`and 1 file not reported ended as of ${timeText(at)} (${SLOW})`);
    // Not reported is not "still running": the slow file's line claims no end either way.
    const slow = entryOf(side, SLOW);
    expect(slow).toMatchObject({ state: "pending", ended: 1 });
    expect(slow.fileEnd).toBeUndefined();
    stop();
    await side.scheduler.idle();
  });
});
