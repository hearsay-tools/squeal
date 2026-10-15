import { describe, expect, it } from "vitest";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { CheckId, ResultRecord } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";
import { reportOf } from "./why-seed.js";

const ADD = check("src/math.test.ts", "add");
const ADD_TWO = check("src/math.test.ts", "add twice");
const ADD_ONCE = check("src/math.test.ts", "add once");

/** Task 001-411: results of `c` with the given durations and outcomes, one key each. */
function timed(
  c: CheckId,
  worktreeId: string,
  runs: readonly [number, ResultRecord["outcome"]][],
): ResultRecord[] {
  return runs.map(([durationMs, outcome], i) => ({
    ...result(c, `${worktreeId}-k${i}`, {
      outcome,
      worktreeId,
      recordedAt: 1_000 + i,
    }),
    durationMs,
  }));
}

function seed() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = repo.addWorktree("b");
  for (const [id, root] of [
    [repo.mainId, repo.main],
    [b.id, b.root],
  ] as const) {
    store.worktrees.upsert({
      id,
      root,
      commonDir: repo.commonDir,
      isMain: id === repo.mainId,
      registeredAt: 1,
      daemon: null,
    });
  }
  store.knownStates.upsertMany([ADD, ADD_TWO, ADD_ONCE].map((c) => state(b.id, c)));
  // `add`: 21 results over two worktrees, so the figures span more than the 20 listed.
  const durations = Array.from({ length: 21 }, (_, i) => (i + 1) * 10);
  store.results.putMany([
    ...timed(
      ADD,
      b.id,
      durations.slice(0, 11).map((d, i) => [d, i === 3 ? "fail" : "pass"]),
    ),
    ...timed(
      ADD,
      repo.mainId,
      durations.slice(11).map((d) => [d, "pass"]),
    ),
    ...timed(ADD, repo.mainId, [[0, "skip"]]).map((r) => ({ ...r, key: "skip-k" })),
    ...timed(ADD_TWO, b.id, [
      [5, "pass"],
      [7, "fail"],
    ]),
    ...timed(ADD_ONCE, b.id, [[42.4, "pass"]]),
  ]);
  return { b };
}

describe("why durations (task 001-411)", () => {
  it("gives one check's figures over every stored result across worktrees, skips untimed", () => {
    const { b } = seed();

    const why = reportOf(readWhy(b.root, "src/math.test.ts > add"));

    expect(why.results).toHaveLength(20);
    expect(why.durations).toEqual({
      results: 21,
      pass: 20,
      fail: 1,
      skip: 1,
      minMs: 10,
      medianMs: 110,
      p95Ms: 200,
      maxMs: 210,
    });
    const text = formatWhy(why);
    expect(text).toContain(
      "\nDurations (21 results, 20 pass / 1 fail, 1 skip not timed): min 10 ms, median 110 ms, p95 200 ms, max 210 ms\nResults (20, newest first):\n",
    );
  });

  it("prints a check with a single result as its one duration", () => {
    const { b } = seed();

    const why = reportOf(readWhy(b.root, "add once"));

    expect(why.durations).toEqual({
      results: 1,
      pass: 1,
      fail: 0,
      skip: 0,
      minMs: 42.4,
      medianMs: 42.4,
      p95Ms: 42.4,
      maxMs: 42.4,
    });
    expect(formatWhy(why)).toContain("\nDurations (1 result, 1 pass / 0 fail): 42 ms\n");
  });

  it("puts each candidate's figures beside it when a name matches several checks", () => {
    const { b } = seed();

    const why = readWhy(b.root, "> ad");

    expect(why).toMatchObject({
      found: false,
      candidates: [ADD, ADD_ONCE, ADD_TWO],
      candidateDurations: [
        { results: 21, minMs: 10, maxMs: 210 },
        { results: 1, maxMs: 42.4 },
        { results: 2, pass: 1, fail: 1, minMs: 5, medianMs: 5, p95Ms: 7, maxMs: 7 },
      ],
    });
    expect(formatWhy(why)).toBe(
      [
        '"> ad" matches 3 checks in this worktree:',
        "  src/math.test.ts > add  (21 results, 20 pass / 1 fail, 1 skip not timed): min 10 ms, median 110 ms, p95 200 ms, max 210 ms",
        "  src/math.test.ts > add once  (1 result, 1 pass / 0 fail): 42 ms",
        "  src/math.test.ts > add twice  (2 results, 1 pass / 1 fail): min 5 ms, median 5 ms, p95 7 ms, max 7 ms",
        "",
      ].join("\n"),
    );
  });

  it("leaves the line out when the check has no stored pass or fail", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    store.knownStates.upsertMany([state(repo.mainId, ADD)]);

    const why = reportOf(readWhy(repo.main, "src/math.test.ts > add"));

    expect(why.durations).toBeNull();
    expect(formatWhy(why)).not.toContain("Durations");
  });
});
