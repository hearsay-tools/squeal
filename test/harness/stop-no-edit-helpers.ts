import { onTestFinished } from "vitest";
import { isLintStoreOpenFailure, openLintStore } from "../../src/core/lint/store/open.js";
import { git } from "../hash/git-repo.js";
import { type SquealRepo, squealRepo } from "./helpers.js";
import { commit, gitRepo } from "./stopped-repo.js";

/*
 * Row 011-312: the fixture of the no-edit and stopped-daemon Stop tests: a
 * real Git checkout, so Git can prove a session changed nothing, with a
 * lint group at `stop` and an ESLint check no one edited waiting to lint.
 */

/** A lint group at `stop`; the waiting entry's bound is short. */
export const LINT_AT_STOP = {
  lint: { enabled: true },
  checks: [{ name: "lint", lint: true, at: "stop" }],
  stop: { slowWaitMs: 400 },
};

/**
 * A `squealRepo` over a Git checkout with `policy` committed, so Git is
 * clean; removed after the test.
 */
export function committedRepo(policy: object = LINT_AT_STOP): SquealRepo {
  const cleanups: (() => void)[] = [];
  onTestFinished(() => {
    for (const cleanup of cleanups) cleanup();
  });
  const r = squealRepo(gitRepo(cleanups));
  r.policy(policy);
  git(r.root, ["add", "squeal.config.json"]);
  commit(r.root, "policy");
  return r;
}

/** `path`'s ESLint check waits to lint, as a baseline leaves a file no one edited. */
export function pendingLint(r: SquealRepo, path = "untouched.js"): void {
  const lint = openLintStore(r.repo.commonDir, { lint: { ...LINT_AT_STOP.lint } } as never);
  if (isLintStoreOpenFailure(lint)) throw new Error(`lint store: ${lint.reason}`);
  try {
    lint.states.upsertMany([
      {
        worktreeId: r.worktreeId,
        check: { kind: "lint", path, tool: "eslint" },
        outcome: "pending",
        judged: null,
        stale: false,
        reason: null,
        changedAt: 0,
      },
    ]);
  } finally {
    lint.close();
  }
}

/** Git's status of the checkout: `""` when clean. */
export const status = (r: SquealRepo): string => git(r.root, ["status", "--porcelain"]);
