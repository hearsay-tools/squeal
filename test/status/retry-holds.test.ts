import { describe, expect, it } from "vitest";
import { askRetry, claimRetries, endRetries } from "../../src/core/retry/index.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { timeText } from "../../src/core/text.js";
import type {
  CheckKey,
  EpochMs,
  OutstandingGroup,
  RetryWait,
  SlowTierActivity,
  StatusSnapshot,
} from "../../src/core/types/index.js";
import { check, state } from "./helpers.js";
import { FAST, keys, NOW, SLOW_A, SLOW_B, seed } from "./slow-tier-seed.js";

/*
 * Row 011-272 (gh-114; 011 C5 and C6, 004 D2 and D8): a retry its daemon
 * queued says it has not started and what holds it, as the live daemon
 * recorded it, or that what holds it is not known; text and JSON agree, and
 * its FAIL stays counted until a retry passes.
 */

const FAST_B = "src/b.test.ts";
const ref = (path: string) => ({ project: "", path });

/** `paths` failing, each with an environment retry this worktree's daemon queued. */
function queued(...paths: string[]) {
  const s = seed();
  keys(s.store, s.repo, { [FAST_B]: null, ...Object.fromEntries(paths.map((p) => [p, "queued"])) });
  s.store.knownStates.upsertMany(
    paths.map((p) => state(s.repo.mainId, check(p, "works"), { outcome: "fail", observedAt: 1 })),
  );
  for (const path of paths) {
    const key = `key-${path}` as CheckKey;
    const ask = { testFile: ref(path), key, reason: "environment" as const, at: NOW };
    askRetry(s.store, { ...ask, session: "s1", worktreeId: s.repo.mainId });
    claimRetries(s.store, ref(path), key, s.repo.mainId, NOW, () => true);
  }
  const run = (id: string, path: string, startedAt: EpochMs) =>
    s.store.runs.start({
      id,
      worktreeId: s.repo.mainId,
      revision: 1 as never,
      testFiles: [{ project: "", path: path as never }],
      checkpointId: null,
      logDir: `/tmp/${id}` as never,
      startedAt,
    });
  const publish = (activity: SlowTierActivity) =>
    publishSlowActivity(s.store, s.repo.mainId, activity);
  return { ...s, run, publish };
}

/** Status's retry lines, its retry groups' `waits` in the JSON payload, and its failing files. */
function read({ repo }: ReturnType<typeof queued>) {
  const status = readStatus(repo.main, { now: () => NOW }) as StatusSnapshot;
  const json = JSON.parse(JSON.stringify(status)) as StatusSnapshot;
  const groups = (json.outstanding ?? []).filter((g) => g.standing.kind === "retry");
  return {
    lines: formatStatus(status, NOW)
      .split("\n")
      .filter((l) => l.includes("pending retry")),
    waits: groups.map(waitsOf),
    failing: status.knownFailures.map((f) => (f.check.kind === "test" ? f.check.testPath : "")),
    text: formatStatus(status, NOW),
  };
}

function waitsOf(group: OutstandingGroup): RetryWait | undefined {
  return group.standing.kind === "retry" ? group.standing.waits : undefined;
}

const line = (path: string, state: string) =>
  `  1 test file with a pending retry (environment): ${path}; ${state}`;

describe("a queued retry says what holds it (row 011-272, gh-114)", () => {
  it("a slow retry behind an edit's fast run, which publishes no slow wait", () => {
    const s = queued(SLOW_A);
    s.run("fast", FAST, NOW - 30_000);
    expect(read(s)).toMatchObject({
      lines: [
        line(
          SLOW_A,
          `queued and not started: fast work goes first (a run open since ${timeText(NOW - 30_000)})`,
        ),
      ],
      waits: [{ kind: "fast", since: NOW - 30_000 }],
      failing: [SLOW_A],
    });
  });

  it("a slow retry the slow tier holds for fast work, with none open now", () => {
    const s = queued(SLOW_A);
    s.publish({ kind: "waiting", for: "fast" });
    expect(read(s)).toMatchObject({
      lines: [line(SLOW_A, "queued and not started: fast work goes first")],
      waits: [{ kind: "fast", since: null }],
    });
  });

  it.each([
    ["slot", "the slow tier waits for the slow slot"],
    ["load", "the slow tier waits for the host load to drop"],
  ] as const)("a slow retry the slow tier holds for the %s", (wait, words) => {
    const s = queued(SLOW_A);
    s.publish({ kind: "waiting", for: wait });
    expect(read(s)).toMatchObject({
      lines: [line(SLOW_A, `queued and not started: ${words}`)],
      waits: [{ kind: wait }],
      failing: [SLOW_A],
    });
  });

  it("a slow retry behind the slow tier's run of another file", () => {
    const s = queued(SLOW_A);
    keys(s.store, s.repo, { [SLOW_B]: "running" });
    s.run("slow-b", SLOW_B, NOW - 5_000);
    s.publish({ kind: "running", path: SLOW_B, since: NOW - 5_000, lastDurationMs: null });
    expect(read(s)).toMatchObject({
      lines: [
        line(
          SLOW_A,
          `queued and not started: the slow tier runs other files, since ${timeText(NOW - 5_000)}`,
        ),
      ],
      waits: [{ kind: "slow", since: NOW - 5_000 }],
    });
  });

  it("a fast retry behind its lane's tier", () => {
    const s = queued(FAST);
    s.run("fast-b", FAST_B, NOW - 2_000);
    expect(read(s)).toMatchObject({
      lines: [
        line(
          FAST,
          `queued and not started: the tier of its lane runs first, since ${timeText(NOW - 2_000)}`,
        ),
      ],
      waits: [{ kind: "tier", since: NOW - 2_000 }],
    });
  });

  it("with no blocker evidence: queued, not started, and what holds it is not known", () => {
    const s = queued(SLOW_A);
    const { lines, waits, failing, text } = read(s);
    expect(lines).toEqual([line(SLOW_A, "queued and not started; what holds it is not known")]);
    expect(waits).toEqual([{ kind: "unknown" }]);
    expect(failing).toEqual([SLOW_A]);
    expect(text).not.toMatch(/runs at once|runs once more now|daemon's next look/);
  });

  it("files held by different things read in different lines", () => {
    const s = queued(SLOW_A, FAST);
    s.publish({ kind: "waiting", for: "slot" });
    expect(read(s).lines).toEqual([
      line(FAST, "queued and not started; what holds it is not known"),
      line(SLOW_A, "queued and not started: the slow tier waits for the slow slot"),
    ]);
  });

  it("once its run ended without a pass, no retry is pending and the FAIL stays counted", () => {
    const s = queued(SLOW_A);
    keys(s.store, s.repo, { [SLOW_A]: null });
    const end = { outcome: "failed" as const, at: NOW, worktreeId: s.repo.mainId, runId: "r" };
    endRetries(s.store, ref(SLOW_A), `key-${SLOW_A}` as CheckKey, end);
    const { lines, waits, failing } = read(s);
    expect([lines, waits, failing]).toEqual([[], [], [SLOW_A]]);
  });
});
