import { describe, expect, it } from "vitest";
import { NO_YIELD_ROW } from "../../src/core/scheduler/yield-row.js";
import { writeYieldRow } from "../../src/core/scheduler/yields.js";
import { timeText } from "../../src/core/text.js";
import type { RevisionNumber, Store } from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { config, named } from "./next-step-seed.js";
import { B, key, NOW, ref, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Row 011-27 (011 C15 as amended 2026-10-20; design 011-24 section 3): the
 * rows of a pending selected file, each with what holds it and what, if
 * anything, runs it sooner. The claim, slow and unlisted rows keep their
 * reasons and are in `status-wait-reasons.test.ts`.
 */

const STARTED = NOW - 30_000;
const SINCE = timeText(STARTED);
const FAST = ["tests/fast/f1.test.ts", "tests/fast/f2.test.ts", "tests/fast/f3.test.ts"];

function openRun(store: Store, worktreeId: string, id: string, paths: readonly string[]) {
  store.runs.start({
    id,
    worktreeId,
    revision: 4 as RevisionNumber,
    testFiles: paths.map(ref),
    checkpointId: null,
    logDir: `/tmp/${id}`,
    startedAt: STARTED,
  });
}

/** `path`'s row and check running, as `startTier` writes them. */
function running(store: Store, worktreeId: string, path: string) {
  key(store, worktreeId, path, "running");
  store.knownStates.upsertMany([
    state(worktreeId, check(path, "holds"), { validity: "pending", pendingPhase: "running" }),
  ]);
}

describe("a pending selected file names what holds it and what runs it sooner (011-27)", () => {
  it("running alone in its run: no step is needed", () => {
    const { repo, store } = repoWith([]);
    running(store, repo.mainId, B);
    openRun(store, repo.mainId, "run-b", [B]);

    expect(named(store, repo.mainId, repo.main, [B]).lines).toEqual([
      "Pending (1):",
      `  1 running since ${SINCE} in the vitest lane: ${B}`,
    ]);
  });

  it("gh-40 A: inside a running 27-file tier, in that tier and not running, nothing runs them sooner", () => {
    const { repo, store } = repoWith([]);
    for (const path of FAST) running(store, repo.mainId, path);
    const backlog = Array.from({ length: 24 }, (_, i) => `tests/backlog/b${i}.test.ts`);
    openRun(store, repo.mainId, "run-backlog", [...FAST, ...backlog]);
    // A tier of the lane ended in this daemon, so no restart note (row 011-209, rule C).
    const lanes = new Map([["vitest", ref("tests/backlog/b0.test.ts")]]);
    writeYieldRow(store, repo.mainId, NOW, { ...NO_YIELD_ROW, lanes });

    const { lines, groups } = named(store, repo.mainId, repo.main, FAST);

    expect(lines).toEqual([
      "Pending (3):",
      `  3 in the vitest tier of 27 test files running since ${SINCE}: ${FAST.join(", ")}; no command runs them sooner (a running tier is not interrupted)`,
    ]);
    expect(groups).toBe(`3 in the vitest tier of 27 test files running since ${SINCE}`);
  });

  it("gh-40 B: queued behind a running 4-file tier and one slow file, each group with its step", () => {
    const { repo, store } = repoWith([...FAST, SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    const tier = ["tests/t1.test.ts", "tests/t2.test.ts", "tests/t3.test.ts", "tests/t4.test.ts"];
    for (const path of tier) running(store, repo.mainId, path);
    openRun(store, repo.mainId, "run-tier", tier);

    const { lines, groups } = named(store, repo.mainId, repo.main, [...FAST, SLOW_FILE]);

    expect(lines).toEqual([
      "Pending (4):",
      `  3 queued behind the vitest tier of 4 test files running since ${SINCE}: ${FAST.join(", ")}; no command runs them sooner (a running tier is not interrupted)`,
      `  1 slow, run after the fast tests or on \`squeal run --slow\`: ${SLOW_FILE}`,
    ]);
    expect(groups).toBe(
      `3 queued behind the vitest tier of 4 test files running since ${SINCE}, 1 slow: \`squeal run --slow\``,
    );
  });

  it("gh-41: queued with no open run, claim, slow turn or unlisted revision says nothing recorded holds it", () => {
    const { repo, store } = repoWith([B]);

    const { lines, groups, entries } = named(store, repo.mainId, repo.main, [B]);

    expect(lines).toEqual([
      "Pending (1):",
      `  1 queued; no run is open and nothing recorded holds it: ${B}; the store records no reason the daemon has not taken it (\`squeal status --json\` lists each file's state)`,
    ]);
    expect(groups).toBe("1 queued, nothing recorded holds it");
    expect(entries[0]).not.toHaveProperty("command");
  });

  it("gh-46: a running slow file whose project's global setup the store knows names its one-file retry", () => {
    const { repo, store } = repoWith([]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    running(store, repo.mainId, SLOW_FILE);
    openRun(store, repo.mainId, "run-slow", [SLOW_FILE]);
    // A setup check exists once a run of the project failed to start here; it passes since.
    store.knownStates.upsertMany([
      state(repo.mainId, { kind: "setup", project: "", testPath: "e2e/environment.ts" as never }),
    ]);

    const { lines, entries } = named(store, repo.mainId, repo.main, [SLOW_FILE]);

    expect(lines).toEqual([
      "Pending (1):",
      `  1 running since ${SINCE} in the slow vitest lane; its project's global setup (e2e/environment.ts) ran once when this slow pass started, and Squeal does not hold what it started, so another run of that project meanwhile may replace it: ${SLOW_FILE}; after an environment failure, \`squeal retry ${SLOW_FILE} --reason environment\` runs this one file again`,
    ]);
    expect(entries[0]?.command).toBe(`squeal retry ${SLOW_FILE} --reason environment`);
  });

  it("gh-46: without a setup the store knows of, the clause is left out and the retry stays", () => {
    const { repo, store } = repoWith([]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    running(store, repo.mainId, SLOW_FILE);
    openRun(store, repo.mainId, "run-slow", [SLOW_FILE]);

    expect(named(store, repo.mainId, repo.main, [SLOW_FILE]).lines[1]).toBe(
      `  1 running since ${SINCE} in the slow vitest lane: ${SLOW_FILE}; after an environment failure, \`squeal retry ${SLOW_FILE} --reason environment\` runs this one file again`,
    );
  });
});
