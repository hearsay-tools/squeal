import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, waitLine } from "../../src/cli/status-wait-lines.js";
import type { CheckKey, RevisionNumber, Store } from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import {
  A,
  ADDS,
  answering,
  fail,
  finish,
  key,
  later,
  options,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";

/*
 * Review wave-13ak, B2 and S1 (task 001-287). `run --slow --wait` holds the
 * slow files pending at its first read by their own rows and checks: a
 * policy that stops calling one slow while it runs does not discharge it.
 * Their news is named as theirs, not as the edit window's.
 */

const config = (root: string, policy: unknown) =>
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(policy));

/** `sync`, and `fn` `ms` after the wait asked for it, which it does at its first read. */
function onFirstRead(sync: () => DaemonSync, ms: number, fn: () => void): () => DaemonSync {
  return () => {
    later(ms, fn);
    return sync();
  };
}

const PROJECT = "integration";
const NODE_TEST = {
  nodeTest: [{ name: PROJECT, include: ["test/**/*.test.ts"], slow: true }],
};

/** `SLOW_FILE` as a node:test project's file, running, with its one check pending. */
function nodeTestRunning(store: Store, worktreeId: string) {
  const testFile = { project: PROJECT, path: SLOW_FILE as never };
  store.testFileKeys.upsertMany([
    {
      worktreeId: worktreeId as never,
      testFile,
      key: "key-node" as CheckKey,
      revision: 4 as RevisionNumber,
      pending: "running",
    },
  ]);
  const holds = { kind: "test" as const, project: PROJECT, testPath: SLOW_FILE, fullName: "holds" };
  store.knownStates.upsertMany([
    state(worktreeId, holds as never, { validity: "pending", pendingPhase: "running" }),
  ]);
}

describe("a held slow file stays held whatever the policy says later (review wave-13ak, B2)", {
  timeout: 30_000,
}, () => {
  it("holds while the file runs after its glob leaves slow.include", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    key(store, repo.mainId, SLOW_FILE, "running");
    const sync = onFirstRead(answering(store, repo.mainId, []).sync, 100, () =>
      config(repo.main, {}),
    );

    const wait = await waitForStatus(repo.main, { ...options(sync, 1_500), holdSlow: true });

    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ slow: { held: 1, pending: [SLOW_FILE] } });
    expect(waitLine(wait as EndedWait)).toMatch(
      /; 1 of the 1 slow file run --slow queued pending: test\/slow\.test\.ts$/,
    );
  });

  it("holds while the file runs after its node:test project loses its slow flag", async () => {
    const { repo, store } = repoWith([]);
    config(repo.main, NODE_TEST);
    nodeTestRunning(store, repo.mainId);
    const sync = onFirstRead(answering(store, repo.mainId, []).sync, 100, () =>
      config(repo.main, { nodeTest: [{ ...NODE_TEST.nodeTest[0], slow: false }] }),
    );

    const wait = await waitForStatus(repo.main, { ...options(sync, 1_500), holdSlow: true });

    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ slow: { held: 1, pending: [SLOW_FILE] } });
  });

  it("returns quiet once the held file has its result, though the policy changed", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    const sync = onFirstRead(answering(store, repo.mainId, []).sync, 100, () =>
      config(repo.main, {}),
    );
    later(600, () => finish(store, repo.mainId, SLOW_FILE));

    const wait = await waitForStatus(repo.main, { ...options(sync, 10_000), holdSlow: true });

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(600);
    expect(wait).toMatchObject({ slow: { held: 1, pending: [] } });
  });
});

describe("slow news is the held files', not the edit window's (review wave-13ak, S1)", {
  timeout: 30_000,
}, () => {
  it("names a held file's transition with an empty edit window", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    const sync = onFirstRead(answering(store, repo.mainId, []).sync, 100, () => {
      finish(store, repo.mainId, SLOW_FILE);
      fail(store, repo.mainId, check(SLOW_FILE, "holds"));
    });

    const wait = await waitForStatus(repo.main, { ...options(sync), holdSlow: true });

    expect(wait).toMatchObject({ outcome: "news", transitions: 1, slow: { transitions: 1 } });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on news: 1 transition in the 1 slow file run --slow queued, at revision 4 after \d+\.\d s; the 1 slow file run --slow queued has its result$/,
    );
  });

  it("names the edit's and the held file's transitions apart", async () => {
    const { repo, store } = repoWith([A, SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });
    const sync = onFirstRead(answering(store, repo.mainId, [A]).sync, 100, () => {
      finish(store, repo.mainId, A);
      finish(store, repo.mainId, SLOW_FILE);
      fail(store, repo.mainId, ADDS);
      fail(store, repo.mainId, check(SLOW_FILE, "holds"));
    });

    const wait = await waitForStatus(repo.main, { ...options(sync), holdSlow: true });

    expect(wait).toMatchObject({
      outcome: "news",
      transitions: 2,
      edit: { testFiles: 1, otherTransitions: 0 },
      slow: { transitions: 1 },
    });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on news: 1 transition in the 1 test file the edits since revision 4 re-keyed and 1 in the 1 slow file run --slow queued, at revision 4 after \d+\.\d s; the 1 slow file run --slow queued has its result$/,
    );
  });
});
