import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, waitLine } from "../../src/cli/status-wait-lines.js";
import { refinedMetaKey } from "../../src/core/types/index.js";
import {
  A,
  ADDS,
  answering,
  B,
  BACKLOG,
  C,
  fail,
  finish,
  later,
  options,
  repoWith,
  SLOW_FILE,
  timed,
} from "./status-wait-fixture.js";

/*
 * Lessons, defect 32, decided by the human (2026-10-09, task 001-186): a
 * wait ends when the test files its window's edits re-keyed have their
 * results, while a backlog or a slow file still runs; only their checks'
 * transitions end it early. The store's re-key moves name the files
 * (`answerMoves`, task 001-258).
 */

describe("status --wait holds for the edit's own test files (lessons, defect 32)", () => {
  it("returns quiet once the edited file's result is in, while a backlog runs", async () => {
    const { repo, store } = repoWith([A, B, C]);
    const finished = later(300, () => finish(store, repo.mainId, A));

    const daemon = answering(store, repo.mainId, [A]);
    const { wait, endedBy } = await timed(() => waitForStatus(repo.main, options(daemon.sync)));

    expect(wait.outcome).toBe("quiet");
    expect(endedBy).toBeGreaterThanOrEqual(finished.at);
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait).toMatchObject({
      transitions: 0,
      edit: { since: 4, testFiles: 1, pending: 0, otherTransitions: 0 },
    });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on quiet: the 1 test file the edits since revision 4 re-keyed is not pending, at revision 4 after \d+\.\d s; this wait does not hold for the rest of the worktree\. Worktree: known failures 0; not current: 2 of 3 test files \(2 queued\), 2 tests \(2 queued\)$/,
    );
  });

  it("does not end on a backlog file's news, and reports it", async () => {
    const { repo, store } = repoWith([A, B]);
    later(100, () => fail(store, repo.mainId, BACKLOG));
    const finished = later(500, () => finish(store, repo.mainId, A));

    const daemon = answering(store, repo.mainId, [A]);
    const { wait, endedBy } = await timed(() => waitForStatus(repo.main, options(daemon.sync)));

    expect(wait.outcome).toBe("quiet");
    expect(endedBy).toBeGreaterThanOrEqual(finished.at);
    expect(wait).toMatchObject({ edit: { otherTransitions: 1 } });
    expect(waitLine(wait as EndedWait)).toMatch(/; 1 transition of other checks\. Worktree: /);
  });

  it("ends on news of the edit's own checks", async () => {
    const { repo, store } = repoWith([A, B]);
    later(200, () => fail(store, repo.mainId, ADDS));

    const wait = await waitForStatus(repo.main, options(answering(store, repo.mainId, [A]).sync));

    expect(wait.outcome).toBe("news");
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait).toMatchObject({ transitions: 1, edit: { pending: 1 } });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on news: 1 transition in the 1 test file the edits since revision 4 re-keyed, at revision 4 after \d+\.\d s\. Worktree: /,
    );
  });

  it("does not hold for a slow file the edit re-keyed (spec 004 D9, as Stop)", async () => {
    const { repo, store } = repoWith([A, SLOW_FILE]);
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE] } }),
    );
    later(200, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(
      repo.main,
      options(answering(store, repo.mainId, [A, SLOW_FILE]).sync),
    );

    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { testFiles: 2, pending: 0 } });
  });

  it("holds for every file an environment edit re-keyed, and its timeout counts them", async () => {
    const { repo, store } = repoWith([A, B, C]);
    later(100, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(
      repo.main,
      options(answering(store, repo.mainId, [A, B, C]).sync, 800),
    );

    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ edit: { testFiles: 3, pending: 2 } });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on timeout after 0\.\d s: 2 of the 3 test files the edits since revision 4 re-keyed pending at revision 4\. Worktree: /,
    );
  });

  it("is not quiet before the window's runner part is applied", async () => {
    const { repo, store } = repoWith([], [A]);
    store.meta.set(refinedMetaKey(repo.mainId), "3");
    const applied = later(300, () => store.meta.set(refinedMetaKey(repo.mainId), "4"));

    const daemon = answering(store, repo.mainId, [A]);
    const { wait, endedBy } = await timed(() => waitForStatus(repo.main, options(daemon.sync)));

    expect(wait.outcome).toBe("quiet");
    expect(endedBy).toBeGreaterThanOrEqual(applied.at);
  });

  it("counts no check's news before the daemon named the files", async () => {
    const { repo, store } = repoWith([A, B]);
    later(100, () => fail(store, repo.mainId, BACKLOG));

    const pending = answering(store, repo.mainId, null, { state: "pending" });
    const wait = await waitForStatus(repo.main, options(pending.sync, 600));

    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  it("counts any check's news from a daemon that names no files", async () => {
    const { repo, store } = repoWith([A, B]);
    later(100, () => fail(store, repo.mainId, BACKLOG));

    const wait = await waitForStatus(repo.main, options(answering(store, repo.mainId, null).sync));

    expect(wait.outcome).toBe("news");
    expect(wait).not.toHaveProperty("edit");
  });
});
