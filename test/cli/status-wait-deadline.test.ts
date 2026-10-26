import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import {
  type NamedWaitOptions,
  namedCode,
  namedWaitCommand,
  waitForNamed,
} from "../../src/cli/status-wait-paths.js";
import type { CheckKey, RevisionNumber, Store } from "../../src/core/types/index.js";
import { appendRevisions, check, state } from "../status/helpers.js";
import { A, ADDS, fail, later, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Review wave-1, B1. Spec 005 D2: "The wait returns when every selected file
 * has a result for its current key at the current revision, or at the
 * deadline." A deadline is no verdict: a wait whose daemon has not yet
 * stored the revision holding the edits made before it exits 3, however
 * current the old result looks; one that was ready at its last read still
 * gives that read's verdict.
 */

const PENDING: SyncState = { state: "pending" };
const synced = (revision: number): SyncState => ({
  state: "synced",
  revision: revision as RevisionNumber,
  incarnation: null,
});

function options(sync: () => SyncState, timeoutMs: number, settleMs = 0): NamedWaitOptions {
  const stub = (): DaemonSync => ({ current: sync, stop: () => {} });
  return { timeoutMs, pollMs: 5, settleMs, now: () => NOW, sync: stub };
}

async function command(root: string, opts: NamedWaitOptions) {
  let stdout = "";
  const io: CliIo = { stdout: (t) => (stdout += t), stderr: () => {}, cwd: root, env: {} };
  const code = await namedWaitCommand([A], { json: false }, io, opts);
  // Issue 26: the verdict is the last line.
  return { code, last: stdout.trimEnd().split("\n").at(-1) ?? "" };
}

/** A at revision 4 with a current pass, then edited on disk, not yet reconciled. */
function edited() {
  const { repo, store } = repoWith([], [A]);
  const path = join(repo.main, A);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'throw new Error("edited, not reconciled");\n');
  return { repo, store };
}

/** The daemon's pass over the edit: revision 5, with A re-keyed and queued. */
function rekeyed(store: Store, worktreeId: string) {
  appendRevisions(store, worktreeId, 1, { head: null, dirty: true });
  store.testFileKeys.upsertMany([
    {
      worktreeId,
      testFile: ref(A),
      key: "key-edited" as CheckKey,
      revision: 5 as RevisionNumber,
      pending: "queued",
    },
  ]);
  store.knownStates.upsertMany(
    [ADDS, check(A, "holds")].map((c) =>
      state(worktreeId, c, { validity: "pending", pendingPhase: "queued", observedAt: 3 }),
    ),
  );
}

describe("a named wait's deadline before its sync reached the current revision", () => {
  it("exits 3 while the daemon's pass is still pending, not 0 on the old result", async () => {
    const { repo } = edited();
    const result = await command(
      repo.main,
      options(() => PENDING, 30),
    );
    expect(result.code).toBe(3);
    expect(result.last).toMatch(
      /^Named test files have no verdict: the deadline passed after \d+\.\d s: 1 test file passed at revision 4; the daemon has not stored its pass over the edits made before the wait, so this result may not cover them\. Worktree: .*\. A later pass is not reported\. A failure arrives with a later tool call\. For the verdict, wait again: `squeal status --wait 30 src\/a\.test\.ts`$/,
    );
  });

  it("exits 3 when the pass names a revision the store has not reached", async () => {
    const { repo } = edited();
    const result = await command(
      repo.main,
      options(() => synced(5), 30),
    );
    expect(result.code).toBe(3);
    expect(result.last).toMatch(
      /^Named test files have no verdict: the deadline passed after \d+\.\d s: 1 test file passed at revision 4; the daemon's pass is at revision 5, so this result may not cover it\. Worktree: /,
    );
  });

  it("exits 3 when the pass re-keyed the edited file and its result has not landed", async () => {
    const { repo, store } = edited();
    let current: SyncState = PENDING;
    later(30, () => {
      rekeyed(store, repo.mainId);
      current = synced(5);
    });
    const wait = await waitForNamed(
      repo.main,
      [A],
      options(() => current, 300),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect([wait.outcome, namedCode(wait), wait.verdict.revision]).toEqual(["timeout", 3, 5]);
  });

  it("gives the edited file's verdict once its result at the pass's revision lands", async () => {
    const { repo, store } = edited();
    let current: SyncState = PENDING;
    later(30, () => {
      rekeyed(store, repo.mainId);
      current = synced(5);
    });
    later(120, () => {
      store.testFileKeys.upsertMany([
        {
          worktreeId: repo.mainId,
          testFile: ref(A),
          key: "key-edited" as CheckKey,
          revision: 5 as RevisionNumber,
          pending: null,
        },
      ]);
      store.knownStates.upsertMany([
        state(repo.mainId, check(A, "holds"), { observedAt: 5 }),
        state(repo.mainId, ADDS, { outcome: "fail", observedAt: 5, fingerprint: "Error: x" }),
      ]);
    });
    const wait = await waitForNamed(
      repo.main,
      [A],
      options(() => current, 3_000),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect([wait.outcome, namedCode(wait), wait.verdict.revision]).toEqual(["settled", 1, 5]);
  });
});

describe("a named wait ready only at its final read", () => {
  it("gives a current pass, 0, and a current failure, 1", async () => {
    const pass = repoWith([], [A]);
    const deadline = performance.now() + 60;
    const late = () => (performance.now() >= deadline ? synced(4) : PENDING);
    const passed = await command(pass.repo.main, options(late, 60));
    expect(passed.code).toBe(0);
    expect(passed.last).toMatch(/^Named test files at revision 4: no known failures; 1 test file/);

    const failing = repoWith([], [A]);
    fail(failing.store, failing.repo.mainId, ADDS);
    const until = performance.now() + 60;
    const failed = await command(
      failing.repo.main,
      options(() => (performance.now() >= until ? synced(4) : PENDING), 60),
    );
    expect(failed.code).toBe(1);
  });

  it("keeps the settle-time fallback of a daemon that cannot sync: the deadline read decides", async () => {
    const { repo } = repoWith([], [A]);
    const wait = await waitForNamed(
      repo.main,
      [A],
      options(() => ({ state: "unsupported" }), 60, 10_000),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect([wait.outcome, namedCode(wait)]).toEqual(["settled", 0]);
  });
});
