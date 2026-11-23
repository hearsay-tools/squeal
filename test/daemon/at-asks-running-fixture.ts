import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { type AtAskPorts, AtAsks } from "../../src/core/daemon/at-asks.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../scheduler/catch-up-fixture.js";

/*
 * Rows 023-60 and 023-65 (spec 023 D7.3, W3): a real scheduler as a commit
 * daemon, lookup-only, and its asks; a wide ask's batch tier of 40 files at
 * 4 workers, into which a later ask names a file.
 */

export const TIMEOUT = 20_000;
export const path = (i: number) => `test/f${String(i).padStart(2, "0")}.test.ts`;
export const files = (ms: number, realMs: (i: number) => number): CatchUpFile[] =>
  Array.from({ length: 40 }, (_, i) => ({
    path: path(i),
    ms,
    realMs: realMs(i),
    imports: [`src/s${i}.ts`],
  }));
export const paths = (run: CatchUpRun | undefined) => run?.files.map((f) => f.path) ?? [];

/**
 * A commit daemon's scheduler over `of` whose store holds each file's
 * duration, `ms`, from another worktree's run, while its own keys differ (a
 * changed environment file): every file is a miss, none queued.
 */
export async function seeded(of: readonly CatchUpFile[]): Promise<CatchUpSide> {
  const repo = catchUpRepo(of);
  // The other worktree's run stores the durations; its own runs take no time.
  const quick = of.map((f) => ({ ...f, realMs: 0 }));
  const other = catchUpSide(repo, repo.other, { files: quick, hostSlots: 4, policy: RUN_MISSING });
  await other.scheduler.start();
  await expect.poll(() => of.every((f) => other.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  appendFileSync(join(repo.main, "config.json"), "// the commit\n");
  const side = catchUpSide(repo, repo.main, {
    files: of,
    hostSlots: 4,
    policy: { baseline: { onStart: "lookup-only" } },
  });
  await side.scheduler.start();
  await side.rest();
  return side;
}

/** The commit daemon's asks over `side`'s scheduler, every file of `of` with no result. */
export function asksOf(side: CatchUpSide, of: readonly CatchUpFile[]): AtAsks {
  const refs: TestFileRef[] = of.map((f) => ({ project: "", path: f.path }));
  const ports: AtAskPorts = {
    setup: () => ({ phase: "ready" }),
    started: async () => {},
    changedSelects: async () => refs,
    rows: () => refs.map((testFile) => ({ testFile, key: `k-${testFile.path}`, pending: null })),
    stored: () => false,
    needs: async () => new Map(),
    groupOf: () => "tests",
    request: async (group, asked, options) => {
      await side.scheduler.requestGroupPaths?.(group, asked, options);
    },
    changed: () => {},
  };
  return new AtAsks(ports);
}

/** An ask of `owner` naming `named`, queued. */
export async function ask(asks: AtAsks, owner: string, named: readonly string[]): Promise<void> {
  asks.ask({ type: "commit-ask", owner, changed: ["src/s0.ts"], named, allMissing: false });
  await expect
    .poll(() => asks.snapshot().asks.find((a) => a.owner === owner)?.phase, { timeout: TIMEOUT })
    .toBe("queued");
}

/** The wide call's batch tier in flight: all 40 files at the grant. */
export async function wideTier(side: CatchUpSide, asks: AtAsks): Promise<CatchUpRun> {
  await ask(asks, "wide", []);
  await expect.poll(() => side.runner.runs.length, { timeout: TIMEOUT }).toBe(1);
  const [tier] = side.runner.runs;
  if (tier === undefined) throw new Error("no tier");
  expect([tier.files.length, tier.workers]).toEqual([40, 4]);
  return tier;
}

/**
 * Row 023-65: a commit daemon's scheduler over `of` on an empty store, as
 * round 8's sessions began: every file a miss, none with a stored duration.
 */
export async function unseeded(of: readonly CatchUpFile[]): Promise<CatchUpSide> {
  const repo = catchUpRepo(of);
  const side = catchUpSide(repo, repo.main, {
    files: of,
    hostSlots: 4,
    policy: { baseline: { onStart: "lookup-only" } },
  });
  await side.scheduler.start();
  await side.rest();
  return side;
}
