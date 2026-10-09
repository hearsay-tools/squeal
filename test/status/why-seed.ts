import { join } from "node:path";
import type { Store, WhyReport, WhyResult } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { appendRevisions, check, type FakeRepo, state } from "./helpers.js";

export const COMMIT = "abc1234def5678abc1234def5678abc1234def56";
export const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 4, hour, minute);
export const LOGIN = check("src/auth.test.ts", "auth > login");

export function reportOf(why: WhyResult): WhyReport {
  if (!why.available || !why.found) throw new Error(`no report: ${JSON.stringify(why)}`);
  return why;
}

/**
 * `auth > login` failed in worktree `b` (own result, run `run-b1`), then the
 * main worktree passed it under the key `b` now has, and `b` inherited that
 * pass.
 */
export function seedLogin(repo: FakeRepo, store: Store) {
  const b = repo.addWorktree("b");
  for (const [id, root, isMain] of [
    [repo.mainId, repo.main, true],
    [b.id, b.root, false],
  ] as const) {
    store.worktrees.upsert({
      id,
      root,
      commonDir: repo.commonDir,
      isMain,
      registeredAt: 1,
      daemon: null,
    });
  }
  appendRevisions(store, b.id, 2, { head: COMMIT, dirty: true });
  const runsDir = join(repo.commonDir, "squeal", "runs");
  for (const [id, worktreeId, revision] of [
    ["run-b1", b.id, 1],
    ["run-a1", repo.mainId, 3],
  ] as const) {
    store.runs.start({
      id,
      worktreeId,
      revision,
      testFiles: [{ project: "", path: "src/auth.test.ts" }],
      checkpointId: null,
      logDir: join(runsDir, id),
      startedAt: 1,
    });
  }
  const own = result(LOGIN, "k0", {
    outcome: "fail",
    worktreeId: b.id,
    recordedAt: at(9, 30),
    runId: "run-b1",
    errors: [
      {
        name: "AssertionError",
        message: "expected 200, received 500",
        stack: "AssertionError: expected 200, received 500\n    at src/auth.test.ts:9:5",
        location: { path: "src/auth.test.ts", line: 9, column: 5 },
        diff: null,
      },
    ],
  });
  const source = result(LOGIN, "k1", {
    worktreeId: repo.mainId,
    recordedAt: at(10, 30),
    runId: "run-a1",
  });
  store.results.putMany([
    { ...own, provenance: { ...own.provenance, revision: 1 } },
    { ...source, provenance: { ...source.provenance, revision: 3, commit: COMMIT, dirty: false } },
  ]);
  store.knownStates.upsertMany([
    state(b.id, LOGIN, {
      observedAt: 2,
      commit: COMMIT,
      origin: { kind: "inherited", worktreeId: repo.mainId, commit: COMMIT },
    }),
    state(b.id, check("src/auth.test.ts", "auth > logout")),
    state(b.id, check("src/auth.test.ts", "auth > login twice")),
  ]);
  store.transitions.append([
    {
      worktreeId: b.id,
      check: LOGIN,
      kind: "first-seen-fail",
      from: null,
      to: "fail",
      fromFingerprint: null,
      toFingerprint: "AssertionError: expected 200, received 500 @ src/auth.test.ts:9:5",
      revision: 1,
      at: at(9, 30),
    },
    {
      worktreeId: b.id,
      check: LOGIN,
      kind: "fail-to-pass",
      from: "fail",
      to: "pass",
      fromFingerprint: "AssertionError: expected 200, received 500 @ src/auth.test.ts:9:5",
      toFingerprint: null,
      revision: 2,
      at: at(11),
    },
  ]);
  return b;
}
