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
      known: 65,
      seconds: 63,
    });
    expect(namedRun([batch], [OPEN], [OPEN], seconds, { ...AT, factor: 2 })?.seconds).toBe(224);
  });

  it("row 023-65: says the file runs on its own when it runs alone or with the call's files only", () => {
    const alone = namedRun([run("alone", [OPEN], NOW - 1_000)], [OPEN], [OPEN], seconds, AT);
    expect(alone).toMatchObject({ alone: true, files: 1, seconds: 2 });
    expect(namedRunText(alone as NamedRun, timeText)).toBe(
      "test/store/open.test.ts runs on its own (about 2 s)",
    );
    const call = [OPEN, others[0] as TestFileRef];
    const own = namedRun([run("own", call, NOW - 1_000)], call, call, seconds, AT) as NamedRun;
    expect(own).toMatchObject({ alone: true, files: 2 });
    expect(namedRunText(own, timeText)).toBe(
      "test/store/open.test.ts and 1 more named test files run on their own (about 9 s)",
    );
    // A cut batch whose end is not recorded yet: the newer run that holds the file counts.
    const cut = run("cut", [...others, OPEN], NOW - 98_000);
    expect(
      namedRun([cut, run("alone", [OPEN], NOW - 500)], [OPEN], [OPEN], seconds, AT),
    ).toMatchObject({ alone: true, files: 1 });
    // A wider batch wins over a lone run of another named file.
    const two = [OPEN, others[0] as TestFileRef];
    const wide = run("wide", [...others.slice(1), OPEN], NOW - 2_000);
    expect(
      namedRun([wide, run("lone", [others[0] as TestFileRef], NOW - 500)], two, two, seconds, AT),
    ).not.toHaveProperty("alone");
    // A named file not running: no run holds it.
    expect(namedRun([run("b", others, NOW - 1_000)], [OPEN], [OPEN], seconds, AT)).toBeNull();
  });

  it("row 023-65: a lone run with no stored duration reads 'time unknown', never a batch's wait", () => {
    const alone = namedRun([run("alone", [OPEN], NOW - 1_000)], [OPEN], [OPEN], () => null, AT);
    expect(alone).toMatchObject({ alone: true, seconds: null, known: 0 });
    const side = { files: 1, width: 1, seconds: null, basis: "unknown", known: 0, batch: alone };
    expect(sideText(side as never)).toBe(
      "1 test file, time unknown: none has a stored duration and this call measured no rate; test/store/open.test.ts runs on its own (time unknown: it has no stored duration)",
    );
  });

  it("says the time is unknown with no stored duration, and 'any time now' past it", () => {
    const batch = run("batch", [...others, OPEN], NOW - 98_000);
    expect(namedRun([batch], [OPEN], [OPEN], () => null, AT)?.seconds).toBeNull();
    expect(namedRun([batch], [OPEN], [OPEN], () => 1, AT)?.seconds).toBe(0);
  });

  it("keeps the batch's time unknown when too few of its files have a stored duration (review 0.1.607 B1)", () => {
    const batch = run("batch", [...others, OPEN], NOW - 98_000);
    const onlyOpen = (r: TestFileRef) => (r.path === OPEN.path ? 3 : null);
    const got = namedRun([batch], [OPEN], [OPEN], onlyOpen, AT) as NamedRun;
    expect(got).toMatchObject({ files: 65, known: 1, seconds: null });
    expect(namedRunText(got, timeText)).toBe(
      "test/store/open.test.ts runs in a batch of 65 test files started 98 s ago; its result comes when that batch ends (time unknown: too few runs stored (1 of its 65 files has a stored duration) and this call measured no rate)",
    );
    // A rate this call measured wins: 65 files at 10 results in 20 s is 130 s, 98 s of it run.
    const rate = { done: 10, ms: 20_000 };
    expect(namedRun([batch], [OPEN], [OPEN], onlyOpen, { ...AT, rate })?.seconds).toBe(32);
    // Enough stored: a file without one counts at their median (10 s), as the side's estimate does.
    const most = (r: TestFileRef) => (r === others[0] || r === others[1] ? null : seconds(r));
    expect(namedRun([batch], [OPEN], [OPEN], most, AT)).toMatchObject({ known: 63, seconds: 63 });
  });

  it("never lets the call's own known time stand for a batch whose time is unknown (review 0.1.607 B1)", () => {
    const batch = run("batch", [...others, OPEN], NOW - 98_000);
    const got = namedRun([batch], [OPEN], [OPEN], (r) => (r === OPEN ? 3 : null), AT) as NamedRun;
    const side = { files: 1, width: 1, seconds: null, basis: "durations", known: 1, batch: got };
    expect(sideText(side as never)).toBe(
      "1 test file, time unknown: its result waits for the batch that holds it; test/store/open.test.ts runs in a batch of 65 test files started 98 s ago; its result comes when that batch ends (time unknown: too few runs stored (1 of its 65 files has a stored duration) and this call measured no rate)",
    );
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
