import { describe, expect, it } from "vitest";
import { askRetry, claimRetries } from "../../src/core/retry/index.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
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
import { inTurn, keys, NOW, SLOW_A, SLOW_B, SLOW_POLICY, seed } from "./slow-tier-seed.js";

/*
 * Row 019-27 (spec 019 D3, D6; 019-16's notes, "Found, not fixed"): a
 * retry of a file a configured group owns, queued and not started, says
 * what holds it by its group, as the group's lane published, and names
 * `squeal run <group>` where the group's moment or the load holds it. It
 * never reads as a slow file, though `slow.include` marks it. Text and the
 * JSON payload's `waits` agree.
 */

const ref = (path: string) => ({ project: "", path });

/** `e2e` at `at`, after `tests`, owns the files `slow.include` marks. */
function policy(at: "stop" | "commit") {
  return {
    ...SLOW_POLICY,
    checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at, after: ["tests"] }],
  };
}

/** `SLOW_A` failing, with an environment retry this worktree's daemon queued. */
function queued(at: "stop" | "commit" = "stop") {
  const s = seed(policy(at));
  keys(s.store, s.repo, { [SLOW_A]: "queued" });
  s.store.knownStates.upsertMany([
    state(s.repo.mainId, check(SLOW_A, "works"), { outcome: "fail", observedAt: 1 }),
  ]);
  const key = `key-${SLOW_A}` as CheckKey;
  const ask = { testFile: ref(SLOW_A), key, reason: "environment" as const, at: NOW };
  askRetry(s.store, { ...ask, session: "s1", worktreeId: s.repo.mainId });
  claimRetries(s.store, ref(SLOW_A), key, s.repo.mainId, NOW, () => true);
  const publish = (activity: SlowTierActivity) =>
    publishGroupActivity(s.store, s.repo.mainId, "e2e", activity);
  return { ...s, publish };
}

/** Status's retry line and its group's `waits` in the JSON payload. */
function read({ repo }: ReturnType<typeof queued>) {
  const status = readStatus(repo.main, { now: () => NOW }) as StatusSnapshot;
  const json = JSON.parse(JSON.stringify(status)) as StatusSnapshot;
  const groups = (json.outstanding ?? []).filter((g) => g.standing.kind === "retry");
  return {
    lines: formatStatus(status, NOW)
      .split("\n")
      .filter((l) => l.includes("pending retry")),
    waits: groups.map(waitsOf),
  };
}

function waitsOf(group: OutstandingGroup): RetryWait | undefined {
  return group.standing.kind === "retry" ? group.standing.waits : undefined;
}

const line = (state: string) =>
  `  1 test file with a pending retry (environment): ${SLOW_A}; queued and not started${state}`;

const E2E = { kind: "group", group: "e2e", at: "stop", after: ["tests"] } as const;

describe("a queued retry of a configured group's file reads by its group (019-27)", () => {
  it("behind its group's run of another file", () => {
    const s = queued();
    keys(s.store, s.repo, { [SLOW_B]: "running" });
    s.store.runs.start({
      id: "e2e-b",
      worktreeId: s.repo.mainId,
      revision: 1 as never,
      testFiles: [{ project: "", path: SLOW_B as never }],
      checkpointId: null,
      logDir: "/tmp/e2e-b" as never,
      startedAt: (NOW - 5_000) as EpochMs,
    });
    s.publish({ kind: "running", path: SLOW_B as never, since: NOW - 5_000, lastDurationMs: null });
    expect(read(s)).toEqual({
      lines: [line(`: the e2e group runs other files, since ${timeText(NOW - 5_000)}`)],
      waits: [{ ...E2E, lane: { kind: "running", since: NOW - 5_000 } }],
    });
  });

  it("waiting for the agent to pause, with the group's run command", () => {
    const s = queued();
    inTurn(s);
    s.publish({ kind: "waiting", for: "idle" });
    expect(read(s)).toEqual({
      lines: [line(": the e2e group waits for the agent to pause; `squeal run e2e` runs it now")],
      waits: [{ ...E2E, lane: { kind: "waiting", for: "idle" } }],
    });
  });

  it.each([
    ["fast", "the e2e group waits for the tests group's files"],
    [
      "slot",
      "the e2e group waits for capacity; whether the e2e group's slot or the shared worker pool holds it is not known",
    ],
    ["pool", "the e2e group waits for the shared worker pool"],
    ["load", "the e2e group waits for the host load to drop; `squeal run e2e` runs it now"],
  ] as const)("waiting for the %s", (wait, words) => {
    const s = queued();
    s.publish({ kind: "waiting", for: wait });
    expect(read(s)).toEqual({
      lines: [line(`: ${words}`)],
      waits: [{ ...E2E, lane: { kind: "waiting", for: wait } }],
    });
  });

  it("at `commit`, with nothing published: a commit runs only the files it changes", () => {
    expect(read(queued("commit"))).toEqual({
      lines: [
        line(
          ": the e2e group runs at a commit only the files that commit changes; `squeal run e2e` runs it now",
        ),
      ],
      waits: [{ ...E2E, at: "commit", lane: null }],
    });
  });

  it("at `stop`, with nothing published: what holds it in the group is not known", () => {
    const { lines } = read(queued());
    expect(lines).toEqual([line("; what holds it in the e2e group is not known")]);
    expect(lines.join("\n")).not.toMatch(/slow tier|fast work/);
  });
});
