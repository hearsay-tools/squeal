import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { blobHash } from "../../src/core/hash/blob.js";
import { refusedCpu } from "../../src/core/lint/pass/cpu-wait.js";
import { lintScope, writeCursor, writeQuiet } from "../../src/core/lint/pass/records.js";
import type { LintStore } from "../../src/core/lint/store/types.js";
import type { EpochMs, RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import type { LintKnownState, LintOutcome } from "../../src/core/types/lint.js";
import { check as lintCheck, open } from "../lint/helpers.js";
import { B, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 017-37 and review 0.1.666 B1: a worktree at revision 4 whose test
 * file B is current, with lint on and its lint store seeded, for the named
 * wait's lint read.
 */

export const BACKLOG = ["src/x1.ts", "src/x2.ts"] as RelativePath[];
/** B's bytes as the fixture writes them. */
export const B_TEXT = "export const a = 1;\n";

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = (): DaemonSync => ({ current: synced, stop: () => {} });

export const wait = (root: string, paths: readonly string[], timeoutMs: number) =>
  waitForNamed(root as never, paths, {
    timeoutMs,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW as EpochMs,
    sync,
    ask: async () => [],
  });

/** A check's state; a `pass` or `fail` judged at `text`'s bytes at revision `judgedAt`. */
export function stateOf(
  id: string,
  path: string,
  outcome: LintOutcome,
  text = B_TEXT,
  judgedAt = 3,
): LintKnownState {
  const judged =
    outcome === "pass" || outcome === "fail"
      ? {
          key: `key-${outcome}` as never,
          outcome,
          fingerprint: null,
          blob: blobHash(Buffer.from(text), "sha1"),
          revision: judgedAt as RevisionNumber,
        }
      : null;
  return {
    worktreeId: id as never,
    check: lintCheck(path),
    outcome,
    judged,
    stale: false,
    reason: null,
    changedAt: 1 as RevisionNumber,
  };
}

/** Writes `text` at `path` in `root`. */
export function writeAt(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** The ESLint pass's cursor at `revision`. */
export function keyedAt(lint: LintStore, id: string, revision: number, environment = "env"): void {
  const cursor = { revision: revision as RevisionNumber, environment };
  writeCursor(lint.meta, lintScope(id as never, "eslint"), cursor);
}

/**
 * B's tests current; lint on and keyed at revision 4, B at `named`, two
 * other files pending in a config keying's backlog that the pool refuses
 * for its share.
 */
export function lintedRepo(named: LintOutcome = "pending") {
  const { repo } = repoWith([], [B]);
  writeFileSync(join(repo.main, "squeal.config.json"), '{ "lint": { "enabled": true } }\n');
  writeAt(repo.main, B, B_TEXT);
  const lint = open(repo.commonDir);
  const id = repo.mainId;
  lint.states.upsertMany([stateOf(id, B, named), ...BACKLOG.map((p) => stateOf(id, p, "pending"))]);
  const scope = lintScope(id, "eslint");
  keyedAt(lint, id, 4);
  writeQuiet(lint.meta, scope, new Set(BACKLOG));
  refusedCpu(lint.meta, scope, { busy: 3, limit: 18, refusal: "share" }, NOW as EpochMs);
  return { repo, lint };
}

export const outcomes = (lint: LintStore, id: string) =>
  Object.fromEntries(lint.states.list(id as never).map((s) => [s.check.path, s.outcome]));
