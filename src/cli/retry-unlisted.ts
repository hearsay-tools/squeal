import { statSync } from "node:fs";
import { join, posix } from "node:path";
import { readPolicy } from "../core/daemon/policy.js";
import { vitestDetected } from "../core/daemon/runner.js";
import { createInputMatcher } from "../core/keys/glob.js";
import { readHeader } from "../core/state/index.js";
import { shellWord } from "../core/text.js";
import {
  type AbsolutePath,
  bootstrappedMetaKey,
  type Store,
  type TestFileKeyRecord,
  type WorktreeId,
} from "../core/types/index.js";

/** A path `retry` found no key for: `rel` from the root, `shown` as the reply names it, `given` as the command did. */
export interface NotKeyedPath {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly rel: string | null;
  readonly shown: string;
  readonly given: string;
}

/**
 * Why a path has no keyed test file, and whether that is because no listed
 * revision holds it yet. A failed global setup (001-382) has no key: the
 * next run of its project clears it, which an edit or `run --all` starts.
 * Row 011-134 (gh-76, 011 C5): a missing path and a file that may be a test
 * file in a revision the daemon has not listed yet each get their own line;
 * the printed wait names the path as given, so it resolves from the same
 * directory.
 */
export function notKeyed(
  store: Store,
  { root, worktreeId, rel, shown, given }: NotKeyedPath,
  keys: readonly TestFileKeyRecord[],
): { readonly text: string; readonly unlisted?: true } {
  const setup = store.knownStates
    .list(worktreeId)
    .some((s) => s.check.kind === "setup" && s.outcome === "fail" && s.check.testPath === rel);
  if (setup) {
    return {
      text: `Not retried: ${shown} is a global setup, which has no inputs to retry at; its FAIL clears when a run of its project starts, as the next edit or squeal run --all does.`,
    };
  }
  const why = rel === null ? null : unkeyedPath(store, worktreeId, root, rel, keys);
  if (why?.kind === "missing") {
    return { text: `Not retried: ${shown} does not exist in this worktree.` };
  }
  if (why?.kind === "unlisted") {
    return {
      unlisted: true,
      text:
        `Not listed yet: ${shown} has no key because ${why.clause}, so it has nothing to retry; ` +
        "a new test file is queued once its revision is listed, without a retry. " +
        `squeal status --wait 60000 ${shellWord(given)} waits for that listing and its result.`,
    };
  }
  return { text: `Not retried: ${shown} is not a test file Squeal has keyed in this worktree.` };
}

/**
 * `missing`, no file at `rel`; `unlisted`, a file that may be a test file
 * and that no listed revision holds yet, with the clause naming the
 * revision; `other`, a file the daemon listed and did not key, or one no
 * runner built here can list. A file is new to the listing when it changed
 * (its ctime) after the newest listed revision was recorded and after the
 * daemon that listed it started; with neither time known it reads as listed,
 * as before this row.
 */
function unkeyedPath(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  rel: string,
  keys: readonly TestFileKeyRecord[],
): { readonly kind: "missing" | "other" } | { readonly kind: "unlisted"; readonly clause: string } {
  const stat = statSync(join(root, rel), { throwIfNoEntry: false });
  if (stat === undefined) return { kind: "missing" };
  if (!stat.isFile() || !mayList(root, rel)) return { kind: "other" };
  const header = readHeader(store, worktreeId, undefined, keys);
  if (header.testFilesListed !== true) {
    return { kind: "unlisted", clause: "the daemon has not listed this worktree's test files yet" };
  }
  const pending = header.runnerPartPending === true;
  const listed = pending ? (header.refinedRevision as number) : header.revision;
  // The daemon that finished its start scan listed what was on disk then (`bootstrappedMetaKey`).
  const marker = store.meta.get(bootstrappedMetaKey(worktreeId));
  const times = [
    store.revisions.get(worktreeId, listed)?.createdAt,
    marker === null ? undefined : Number(marker),
  ].filter((t): t is number => t !== undefined && Number.isFinite(t));
  if (times.length === 0 || stat.ctimeMs <= Math.max(...times)) return { kind: "other" };
  return {
    kind: "unlisted",
    clause: pending
      ? `revision ${header.revision} is not listed yet`
      : `it changed after revision ${header.revision}, the newest the daemon listed`,
  };
}

/**
 * Whether a runner built here may list `rel`: a node:test or pytest
 * project's `include` minus its `exclude`, from its `cwd`, as the adapters
 * match them; or, with Vitest built (003 D7), any file policy
 * `vitest.exclude` keeps, since only Vitest reads its own patterns.
 */
function mayList(root: AbsolutePath, rel: string): boolean {
  const policy = readPolicy(root);
  const others = [...policy.nodeTest, ...policy.pytest];
  const selects = (project: (typeof others)[number]) => {
    const from = posix.relative(project.cwd ?? "", rel);
    // Outside the project only when the first segment is exactly `..`: `..x.test.ts` is inside.
    if (from === ".." || from.startsWith("../")) return false;
    return (
      createInputMatcher(project.include)(from) && !createInputMatcher(project.exclude ?? [])(from)
    );
  };
  if (others.some(selects)) return true;
  const vitest = others.length === 0 || vitestDetected(root);
  return vitest && !createInputMatcher(policy.vitest.exclude)(rel);
}
