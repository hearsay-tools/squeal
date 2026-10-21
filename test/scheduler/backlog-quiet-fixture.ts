import { expect } from "vitest";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRun,
  type CatchUpRunner,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";
import { CUT_WITHIN_MS, heldRun, START_WITHIN_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-94 (spec 011 C4 step 5 as amended 2026-10-21, `tasks/011-82/design.md`
 * row A): what the tests of a lane's wait for quiet share. One Vitest-like
 * lane of 50 backlog files of 100 ms and one edited file `E` of 1 ms in a
 * project of its own, the catch-up fixture's fake runner, and a scheduler
 * clock that runs at a tenth of the host's speed plus what `advance` adds:
 * a 20 s wait ends at once on `advance` (the pump looks again each
 * `QUIET_RECHECK_MS`), and never by itself within a check's poll.
 */

/** The 12 sources the backlog files import: editing all of them is a pull's catch-up (12 keyed paths). */
export const BACKLOG_SOURCES = sources(12);
export const BACKLOG = testFiles(50, BACKLOG_SOURCES, () => 100);
export const EDITED: CatchUpFile = {
  project: "e",
  path: "e/e.test.ts",
  ms: 1,
  imports: ["src/e.ts"],
};
/** A tracked path no test file reads. */
export const DOCS = "docs/notes.md";

export const isBacklog = (path: string) => path.startsWith("test/f");
export const backlogPath = (i: number) => BACKLOG[i]?.path ?? "";

export interface QuietSide {
  readonly side: CatchUpSide;
  /** Moves the scheduler's clock `ms` ahead. */
  advance(ms: number): void;
  /** The scheduler's clock. */
  now(): number;
}

/** A side of `BACKLOG`, `EDITED` and `extra`, its baseline stored. */
export async function quietSide(
  extra: readonly CatchUpFile[] = [],
  options: Partial<CatchUpOptions> = {},
): Promise<QuietSide> {
  const files = [...BACKLOG, EDITED, ...extra];
  const repo = catchUpRepo(files, [DOCS]);
  const start = Date.now();
  let offset = 0;
  const now = () => start + Math.floor((Date.now() - start) / 10) + offset;
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, now, ...options });
  await side.scheduler.start();
  await side.scheduler.idle();
  return {
    side,
    advance: (ms) => {
      offset += ms;
    },
    now,
  };
}

/**
 * Holds each run of backlog files only until its cancel or `stop`; a run
 * holding any other file, an edit's tier that took backlog files beside it
 * included, starts at once.
 */
export function holdBacklog(runner: CatchUpRunner) {
  let on = true;
  runner.beforeRun = (files) => {
    if (on && files.every((f) => isBacklog(f.path))) runner.hold();
    else runner.release();
  };
  return {
    stop(): void {
      on = false;
      runner.release();
    },
  };
}

/** The runs after the first `after` that hold backlog files only. */
export function backlogRuns(side: CatchUpSide, after: number): CatchUpRun[] {
  return side.runner.runs.slice(after).filter((run) => run.files.every((f) => isBacklog(f.path)));
}

/**
 * A config edit queues the backlog, whose tier is held; then an edit of
 * `E`'s source cancels it, and `E` is current. Returns the number of runs
 * up to the cancelled one: what starts later is after the cancel.
 */
export async function cancelBacklog({ side }: QuietSide): Promise<number> {
  const base = side.runner.runs.length;
  await side.edit("watch", "config.json");
  const cut = await heldRun(side, backlogPath(0), base);
  await side.edit("watch", "src/e.ts");
  await expect.poll(() => cut.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
  await editedCurrent(side);
  return side.runner.runs.indexOf(cut) + 1;
}

/** `E` is current: its edit's tier ran. */
export async function editedCurrent(side: CatchUpSide): Promise<void> {
  await expect.poll(() => side.current(EDITED.path), { timeout: START_WITHIN_MS }).toBe(true);
}

/** A backlog tier starts after the first `after` runs, with no further clock move. */
export async function backlogStarts(side: CatchUpSide, after: number): Promise<void> {
  await expect
    .poll(() => backlogRuns(side, after).length, { timeout: START_WITHIN_MS })
    .toBeGreaterThan(0);
}
