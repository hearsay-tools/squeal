import { describe, expect, it } from "vitest";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { namedResult } from "../../src/cli/status-wait-paths.js";
import { writeImportGraph } from "../../src/core/store/import-edges.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import {
  answeringReaders,
  HELPER,
  HELPER_READERS,
  keys,
  READERS,
  START,
  storeClosures,
  TYPES,
} from "./source-path-fixture.js";
import { NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-402 (gh-242): `squeal status <source path> --json`, three calls at
 * one revision, listed 688, 1 and 1 test files; the short lists carried
 * `selection.reason: "unsynced"`. A snapshot gives the daemon 750 ms
 * (`SETTLE_MS`) to answer its sync. When the daemon answers, the source path
 * selects from its key index (row 011-234); when it does not, by the stored
 * closures, one record per test file, valid only at its writer's current key
 * (001 D6's rule). Row 011-403: the fallback also reads the import walks
 * stored at this worktree's keys, whoever wrote them.
 *
 * Store: X, another worktree of the repository, wrote 12 of the 13 readers'
 * closures under keys W does not hold; W wrote one. Here all 13 import
 * `START`: the helper readers through `HELPER`, the rest directly.
 */

function sharedStore() {
  const { repo, store } = repoWith([], READERS);
  const w = repo.mainId;
  const x = repo.addWorktree("other").id;
  const [own, ...others] = READERS as [string, ...string[]];
  storeClosures(store, others, x);
  keys(store, x, others, "x1");
  storeClosures(store, [own], w);
  return { root: repo.main, store, w };
}

/** The walks W's daemon (or any at W's keys) stored for `paths`, each importing `START`. */
function storeWalks(store: Store, w: string, paths: readonly string[]) {
  const rows = store.testFileKeys.list(w);
  const keyOf = (path: string) => rows.find((r) => r.testFile.path === path)?.key as CheckKey;
  const imports = (path: string) =>
    HELPER_READERS.includes(path)
      ? [
          { path, sha1: "t", static: [HELPER], dynamic: [] },
          { path: HELPER, sha1: "h", static: [START], dynamic: [] },
          { path: START, sha1: "s", static: [], dynamic: [] },
        ]
      : [
          { path, sha1: "t", static: [], dynamic: [START] },
          { path: START, sha1: "s", static: [], dynamic: [] },
        ];
  const conn = connectionOf(store);
  conn.transaction(() =>
    writeImportGraph(conn, {
      now: NOW,
      walks: paths.map((path) => ({
        testFile: { project: "", path } as TestFileRef,
        key: keyOf(path),
        environment: "env" as never,
        imports: imports(path) as never,
      })),
      environments: [],
    }),
  );
}

/** A daemon whose sync is not answered within the snapshot's settle time. */
const late = (): DaemonSync => ({ current: () => ({ state: "pending" }), stop: () => {} });

async function snapshot(
  root: string,
  path: string,
  sync: NonNullable<Parameters<typeof readNamedSnapshot>[2]["sync"]>,
) {
  const read = await readNamedSnapshot(root, [path], { now: () => NOW, settleMs: 50, sync });
  if (read.outcome === "unavailable") throw new Error("unavailable");
  return read;
}

describe("a source path's selection at one revision (rows 011-402 and 011-403)", () => {
  it("lists 13 when the daemon answers in time and 1 by the closures alone when it does not", async () => {
    const { root } = sharedStore();
    const answered = await snapshot(root, START, answeringReaders().sync);
    const unanswered = await snapshot(root, START, late);
    expect(answered.selection.files).toHaveLength(13);
    expect(unanswered.selection.files).toHaveLength(1);
    expect(namedResult(unanswered)).toEqual({ result: "none", reason: "unsynced" });
  });

  it("lists 13 of 13 while unsynced from the walks stored at this worktree's keys", async () => {
    const { root, store, w } = sharedStore();
    storeWalks(store, w, READERS);
    const unanswered = await snapshot(root, START, late);
    expect(unanswered.selection.files.map((f) => f.path).sort()).toEqual([...READERS].sort());
    // Still unsynced, and so partial (row 011-401): the walks hold no run-time reads.
    expect(namedResult(unanswered)).toEqual({ result: "none", reason: "unsynced" });
  });

  it("reads only the closures for a path no stored walk visits", async () => {
    const { root, store, w } = sharedStore();
    storeWalks(store, w, READERS);
    // `TYPES` is in every stored closure and in no walk: W's own closure alone counts.
    const unanswered = await snapshot(root, TYPES, late);
    expect(unanswered.selection.files).toHaveLength(1);
    expect(namedResult(unanswered)).toEqual({ result: "none", reason: "unsynced" });
  });

  it("takes no walk stored at a key this worktree does not hold", async () => {
    const { root, store, w } = sharedStore();
    storeWalks(store, w, READERS);
    // W's keys move (an edit) and the walks at the new keys are not stored yet.
    keys(store, w, READERS, "w2");
    const unanswered = await snapshot(root, START, late);
    // Only the closure W wrote itself, which the store rule keeps at any key, as before.
    expect(unanswered.selection.files.map((f) => f.path)).toEqual([READERS[0]]);
  });
});
