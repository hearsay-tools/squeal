import { describe, expect, it } from "vitest";
import { estimateLine, sideText, timeText } from "../../src/cli/status-at-estimate.js";
import {
  type NamedRun,
  namedRun,
  namedRunText,
  runsInFlight,
} from "../../src/cli/status-at-estimate-named.js";
import type {
  AbsolutePath,
  EpochMs,
  RevisionNumber,
  WorktreeId,
} from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunRecord } from "../../src/core/types/store-records.js";
import { fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 023-60 (spec 023 D7.3, round 7 W3): a narrowed call's named file that
 * still runs inside a wider batch gets that batch's time left, not its own
 * "about 3 s"; one that runs alone, or with the call's files only, keeps
 * its own.
 */

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const ref = (path: string): TestFileRef => ({ project: "", path: path as never });
const OPEN = ref("test/store/open.test.ts");
const others = Array.from({ length: 64 }, (_, i) => ref(`test/store/s${i}.test.ts`));

function run(id: string, testFiles: readonly TestFileRef[], startedAt: number): RunRecord {
  return {
    id,
    worktreeId: "w" as WorktreeId,
    revision: 1 as RevisionNumber,
    testFiles,
    checkpointId: null,
    logDir: `/tmp/${id}` as AbsolutePath,
    startedAt: startedAt as EpochMs,
    endedAt: null,
    end: null,
  };
}

/** Every file 10 s, the named one 3 s. */
const seconds = (r: TestFileRef) => (r.path === OPEN.path ? 3 : 10);
const AT = { width: 4, factor: null, now: NOW };

describe("the named file's time inside a wider batch (row 023-60, W3)", () => {
  it("counts the batch's time left: its summed durations over the width, less its run", () => {
    const batch = run("batch", [...others, OPEN], NOW - 98_000);
    const got = namedRun([batch], [OPEN], [OPEN], seconds, AT);
    // (64 × 10 + 3) / 4 = 160.75 s, 98 s of it run.
    expect(got).toEqual({
      named: [OPEN],
      files: 65,
      startedAt: NOW - 98_000,
      ran: 98,
      seconds: 63,
    });
    expect(namedRun([batch], [OPEN], [OPEN], seconds, { ...AT, factor: 2 })?.seconds).toBe(224);
  });

  it("is null when the file runs alone or with the call's files only", () => {
    expect(namedRun([run("alone", [OPEN], NOW - 1_000)], [OPEN], [OPEN], seconds, AT)).toBeNull();
    const call = [OPEN, others[0] as TestFileRef];
    expect(namedRun([run("own", call, NOW - 1_000)], call, call, seconds, AT)).toBeNull();
    // A cut batch whose end is not recorded yet: the newer run that holds the file counts.
    const cut = run("cut", [...others, OPEN], NOW - 98_000);
    expect(
      namedRun([cut, run("alone", [OPEN], NOW - 500)], [OPEN], [OPEN], seconds, AT),
    ).toBeNull();
    // A named file not running: no run holds it.
    expect(namedRun([run("b", others, NOW - 1_000)], [OPEN], [OPEN], seconds, AT)).toBeNull();
  });

  it("says the time is unknown with no stored duration, and 'any time now' past it", () => {
    const batch = run("batch", [...others, OPEN], NOW - 98_000);
    expect(namedRun([batch], [OPEN], [OPEN], () => null, AT)?.seconds).toBeNull();
    expect(namedRun([batch], [OPEN], [OPEN], () => 1, AT)?.seconds).toBe(0);
  });

  it("reads the daemon's runs in flight from the store and writes the line", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const id = repo.mainId as WorktreeId;
    store.worktrees.upsert({
      id,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: "/tmp/squeal-023-60.sock",
        startedAt: NOW - 600_000,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
        token: "live",
      },
    });
    // One run ended, one from before the daemon's start, the batch in flight.
    const { endedAt: _, end: __, ...open } = run("batch", [...others, OPEN], NOW - 98_000);
    store.runs.start({ ...open, worktreeId: id });
    store.runs.start({ ...open, id: "old", worktreeId: id, startedAt: (NOW - 900_000) as EpochMs });
    store.runs.start({ ...open, id: "done", worktreeId: id, testFiles: [OPEN] });
    store.runs.finish("done", "completed", NOW as EpochMs);
    store.close();

    const [runs, none] = runsInFlight(repo.main as AbsolutePath, [id, null]);
    expect(runs?.map((r) => r.id)).toEqual(["batch"]);
    expect(none).toEqual([]);
    const got = namedRun(runs ?? [], [OPEN], [OPEN], seconds, AT) as NamedRun;
    expect(namedRunText(got, timeText)).toBe(
      "test/store/open.test.ts runs in a batch of 65 test files started 98 s ago; its result comes when that batch ends (about 63 s)",
    );
    const side = {
      files: 1,
      width: 1,
      seconds: 63,
      basis: "durations",
      known: 1,
      batch: got,
    } as const;
    expect(sideText(side)).toBe(
      "about 63 s for 1 test file, up to 1 at once, from their stored durations; test/store/open.test.ts runs in a batch of 65 test files started 98 s ago; its result comes when that batch ends (about 63 s)",
    );
    expect(estimateLine({ commit: side, now: null }, "HEAD~1", null)).toContain(
      "at HEAD~1: about 63 s for 1 test file",
    );
  });

  it("names how many more named files share the batch", () => {
    const two = [OPEN, ref("test/store/close.test.ts")];
    const batch = run("batch", [...others, ...two], NOW - 30_000);
    const got = namedRun([batch], two, two, seconds, AT) as NamedRun;
    expect(namedRunText(got, timeText)).toMatch(
      /^test\/store\/open\.test\.ts and 1 more named test files run in a batch of 66 test files started 30 s ago; their results come when that batch ends/,
    );
  });
});
