import { describe, expect, it } from "vitest";
import { namedWaitCommand } from "../../src/cli/named-print.js";
import { namedSnapshotCommand } from "../../src/cli/status-paths.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import type { RevisionNumber, Store } from "../../src/core/types/index.js";
import { A, NOW, ref, repoWith } from "./status-wait-fixture.js";
import { capture, focusing } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23): `--check` with source paths
 * only is a usage error, exit 2, in the wait and in the snapshot, whether
 * or not a test file reads the source (review 0.1.286 B4). Nothing is
 * promoted or focused. A path is judged once the daemon listed the
 * revision, so a test file written just before the request is not one.
 */

const USAGE = "squeal status: --check selects checks inside a test file named by its own path\n";

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const snapshotOptions = {
  now: () => NOW,
  sync: (): DaemonSync => ({ current: synced, stop: () => {} }),
};

/** A's stored closure holds `src/shared.ts`: that source path selects A. */
function sharedReadsA(store: Store, worktreeId: string) {
  store.testFiles.put({
    testFile: ref(A),
    closure: {
      testFile: ref(A),
      paths: [A, "src/shared.ts"].sort() as never,
      complete: false,
      method: CLOSURE_METHOD,
    },
    updatedAt: NOW,
    updatedBy: worktreeId,
  });
}

describe("--check with source paths only is a usage error (011 C15, review 0.1.286 B4)", () => {
  for (const [what, path] of [
    ["a source a test file reads", "src/shared.ts"],
    ["a source no test file reads", "src/uncovered.ts"],
  ] as const) {
    it(`the wait, ${what}: exit 2, nothing promoted or sent`, async () => {
      const { repo, store } = repoWith([A]);
      sharedReadsA(store, repo.mainId);
      const daemon = focusing(store, repo.mainId, null);
      const io = capture(repo.main);

      const code = await namedWaitCommand(
        [path],
        { json: false, checks: ["good"] },
        io,
        daemon.options,
      );

      expect(code).toBe(2);
      expect(io.err.join("")).toBe(USAGE);
      expect(io.out).toEqual([]);
      expect(daemon.sent).toEqual([]);
      expect(daemon.promoted).toEqual([]);
    });

    it(`the snapshot, ${what}: exit 2`, async () => {
      const { repo, store } = repoWith([A]);
      sharedReadsA(store, repo.mainId);
      const io = capture(repo.main);

      const code = await namedSnapshotCommand(
        [path],
        { json: false, checks: ["good"] },
        io,
        snapshotOptions,
      );

      expect(code).toBe(2);
      expect(io.err.join("")).toBe(USAGE);
    });
  }

  it("a path not listed before the daemon's listing is no usage error yet", async () => {
    const { repo } = repoWith([A]);
    const io = capture(repo.main);
    // The daemon never answers its sync: the listing is not known, so the path is not judged.
    const unsynced = {
      now: () => NOW,
      sync: (): DaemonSync => ({ current: () => ({ state: "pending" }), stop: () => {} }),
      settleMs: 50,
    };

    const code = await namedSnapshotCommand(
      ["src/new.test.ts"],
      { json: false, checks: ["good"] },
      io,
      unsynced,
    );

    expect(code).toBe(3);
    expect(io.err.join("")).toBe("");
  });
});
