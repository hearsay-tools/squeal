import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, namedLine, namedText, waitLine } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { CODEX } from "../harness/primer-helpers.js";
import {
  A,
  answering,
  finish,
  key,
  later,
  NOW,
  options,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";

/*
 * Row 019-24 item 2 (spec 019 D6; 019-23 notes, "Found, not fixed"): the
 * `status --wait` verdict lines name a configured group's files that are
 * not current by the group and its run command, as status's group line
 * does, never as slow files. Without a `checks` key the lines are as
 * before (`status-wait-slow-policy`, `status-wait-paths-slow`).
 */

const SECOND = "test/slow-two.test.ts";

/** A configured group `name` at `at` owning `tests`; `slow.trigger` as given. */
function policy(root: string, groups: readonly object[], trigger = "continuous") {
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({ slow: { include: [SLOW_FILE], trigger }, checks: groups }),
  );
}

const E2E = { name: "e2e", runner: "vitest", tests: [SLOW_FILE, SECOND], at: "stop" };

/** `A` re-keyed by the edit and finished; the group's two files, the first queued, the other not run. */
async function quiet(groups: readonly object[]): Promise<EndedWait> {
  const { repo, store } = repoWith([A]);
  key(store, repo.mainId, SLOW_FILE, "queued");
  key(store, repo.mainId, SECOND, null);
  policy(repo.main, groups);
  later(200, () => finish(store, repo.mainId, A));
  const wait = await waitForStatus(repo.main, options(answering(store, repo.mainId, [A]).sync));
  expect(wait.outcome).toBe("quiet");
  return wait as EndedWait;
}

describe("a quiet status --wait names a configured group's files by the group (019-24)", () => {
  it("a group Stop waits for: which this wait does not hold for, and its run command", async () => {
    const wait = await quiet([E2E]);
    const clause =
      "; 2 e2e test files are not current and Squeal runs the pending ones when the agent pauses, which this wait does not hold for: `squeal run e2e --wait 60000` runs them now and waits for their results. Worktree: ";
    expect(waitLine(wait)).toContain(clause);
    expect(waitLine(wait)).not.toContain("slow");
    // Codex names the CLI by its path.
    expect(waitLine(wait, CODEX)).toContain(clause.replace("`squeal run", `\`${CODEX} run`));
  });

  it("a group Stop does not wait for: not required before the agent finishes", async () => {
    const wait = await quiet([{ ...E2E, at: "commit" }]);
    expect(waitLine(wait)).toContain(
      "; 2 e2e test files are not current and Squeal runs the pending ones at each commit; this repository does not require them before you finish; `squeal run e2e --wait 60000` runs them now and waits for their results. Worktree: ",
    );
  });

  it("names no group whose files are all current", async () => {
    const { repo, store } = repoWith([A], [SLOW_FILE]);
    policy(repo.main, [{ ...E2E, tests: [SLOW_FILE] }]);
    later(200, () => finish(store, repo.mainId, A));
    const wait = await waitForStatus(repo.main, options(answering(store, repo.mainId, [A]).sync));
    expect(wait.outcome).toBe("quiet");
    expect(waitLine(wait as EndedWait)).not.toContain("e2e");
  });
});

const synced = () => ({
  state: "synced" as const,
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/** A named wait over `paths`, `A` (when named) passing after 100 ms, the group's file queued, never run. */
async function named(paths: readonly string[], groups: readonly object[], command?: string) {
  const fast = paths.includes(A);
  const { repo, store } = repoWith(fast ? [A, SLOW_FILE] : [SLOW_FILE]);
  policy(repo.main, groups, "idle");
  if (fast) later(100, () => finish(store, repo.mainId, A));
  const wait = await waitForNamed(repo.main, paths, {
    timeoutMs: 5_000,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: () => ({ current: synced, stop: () => {} }),
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return { wait, last: namedText(wait, NOW, command).trimEnd().split("\n").at(-1) ?? "" };
}

describe("a named status --wait names a group's files left for a pause by the group (019-24)", () => {
  const E2E_ONE = { ...E2E, tests: [SLOW_FILE] };

  it("a group Stop waits for: required, and its run command", async () => {
    const { wait, last } = await named([A, SLOW_FILE], [E2E_ONE]);
    expect(wait.outcome).toBe("settled");
    expect(wait.leftForPause?.map((f) => f.path)).toEqual([SLOW_FILE]);
    const clause =
      "; 1 e2e test file waits for a pause or `squeal run e2e`, which this wait does not hold for: test/slow.test.ts; this repository requires it before you finish: `squeal run e2e --wait 60000` runs and waits for it. Worktree: ";
    expect(last).toContain(clause);
    expect(last).not.toContain("slow test file");
    expect((await named([A, SLOW_FILE], [E2E_ONE], CODEX)).last).toContain(
      clause
        .replace("`squeal run e2e`", `\`${CODEX} run e2e\``)
        .replace("`squeal run e2e --wait", `\`${CODEX} run e2e --wait`),
    );
  });

  it("a group at pause: not required, and the wait for its result", async () => {
    const { last } = await named([A, SLOW_FILE], [{ ...E2E_ONE, at: "pause" }]);
    expect(last).toContain(
      "; 1 e2e test file waits for a pause or `squeal run e2e`, which this wait does not hold for: test/slow.test.ts; this repository does not require it before you finish; `squeal run e2e --wait 60000` waits for its result. Worktree: ",
    );
  });

  it("names the group in `status <path>` too, the snapshot form", async () => {
    const { repo, store } = repoWith([SLOW_FILE], [A]);
    policy(repo.main, [E2E_ONE], "idle");
    const read = await readNamedSnapshot(repo.main, [A, SLOW_FILE], {
      now: () => NOW,
      sync: () => ({ current: synced, stop: () => {} }),
    });
    store.close();
    if (read.outcome === "unavailable") throw new Error("unavailable");
    expect(namedLine(read)).toContain(
      "; 1 e2e test file waits for a pause or `squeal run e2e`, which this wait does not hold for: test/slow.test.ts; this repository requires it before you finish: ",
    );
  });

  it("names the group as the reason for no verdict when it is all the wait selected", async () => {
    const { wait, last } = await named([SLOW_FILE], [E2E_ONE]);
    expect(wait.outcome).toBe("slow");
    expect(last).toMatch(
      /^Named test files have no verdict: every selected test file waits for its group's moment: 1 e2e test file waits for a pause or `squeal run e2e`, which this wait/,
    );
  });
});
