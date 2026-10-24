import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fullSuiteText, readHeader } from "../../src/core/state/index.js";
import { DEFAULT_POLICY, type TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Task 004-61 (spec 004 D2 as amended): `run --all` runs both lanes, `--fast`
 * only the fast lane and `--slow` only the slow one. A one-lane checkpoint is
 * not a full-suite checkpoint, and the header names the lane that completed.
 * In the `basic` fixture these two files are slow.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts"];
const FAST_FILES = ALL_TEST_FILES.filter((path) => !SLOW_FILES.includes(path));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open(): Promise<Harness> {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-61-"));
  dirs.push(slotDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: { ...RUN_MISSING, slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES } },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  await waitFor(() => readHeader(h.store, h.worktreeId).fullSuite.atCurrentRevision, 60_000);
  return h;
}

const paths = (files: readonly TestFileRef[]) => files.map((f) => f.path).sort();

function ranSince(h: Harness, from: number): string[] {
  return h.runner.runs
    .slice(from)
    .flatMap((run) => run.files.map((f) => f.path))
    .sort();
}

describe("lane flags for a full run (task 004-61)", SLOW, () => {
  it("--fast queues no slow file, and is not a full-suite checkpoint", async () => {
    const h = await open();
    // A revision after the baseline's full suite, which the fast lane alone does not complete again.
    h.write("src/notes.md", "an edit\n");
    await h.batch("src/notes.md");
    await h.scheduler.idle();
    const before = h.runner.runs.length;
    const record = await h.scheduler.requestFullSuite({ force: true, lane: "fast" });
    expect(record.lane).toBe("fast");
    expect(paths(record.testFiles)).toEqual([...FAST_FILES].sort());
    await waitFor(() => h.store.checkpoints.get(record.id)?.end === "completed", 60_000);
    await h.scheduler.idle();
    expect(ranSince(h, before)).toEqual([...FAST_FILES].sort());

    expect(h.store.checkpoints.get(record.id)?.lane).toBe("fast");
    expect(h.store.checkpoints.lastCompletedFull(h.worktreeId)?.id).not.toBe(record.id);
    const header = readHeader(h.store, h.worktreeId);
    expect(header.fullSuite.lane).toEqual({ lane: "fast", revision: record.revision });
    expect(fullSuiteText(header, "squeal")).toMatch(
      /; only the fast lane completed, at revision \d+ \(the counts/,
    );
  });

  it("--slow queues no fast file", async () => {
    const h = await open();
    const record = await h.scheduler.requestFullSuite({ force: true, lane: "slow" });
    expect(record.lane).toBe("slow");
    expect(paths(record.testFiles)).toEqual([...SLOW_FILES].sort());
    await h.scheduler.idle();
  });

  it("both lanes are --all: every file, and a full-suite checkpoint", async () => {
    const h = await open();
    const record = await h.scheduler.requestFullSuite({ force: true });
    expect(record.lane).toBeUndefined();
    expect(paths(record.testFiles)).toEqual([...ALL_TEST_FILES].sort());
    await waitFor(() => h.store.checkpoints.get(record.id)?.end === "completed", 60_000);
    expect(h.store.checkpoints.lastCompletedFull(h.worktreeId)?.id).toBe(record.id);
    expect(readHeader(h.store, h.worktreeId).fullSuite.lane).toBeUndefined();
    await h.scheduler.idle();
  });
});
