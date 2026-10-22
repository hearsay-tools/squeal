import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWhy } from "../../src/core/status/index.js";
import { unknownRunOf } from "../../src/core/status/why-unknown.js";
import type {
  AbsolutePath,
  CheckId,
  Store,
  WhyRunLog,
  WorktreeId,
} from "../../src/core/types/index.js";
import { check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";
import { at, LOGIN, reportOf } from "./why-seed.js";

/*
 * Review 0.1.265 B3 (row 011-108; 011 C6 and C7): no bound evicts the record
 * of an UNKNOWN that still stands. Past 1,024 records across worktrees, and
 * after many records whose UNKNOWN recovered, every standing UNKNOWN keeps
 * its record through a prune past retention: `why` names its run, never an
 * older daemon, and prune keeps that run.
 */

const REASON = "worker died";
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTED = at(11);
const LATER = STARTED + 8 * DAY_MS;

const fileOf = (c: CheckId) => ({ project: c.project, path: c.testPath });
const checkOf = (i: number) => check(`src/many/f${i}.test.ts`, `f${i} > works`);

function seed() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = repo.addWorktree("b");
  for (const [id, root, isMain] of [
    [repo.mainId, repo.main, true],
    [b.id, b.root, false],
  ] as const) {
    store.worktrees.upsert({
      id,
      root,
      commonDir: repo.commonDir,
      isMain,
      registeredAt: 1,
      daemon: null,
    });
  }
  return { repo, store, b: b.id };
}

/** A run of `checks` that crashed eight days before the prune, as an UNKNOWN's run is. */
function crashedRun(
  store: Store,
  repo: FakeRepo,
  id: string,
  worktreeId: WorktreeId,
  checks: readonly CheckId[],
) {
  store.runs.start({
    id,
    worktreeId,
    revision: 6,
    testFiles: checks.map(fileOf),
    checkpointId: null,
    logDir: join(repo.commonDir, "squeal", "runs", id),
    startedAt: STARTED,
  });
  store.runs.finish(id, "crashed", STARTED);
}

/** One ledger commit: `checks` read UNKNOWN at `revision`, and the run behind them is recorded. */
function markUnknown(
  store: Store,
  worktreeId: WorktreeId,
  revision: number,
  checks: readonly CheckId[],
  runId: string | null,
) {
  store.transaction(() => {
    store.knownStates.upsertMany(
      checks.map((c) =>
        state(worktreeId, c, {
          outcome: "unknown",
          validity: "unknown",
          observedAt: revision,
          summary: REASON,
        }),
      ),
    );
    store.failures.recordUnknownRuns(
      worktreeId,
      revision,
      [{ testFiles: checks.map(fileOf), reason: REASON, runId }],
      STARTED,
    );
  });
}

const prune = (store: Store) => store.prune({ now: LATER, retentionDays: 7, maxSizeMb: null });

/** A log read as `why` reads one, without touching the disk. */
const logOf = (
  run: { runId: string; worktreeId: WorktreeId },
  logDir: AbsolutePath,
): WhyRunLog => ({
  ...run,
  path: join(logDir, "vitest.log") as AbsolutePath,
  state: "present",
  console: null,
});

/** What `why` reads as the run behind `c`'s UNKNOWN in `worktreeId`. */
function runBehind(store: Store, worktreeId: WorktreeId, c: CheckId) {
  return unknownRunOf(store, worktreeId, c, store.knownStates.get(worktreeId, c), logOf);
}

describe("a standing UNKNOWN keeps its run record past any bound (review 0.1.265 B3)", () => {
  it("names its run after 1,024 newer records and a prune past retention (the review's probe)", () => {
    const { repo, store } = seed();
    crashedRun(store, repo, "unknown-run", repo.mainId, [LOGIN]);
    markUnknown(store, repo.mainId, 7, [LOGIN], "unknown-run");
    const others = Array.from({ length: 1_024 }, (_, i) => checkOf(i));
    crashedRun(store, repo, "other-run", repo.mainId, others);
    markUnknown(store, repo.mainId, 8, others, "other-run");

    prune(store);

    expect(store.knownStates.get(repo.mainId, LOGIN)).toMatchObject({
      outcome: "unknown",
      observedAt: 7,
    });
    const report = reportOf(readWhy(repo.main, "auth > login"));
    expect(report.unknownRun).toMatchObject({ runId: "unknown-run", revision: 6 });
    expect(report.unknownRun?.missing).not.toBe("older-daemon");
    expect(store.runs.get("unknown-run")).not.toBeNull();
  });

  it("keeps every standing record of more than 1,024 across worktrees through a prune", () => {
    const { repo, store, b } = seed();
    const byWorktree = new Map<WorktreeId, CheckId[]>();
    for (const worktreeId of [repo.mainId, b]) {
      const checks = Array.from({ length: 600 }, (_, i) => checkOf(i));
      byWorktree.set(worktreeId, checks);
      // Six tiers of a hundred files each, every one a run of its own.
      for (let tier = 0; tier < 6; tier++) {
        const runId = `run-${worktreeId}-${tier}`;
        const slice = checks.slice(tier * 100, (tier + 1) * 100);
        crashedRun(store, repo, runId, worktreeId, slice);
        markUnknown(store, worktreeId, 10 + tier, slice, runId);
      }
    }

    prune(store);

    for (const [worktreeId, checks] of byWorktree) {
      expect(store.failures.unknownRuns(worktreeId)).toHaveLength(600);
      checks.forEach((c, i) => {
        const runId = `run-${worktreeId}-${Math.floor(i / 100)}`;
        expect(runBehind(store, worktreeId, c)).toMatchObject({ runId, worktreeId, revision: 6 });
        expect(store.runs.get(runId)).not.toBeNull();
      });
    }
  });

  it("keeps a standing record when many recovered ones precede one new UNKNOWN", () => {
    const { repo, store, b } = seed();
    crashedRun(store, repo, "standing-run", repo.mainId, [LOGIN]);
    markUnknown(store, repo.mainId, 7, [LOGIN], "standing-run");
    const recovered = Array.from({ length: 1_100 }, (_, i) => checkOf(i));
    crashedRun(store, repo, "recovered-run", b, recovered);
    markUnknown(store, b, 8, recovered, "recovered-run");
    store.knownStates.upsertMany(recovered.map((c) => state(b, c, { observedAt: 9 })));
    const fresh = check("src/fresh.test.ts", "fresh > works");
    crashedRun(store, repo, "fresh-run", b, [fresh]);
    markUnknown(store, b, 10, [fresh], "fresh-run");

    // The new record's write drops the recovered ones before anything else.
    expect(store.failures.unknownRuns(b).map((r) => r.testFile.path)).toEqual([
      "src/fresh.test.ts",
    ]);
    prune(store);

    expect(runBehind(store, repo.mainId, LOGIN)).toMatchObject({ runId: "standing-run" });
    expect(runBehind(store, b, fresh)).toMatchObject({ runId: "fresh-run", worktreeId: b });
    expect(store.runs.get("standing-run")).not.toBeNull();
    expect(store.runs.get("fresh-run")).not.toBeNull();
    // A recovered UNKNOWN's run follows the usual rule.
    expect(store.runs.get("recovered-run")).toBeNull();
  });
});
