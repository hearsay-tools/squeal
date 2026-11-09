import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { ObservedSets, observedMetaKey } from "../../src/core/keys/observed.js";
import { appendNote, readDaemonNotes } from "../../src/core/notes.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { RunnerEnvironment } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 011-310 (issue #166): a stored observed path that is not a
 * worktree-relative path, as a test that fakes win32 leaves one, stopped
 * every daemon of the repository at its start: closure assembly threw. Now
 * it is left out of the closure with a note, and the file's key differs from
 * its key over the valid paths, so a result stored before the path was
 * observed is not current.
 */

const A: TestFileRef = { project: "server", path: "test/a.test.mjs" };
const X = "data/x.txt";
const BAD = String.raw`\home\agent\AppData\Local\Hearsay Squawk\cache`;
const NOTE =
  `observed path left out of server:${A.path}: "${BAD}" is not a worktree-relative path; ` +
  "the file's key marks its closure incomplete, so no result stored before the path was observed is reused";

const ENVIRONMENT: RunnerEnvironment = {
  project: "server",
  runnerName: "malformed",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
};

let root: string;
let store: Store;
const head = () => readHead(root);

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** One daemon's keys of `A` over the shared store, its notes persisted as the daemon's are. */
async function keyed(worktreeId: WorktreeId): Promise<WorktreeKeys> {
  const keys = new WorktreeKeys({
    root,
    worktreeId,
    store,
    hasher: createFsHasher(root, "sha1"),
    objectFormat: "sha1",
    policy: DEFAULT_POLICY,
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles: () => {},
    note: (text) => appendNote(store, worktreeId, { at: 0, revision: null, text }),
  });
  await keys.bootstrap(head);
  await keys.setEnvironments([ENVIRONMENT]);
  keys.setClosure({ testFile: A, paths: [A.path] });
  await keys.trackUntracked();
  return keys;
}

const notes = (worktreeId: WorktreeId) =>
  readDaemonNotes(store, worktreeId).map((note) => note.text);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-011-310-")));
  for (const path of [A.path, X]) write(path, `${path}\n`);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  const opened = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  store = opened;
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("a stored observed path that is not worktree-relative (row 011-310, issue #166)", () => {
  it("keys a clean store over its valid observed reads, with no note (control)", async () => {
    new ObservedSets(store).add(A, [X]);
    const here = worktreeIdFor(root);
    const keys = await keyed(here);
    expect(keys.index.closure(A)?.paths).toEqual([X, A.path]);
    expect(keys.index.key(A)).not.toBeNull();
    expect(notes(here)).toEqual([]);
    // A valid observed read still re-keys the file when it changes.
    write(X, "edited\n");
    const revision = await keys.reconcile(
      { trigger: "watch", paths: await statCandidates([X], createFsHasher(root, "sha1")) },
      head,
    );
    const rekeyed = keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);
    expect(rekeyed.map((c) => c.testFile)).toEqual([A]);
  });

  it("is left out of the closure, noted, and moves the key off the result stored without it", async () => {
    const here = worktreeIdFor(root);
    new ObservedSets(store).add(A, [X]);
    const before = (await keyed(here)).index.key(A);

    // A run of another worktree stored the path; this worktree's daemon starts again over it.
    new ObservedSets(store).add(A, [BAD]);
    const keys = await keyed(here);
    expect(keys.index.closure(A)?.paths).toEqual([X, A.path]);
    const key = keys.index.key(A);
    expect(key).not.toBeNull();
    expect(key).not.toBe(before);
    expect(notes(here)).toEqual([NOTE]);
    // Nothing is pruned from the shared set (011 C3).
    expect(JSON.parse(store.meta.get(observedMetaKey("server")) ?? "{}")).toEqual({
      [A.path]: [X, BAD].sort(),
    });

    // A restart keys alike and writes the note no second time.
    expect((await keyed(here)).index.key(A)).toBe(key);
    expect(notes(here)).toEqual([NOTE]);

    // A second worktree sharing the store starts, keys alike and names the path in its own notes.
    const other = "other" as WorktreeId;
    expect((await keyed(other)).index.key(A)).toBe(key);
    expect(notes(other)).toEqual([NOTE]);
  });

  it("from a run's own record keeps the path as evidence and keys the file without it", async () => {
    const here = worktreeIdFor(root);
    const keys = await keyed(here);
    const before = keys.index.key(A);
    expect(keys.effectiveObserved(A, [BAD, X])).toEqual([X]);

    await keys.track([X]);
    keys.addObserved(A, [BAD, X]);
    keys.writeSeen();
    expect(keys.index.closure(A)?.paths).toEqual([X, A.path]);
    expect(keys.index.key(A)).not.toBe(before);
    expect(JSON.parse(store.meta.get(observedMetaKey("server")) ?? "{}")).toEqual({
      [A.path]: [X, BAD].sort(),
    });
    expect(notes(here)).toEqual([NOTE]);
  });
});
