import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type RunnerEnvironment,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 016-31 (review 0.1.323, check 4): a path another worktree stored in the
 * shared observed set reaches this worktree's key of its test file, whatever
 * read of the set merged it first. Before, a read after this worktree's own
 * write merged the path and dropped the list of files that grew, so the file
 * kept its key and an edit of the path did not re-run it.
 */

const A: TestFileRef = { project: "", path: "test/a.test.mjs" };
const B: TestFileRef = { project: "", path: "test/b.test.mjs" };
const X = "data/x.txt";
const Y = "data/y.txt";

// Module loads: observed paths key the files whatever the policy says (016 D4, O8).
const ENVIRONMENT: RunnerEnvironment = {
  project: "",
  runnerName: "regrow",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
  observedLoads: true,
};

let root: string;
let store: Store;
const head = () => readHead(root);

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** One worktree's keys over the shared store, with `A` and `B` keyed by their own paths. */
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
  });
  await keys.bootstrap(head);
  await keys.setEnvironments([ENVIRONMENT]);
  for (const ref of [A, B]) keys.setClosure({ testFile: ref, paths: [ref.path] });
  await keys.trackUntracked();
  return keys;
}

/** What a record does with one run's growth: hash it, add it to the view, store it. */
async function recorded(keys: WorktreeKeys, ref: TestFileRef, path: string): Promise<void> {
  await keys.track([path]);
  keys.addObserved(ref, [path]);
  keys.writeSeen();
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-016-31-")));
  for (const path of [A.path, B.path, X, Y]) write(path, `${path}\n`);
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

describe("another worktree's observed path (row 016-29's residue, row 016-31)", () => {
  it("re-keys its file after this worktree's own write and a read of another file", async () => {
    const here = await keyed(worktreeIdFor(root));
    const other = await keyed("other" as WorktreeId);
    await recorded(other, B, Y);
    // This worktree's write merges B's path into the store, then a read of A comes first.
    await recorded(here, A, X);
    expect(here.observedOf(A)).toEqual([X]);

    here.regrowObserved();
    await here.trackUntracked();
    expect(here.index.closure(B)?.paths).toContain(Y);
    // An edit of the path re-keys B, so the daemon runs it.
    write(Y, "edited\n");
    const revision = await here.reconcile(
      { trigger: "watch", paths: await statCandidates([Y], createFsHasher(root, "sha1")) },
      head,
    );
    const rekeyed = here.index.rekey(revision?.changes.map((c) => c.path) ?? []);
    expect(rekeyed.map((c) => c.testFile)).toContainEqual(B);
  });
});
