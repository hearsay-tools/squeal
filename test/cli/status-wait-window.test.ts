import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { tellRevision } from "../../src/core/delivery/liveness.js";
import { MAIN_AGENT, type RevisionNumber, type Store } from "../../src/core/types/index.js";
import {
  A,
  ADDS,
  answering,
  B,
  C,
  fail,
  finish,
  later,
  NOW,
  options,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";

/*
 * Lessons, defect 32 (tasks 001-186, 001-191): the wait's window is every
 * revision after the one its session was last told about, and every revision
 * up to it whose re-keyed files had no result since when the wait started.
 */

const D = "src/d.test.ts";

function told(store: Store, worktreeId: string, revision: number, agentId = MAIN_AGENT) {
  const consumer = { worktreeId, sessionId: "s1", agentId };
  store.consumers.register(consumer, NOW);
  tellRevision(store, consumer, revision as RevisionNumber);
}

describe("the wait's window starts where the session was last told (task 001-186)", () => {
  it("asks for every revision's files and starts after the oldest one its consumers were told about", async () => {
    const { repo, store } = repoWith([], [A]);
    told(store, repo.mainId, 3);
    told(store, repo.mainId, 2, "subagent");
    const other = { worktreeId: repo.mainId, sessionId: "s2", agentId: MAIN_AGENT };
    store.consumers.register(other, NOW);
    tellRevision(store, other, 1 as RevisionNumber);

    const mine = answering([A]);
    const wait = await waitForStatus(repo.main, { ...options(mine.sync), session: "s1" });
    const unknown = answering([A]);
    const fresh = await waitForStatus(repo.main, { ...options(unknown.sync), session: "nobody" });

    expect(mine.asked).toEqual([0]);
    expect(wait).toMatchObject({ edit: { since: 3, testFiles: 1 } });
    // No consumer of the session: the revision current when the wait started, whose file had its result.
    expect(unknown.asked).toEqual([0]);
    expect(fresh).toMatchObject({ edit: { since: 4, testFiles: 0 } });
  });

  // The hook after the edit already told revision 4, the edit's, before its result.
  it("counts the revision last heard of while its files have no result", async () => {
    const { repo, store } = repoWith([A, B]);
    told(store, repo.mainId, 4);
    later(300, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, { ...options(answering([A]).sync), session: "s1" });

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(300);
    expect(wait).toMatchObject({ edit: { since: 4, testFiles: 1 } });
  });
});

describe("the wait keeps an earlier edit the session was told about (task 001-191)", () => {
  // Edit A at revision 3, told by the hook after it; edit B at 4 in a later tool call.
  it("holds until both the told edit's files and the later edit's are done", async () => {
    const { repo, store } = repoWith([A, B, C], [], { [A]: 2 });
    told(store, repo.mainId, 3);
    later(100, () => finish(store, repo.mainId, B));
    later(500, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, {
      ...options(answering([[A, 3], B]).sync),
      session: "s1",
    });

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(500);
    expect(wait).toMatchObject({ edit: { since: 3, testFiles: 2, pending: 0 } });
  });

  it("keeps a revision before the one last told whose files have no result", async () => {
    const { repo, store } = repoWith([A, B], [], { [A]: 1 });
    told(store, repo.mainId, 3);
    later(300, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, {
      ...options(answering([[A, 2], B]).sync, 800),
      session: "s1",
    });

    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ edit: { since: 2, testFiles: 2, pending: 1 } });
  });

  // The slow file, edited before the told revision, still runs: the wait would not hold for it.
  it("does not keep a told revision for a slow file", async () => {
    const { repo, store } = repoWith([SLOW_FILE, B], [], { [SLOW_FILE]: 1 });
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE] } }),
    );
    told(store, repo.mainId, 3);
    later(200, () => finish(store, repo.mainId, B));

    const daemon = answering([[SLOW_FILE, 2], B]);
    const wait = await waitForStatus(repo.main, { ...options(daemon.sync), session: "s1" });

    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { since: 4, testFiles: 1 } });
  });

  // C had its result after its re-key and runs again (`run --all`); D went back to a key with a result.
  it("does not hold for a told revision whose files had their results", async () => {
    const { repo, store } = repoWith([B, C], [A, D], { [D]: 1 });
    told(store, repo.mainId, 3);
    later(200, () => finish(store, repo.mainId, B));

    const daemon = answering([[A, 3], [C, 3], [D, 3], B]);
    const wait = await waitForStatus(repo.main, { ...options(daemon.sync), session: "s1" });

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait).toMatchObject({ edit: { since: 4, testFiles: 1 } });
  });

  // The told edit's result lands before the daemon named the files: still the edit's news.
  it("counts a told edit's result that landed while the daemon answered as its own news", async () => {
    const { repo, store } = repoWith([A, B], [], { [A]: 2 });
    told(store, repo.mainId, 3);
    later(50, () => {
      finish(store, repo.mainId, A);
      fail(store, repo.mainId, ADDS);
    });

    const daemon = answering([[A, 3], B], undefined, 300);
    const wait = await waitForStatus(repo.main, { ...options(daemon.sync), session: "s1" });

    expect(wait.outcome).toBe("news");
    expect(wait).toMatchObject({ transitions: 1, edit: { since: 3, testFiles: 2 } });
  });
});
