import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Policy } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Spec 011 C9, the rest, as amended 2026-10-21 (row 011-84, code row
 * 011-91): a daemon that resumes a rest "queues the files its start
 * revision and each unrefined revision reached, whatever `baseline.onStart`,
 * as C4 step 4 classifies a revision, and counts a file it hashes for the
 * first time as added by its start revision". Other starts are unchanged:
 * under `lookup-only` they queue only a predecessor's queued work (C4,
 * 011-30 Q3 (a)). A first daemon runs every file and closes; the edit lands
 * on disk while no daemon runs, so the next one finds it in its `start`
 * revision. 24 test files, file i importing source i % 12.
 */
const TWELVE = sources(12);
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };

/** Each run's paths and whether the pool granted it: an edit's tier is never granted. */
const runsOf = (runs: readonly CatchUpRun[]) =>
  runs.map((run) => ({ paths: run.files.map((f) => f.path), granted: run.workers !== undefined }));

/** An edit on disk while no daemon runs. */
const touch = (repo: CatchUpRepo, ...paths: string[]) => {
  for (const path of paths) appendFileSync(join(repo.main, path), "// edited during the rest\n");
};

/** A worktree whose every file in `files` ran once, its daemon gone. */
async function ranOnce(files: readonly CatchUpFile[]): Promise<CatchUpRepo> {
  const repo = catchUpRepo(files);
  const first = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    backlogTierSize: 4,
    policy: RUN_MISSING,
  });
  await first.scheduler.start();
  await first.scheduler.idle();
  await first.scheduler.close();
  return repo;
}

/** The next daemon under `lookup-only`, started and idle; `resumesRest` as given. */
async function next(
  repo: CatchUpRepo,
  files: readonly CatchUpFile[],
  resumesRest: boolean,
): Promise<CatchUpSide> {
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    backlogTierSize: 4,
    policy: LOOKUP_ONLY,
    resumesRest,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  return side;
}

describe("scheduler: a start after a rest queues what it finds (C9, row 011-91)", {
  timeout: 120_000,
}, () => {
  it("lookup-only, resuming a rest: the edited test file runs in the first group", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const repo = await ranOnce(files);
    const edited = "test/f000.test.ts";
    // The edit the next hook boundary wakes the daemon for: on disk before its start scan.
    touch(repo, edited);
    const resumed = await next(repo, files, true);
    expect(runsOf(resumed.runner.runs)).toEqual([{ paths: [edited], granted: false }]);
    expect(resumed.current(edited)).toBe(true);
    expect(resumed.current("test/f001.test.ts")).toBe(true);
  });

  it("lookup-only, resuming a rest: a revision of 12 keyed paths runs as catch-up", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const repo = await ranOnce(files);
    touch(repo, ...TWELVE);
    const resumed = await next(repo, files, true);
    const runs = runsOf(resumed.runner.runs);
    expect(runs.flatMap((r) => r.paths).sort()).toEqual(files.map((f) => f.path));
    expect(runs.every((r) => r.granted)).toBe(true);
    for (const file of files) expect(resumed.current(file.path)).toBe(true);
  });

  it("lookup-only, resuming a rest: a test file created during the rest runs", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const repo = await ranOnce(files);
    const created: CatchUpFile = { path: "test/new.test.ts", ms: 100, imports: [TWELVE[0] ?? ""] };
    writeFileSync(join(repo.main, created.path), "// created during the rest\n");
    const resumed = await next(repo, [...files, created], true);
    expect(runsOf(resumed.runner.runs)).toEqual([{ paths: [created.path], granted: false }]);
    expect(resumed.current(created.path)).toBe(true);
  });

  it("lookup-only, a start that resumes no rest: the edit and the new file stay stale", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const repo = await ranOnce(files);
    const edited = "test/f000.test.ts";
    touch(repo, edited);
    const created: CatchUpFile = { path: "test/new.test.ts", ms: 100, imports: [TWELVE[0] ?? ""] };
    writeFileSync(join(repo.main, created.path), "// created while no daemon ran\n");
    const started = await next(repo, [...files, created], false);
    expect(started.runner.runs).toEqual([]);
    expect(started.current(edited)).toBe(false);
    expect(started.current(created.path)).toBe(false);
  });
});
