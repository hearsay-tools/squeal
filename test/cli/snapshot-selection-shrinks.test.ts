import { describe, expect, it } from "vitest";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { namedResult } from "../../src/cli/status-wait-paths.js";
import { answeringReaders, keys, READERS, START, storeClosures } from "./source-path-fixture.js";
import { NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-402 (gh-242, survey): `squeal status <source path> --json`, three
 * calls at one revision, listed 688, 1 and 1 test files; the short lists
 * carried `selection.reason: "unsynced"`. A snapshot gives the daemon 750 ms
 * (`SETTLE_MS`) to answer its sync. When the daemon answers, the source path
 * selects from its key index (row 011-234); when it does not, from the
 * store's one closure record per test file, kept only when this worktree
 * wrote it or the writer's current key is this worktree's (001 D6's rule,
 * `research/source-path-selection.md` finding 1). Nothing in the store moves
 * between the reads below.
 *
 * Store: X, another worktree of the repository, wrote 12 of the 13 readers'
 * closures under keys W does not hold; W wrote one.
 */

function sharedStore() {
  const { repo, store } = repoWith([], READERS);
  const w = repo.mainId;
  const x = repo.addWorktree("other").id;
  const [own, ...others] = READERS as [string, ...string[]];
  storeClosures(store, others, x);
  keys(store, x, others, "x1");
  storeClosures(store, [own], w);
  return { root: repo.main };
}

/** A daemon whose sync is not answered within the snapshot's settle time. */
const late = (): DaemonSync => ({ current: () => ({ state: "pending" }), stop: () => {} });

describe("a source path's selection at one revision (row 011-402)", () => {
  it("lists 13 when the daemon answers in time and 1 when it does not, the short one unsynced", async () => {
    const { root } = sharedStore();
    const answered = await readNamedSnapshot(root, [START], {
      now: () => NOW,
      settleMs: 50,
      sync: answeringReaders().sync,
    });
    const unanswered = await readNamedSnapshot(root, [START], {
      now: () => NOW,
      settleMs: 50,
      sync: late,
    });
    if (answered.outcome === "unavailable" || unanswered.outcome === "unavailable") {
      throw new Error("unavailable");
    }
    expect(answered.selection.files).toHaveLength(13);
    expect(unanswered.selection.files).toHaveLength(1);
    expect(namedResult(unanswered)).toEqual({ result: "none", reason: "unsynced" });
    // The short list names its path as a source path that selects 1 (row 011-401 labels it partial).
    expect(unanswered.selection.paths[0]).toMatchObject({
      path: START,
      kind: "source",
      selects: 1,
    });
  });
});
