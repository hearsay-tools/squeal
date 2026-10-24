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
 * Spec 011 C4, "Explicit checkpoints" as amended 2026-10-20 (row 011-30, Q3
 * (a), task 011-33): "Whatever the policy, a daemon's start queues again
 * every file its worktree's rows leave `queued` or `running`, at this
 * daemon's key, unless the lookup finds a result there." Step 4 orders them
 * as of the revisions whose re-key moves are still open. A predecessor's
 * edit is held in its tier and cut short by a stop's cancel, which leaves
 * its rows `queued`; a successor starts on the same worktree and store.
 * 24 test files, file i importing source i % 12.
 */
const TWELVE = sources(12);
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };

/** Each run's paths and whether the pool granted it: an edit's tier is never granted. */
const runsOf = (runs: readonly CatchUpRun[]) =>
  runs.map((run) => ({ paths: run.files.map((f) => f.path), granted: run.workers !== undefined }));

/** The files importing one of `sourcesOf`. */
const importers = (files: readonly CatchUpFile[], sourcesOf: readonly string[]) =>
  files.filter((f) => sourcesOf.includes(f.imports[0] ?? "")).map((f) => f.path);

/** A worktree whose every file ran once, then a daemon under `policy` with `paths` held in flight. */
async function heldThenStopped(
  files: readonly CatchUpFile[],
  policy: Partial<Policy>,
  ...edits: (readonly string[])[]
): Promise<{ repo: CatchUpRepo; side: CatchUpSide }> {
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
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, backlogTierSize: 4, policy });
  await side.scheduler.start();
  await side.scheduler.idle();
  side.runner.hold();
  for (const paths of edits) await side.edit("watch", ...paths);
  await expect.poll(() => side.runner.active).toBeGreaterThan(0);
  // `squeal stop`: the tier in flight is cancelled, its files stay queued (C9).
  await side.scheduler.close({ cancel: true });
  return { repo, side };
}

/** The successor: a scheduler of the same worktree under `policy`, started and idle. */
async function successor(
  repo: CatchUpRepo,
  files: readonly CatchUpFile[],
  policy: Partial<Policy>,
  adapterVersion = "1",
): Promise<CatchUpSide> {
  const next = catchUpSide(repo, repo.main, { files, hostSlots: 4, backlogTierSize: 4, policy });
  const environment = next.runner.environment;
  // Every key moves while no daemon ran, as a key-format change moves them.
  next.runner.environment = async () =>
    (await environment()).map((env) => ({ ...env, adapterVersion }));
  await next.scheduler.start();
  await next.scheduler.idle();
  return next;
}

describe("scheduler: a restart hands the queued work over (C4, task 011-33)", {
  timeout: 120_000,
}, () => {
  it("lookup-only: an open edit move's queued file runs in the first group", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const { repo } = await heldThenStopped(files, LOOKUP_ONLY, [TWELVE[0] ?? ""]);
    const next = await successor(repo, files, LOOKUP_ONLY);
    const edited = importers(files, [TWELVE[0] ?? ""]);
    expect(runsOf(next.runner.runs)).toEqual([{ paths: edited, granted: false }]);
    for (const path of edited) expect(next.current(path)).toBe(true);
  });

  it("lookup-only: an environment-only re-key's queued files run in the second group", async () => {
    const files = testFiles(8, TWELVE.slice(0, 4), () => 100);
    const { repo } = await heldThenStopped(files, LOOKUP_ONLY, ["config.json"]);
    const next = await successor(repo, files, LOOKUP_ONLY);
    const runs = runsOf(next.runner.runs);
    expect(runs.flatMap((r) => r.paths).sort()).toEqual(files.map((f) => f.path));
    expect(runs.every((r) => r.granted)).toBe(true);
  });

  it("lookup-only: a catch-up revision's queued files run as catch-up, before the environment's", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const others = testFiles(4, ["src/other.ts"], () => 100).map((f, i) => ({
      ...f,
      path: `test/other${i}.test.ts`,
    }));
    const all = [...files, ...others];
    const { repo } = await heldThenStopped(all, LOOKUP_ONLY, TWELVE, ["config.json"]);
    const next = await successor(repo, all, LOOKUP_ONLY);
    const runs = runsOf(next.runner.runs);
    expect(runs.every((r) => r.granted)).toBe(true);
    const order = runs.flatMap((r) => r.paths.map((path) => (path.includes("other") ? 1 : 0)));
    expect(order).toHaveLength(28);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("lookup-only, under a key-format change: the queued file runs at its new key, the rest stay stale", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const { repo } = await heldThenStopped(files, LOOKUP_ONLY, [TWELVE[0] ?? ""]);
    const next = await successor(repo, files, LOOKUP_ONLY, "2");
    const edited = importers(files, [TWELVE[0] ?? ""]);
    expect(runsOf(next.runner.runs)).toEqual([{ paths: edited, granted: false }]);
    for (const file of files) expect(next.current(file.path)).toBe(edited.includes(file.path));
  });

  it("default baseline, under a key-format change: the handed-over edit runs before the misses", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const { repo } = await heldThenStopped(files, RUN_MISSING, [TWELVE[0] ?? ""]);
    const next = await successor(repo, files, RUN_MISSING, "2");
    const edited = importers(files, [TWELVE[0] ?? ""]);
    const runs = runsOf(next.runner.runs);
    expect(runs.flatMap((r) => r.paths)).toHaveLength(24);
    // An edit's tier, which fills with files of a comparable duration beside them (C4).
    expect(runs[0]?.granted).toBe(false);
    expect(runs[0]?.paths.slice(0, edited.length).sort()).toEqual(edited);
    expect(runs.slice(1).some((r) => r.paths.some((p) => edited.includes(p)))).toBe(false);
  });
});
