import { describe, expect, it } from "vitest";
import { readUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunEnd, RunnerAdapter, RunReport } from "../../src/core/types/runner.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpRunner,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { SLOW } from "./cleanup.js";

/*
 * Row 026-32 (gh-283): a remote runner's outage leaves the files it ran
 * `unknown` at their key, which no edit moves. Once the remote reconnects
 * the daemon queues them again with `Scheduler.requeueUnknown`, for the
 * reasons it names only; a timeout, a crash of the file's own, a blocked
 * file stay as they are.
 */

const OUTAGE = "remote runner unreachable: connection reset by peer";
const isOutage = (reason: string) => reason.includes("remote runner unreachable");

const FILES = ["a", "b", "c"].map((name) => ({
  path: `test/${name}.test.ts`,
  ms: 1,
  imports: [`src/${name}.ts`],
}));
const [A, B, C] = FILES.map((file) => file.path) as [string, string, string];

interface Faulty {
  readonly side: CatchUpSide;
  /** Runs holding one of these end with the remote's outage. */
  readonly outage: Set<string>;
  /** Runs holding one of these time out. */
  readonly timesOut: Set<string>;
  /** Closure calls fail while set. */
  closureFails: boolean;
}

function ended(files: readonly TestFileRef[], end: RunEnd, failure: string | null): RunReport {
  return { end, durationMs: 1, completedFiles: [], results: [], fileErrors: [], failure };
}

function faultySide(): Faulty {
  const faulty = { outage: new Set<string>(), timesOut: new Set<string>(), closureFails: false };
  const wrap = (runner: CatchUpRunner): RunnerAdapter =>
    new Proxy(runner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        const method = value as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          if (prop === "closure" && faulty.closureFails) throw new Error("remote gone");
          if (prop === "run") {
            const files = args[0] as readonly TestFileRef[];
            if (files.some((f) => faulty.outage.has(f.path)))
              return ended(files, "crashed", OUTAGE);
            if (files.some((f) => faulty.timesOut.has(f.path)))
              return ended(files, "timed-out", null);
          }
          return method.apply(target, args);
        };
      },
    });
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 1,
    tierSize: 1,
    policy: RUN_MISSING,
    wrapRunner: wrap,
  });
  return Object.assign(faulty, { side });
}

const reasonOf = (f: Faulty, path: string) =>
  [...readUnknownFiles(f.side.store, f.side.worktreeId).values()].find(
    (entry) => entry.testFile.path === path,
  )?.reason;

/** A side where `A` is `unknown` for the outage and `B` for a timeout; `C` passes. */
async function outageLeft(): Promise<Faulty> {
  const f = faultySide();
  await f.side.scheduler.start();
  await f.side.quiet();
  for (const path of [A, B, C]) expect(f.side.current(path)).toBe(true);
  f.outage.add(A);
  f.timesOut.add(B);
  await f.side.edit("watch", "src/a.ts", "src/b.ts");
  await f.side.quiet();
  expect(reasonOf(f, A)).toBe(OUTAGE);
  expect(reasonOf(f, B)).toMatch(/time/);
  expect(f.side.current(A)).toBe(false);
  expect(f.side.current(B)).toBe(false);
  expect(f.side.current(C)).toBe(true);
  return f;
}

describe("Scheduler.requeueUnknown (row 026-32)", SLOW, () => {
  it("queues again only the files the outage left unknown, which then pass", SLOW, async () => {
    const f = await outageLeft();
    // Nothing moved their keys: they stay unknown, never queued again on their own.
    await f.side.quiet();
    const runsA = f.side.runner.runsOf(A).length;
    const runsB = f.side.runner.runsOf(B).length;
    const runsC = f.side.runner.runsOf(C).length;

    // The remote reconnects; the timeout is still a timeout.
    f.outage.clear();
    expect(await f.side.scheduler.requeueUnknown?.(isOutage)).toBe(1);
    await f.side.quiet();

    expect(f.side.runner.runsOf(A).length).toBe(runsA + 1);
    expect(f.side.current(A)).toBe(true);
    expect(f.side.runner.runsOf(B).length).toBe(runsB);
    expect(f.side.current(B)).toBe(false);
    expect(reasonOf(f, B)).toMatch(/time/);
    expect(f.side.runner.runsOf(C).length).toBe(runsC);

    // Nothing left that matches.
    expect(await f.side.scheduler.requeueUnknown?.(isOutage)).toBe(0);
  });

  it("queues nothing for a reason that does not match", SLOW, async () => {
    const f = await outageLeft();
    const runsA = f.side.runner.runsOf(A).length;
    f.outage.clear();
    expect(await f.side.scheduler.requeueUnknown?.(() => false)).toBe(0);
    await f.side.quiet();
    expect(f.side.runner.runsOf(A).length).toBe(runsA);
    expect(f.side.current(A)).toBe(false);
  });

  it("leaves a blocked file to its runner's recovery", SLOW, async () => {
    const f = faultySide();
    await f.side.scheduler.start();
    await f.side.quiet();
    f.closureFails = true;
    await f.side.edit("watch", "src/c.ts");
    await f.side.quiet();
    expect(reasonOf(f, C)).toMatch(/closure of test\/c\.test\.ts failed/);
    expect(await f.side.scheduler.requeueUnknown?.(() => true)).toBe(0);
  });

  it("queues nothing once closed", SLOW, async () => {
    const f = await outageLeft();
    await f.side.scheduler.close();
    expect(await f.side.scheduler.requeueUnknown?.(() => true)).toBe(0);
  });
});
