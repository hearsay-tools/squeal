import { execFileSync } from "node:child_process";
import { recordFailureKeys } from "../../src/core/slow/state.js";
import { checkIdentity, recordFailureProducers } from "../../src/core/state/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { result } from "../store/helpers.js";

/*
 * Row 011-67 (gh-52): a known failure of `path` in a worktree's store, as
 * status, registration and `why` read it, and the arguments a POSIX shell
 * passes for the load retry command a surface prints (review 0.1.271 S1).
 */

export const NOW = Date.UTC(2026, 9, 23, 12, 0);

/** Paths a shell would split or rewrite unless the command quotes them. */
export const AWKWARD_PATHS = ["src/with space.test.ts", "src/it's.test.ts"] as const;

/** `auth > login` in `path`, failing (or passing) at revision 4, its producer stored as `run-1`. */
export function seededFailure(outcome: "fail" | "pass" = "fail", path = "src/auth.test.ts") {
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
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  const failing = check(path, "auth > login");
  const testFile = { project: "", path };
  store.testFileKeys.upsertMany([
    { worktreeId: repo.mainId, testFile, key: "k1", revision: 4, pending: null },
  ]);
  const produced = result(failing, "k1", {
    outcome,
    worktreeId: repo.mainId,
    runId: "run-1",
    recordedAt: NOW - 20_000,
  });
  store.results.putMany([produced]);
  recordFailureKeys(store, repo.mainId, new Map([[checkIdentity(failing), "k1"]]));
  recordFailureProducers(store, repo.mainId, [produced]);
  store.knownStates.upsertMany([
    state(repo.mainId, failing, {
      outcome,
      observedAt: 4,
      ...(outcome === "fail"
        ? {
            commit: "abc123",
            summary: "expected 1 to be 2",
            fingerprint: "AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
          }
        : {}),
    }),
  ]);
  return { repo, store, testFile, name: `${path} > auth > login` };
}

/** The arguments `sh` passes to `squeal` for the load retry command in `text`. */
export function loadRetryArgs(text: string): string[] {
  const command = /`(squeal retry .* --reason load)`/.exec(text)?.[1];
  if (command === undefined) throw new Error(`no load retry command in: ${text}`);
  const out = execFileSync("sh", ["-c", `squeal() { printf '%s\\n' "$@"; }; ${command}`], {
    encoding: "utf8",
  });
  return out.split("\n").slice(0, -1);
}
