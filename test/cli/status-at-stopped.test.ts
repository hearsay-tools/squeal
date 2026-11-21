import { describe, expect, it } from "vitest";
import { realDaemons } from "../../src/cli/status-at-daemons.js";
import { treePrint } from "../../src/core/delivery/stopped.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { clearStopped, markStopped } from "../../src/core/presence/events.js";
import { readStop } from "../../src/core/presence/stored.js";
import {
  addCommandHold,
  clearCommandHolds,
  readCommandHolds,
} from "../../src/core/scheduler/hold-rows.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Review wave-23 S1 (the coordinator's decision of 2026-11-21: the user's
 * explicit stop stands): with no daemon answering in the worktree, a
 * `status --at --run` call starts none while `squeal stop` marked the
 * worktree (`--until-start`, or the tree as it was at the stop) or a
 * command holds it, and clears neither; its working tree's side reads
 * not queued with why, and the commit side is still queued. With neither,
 * the daemon is started as before.
 */

const TEST = ref("test/a.test.ts");
const STOPPED = "the daemon is stopped (squeal stop); squeal start resumes it";

/** Commit A, then HEAD changes the test; no daemon runs in the worktree. */
function changed() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a, id: worktreeIdFor(f.root as AbsolutePath) };
}

/** The real working tree's side, its start recorded instead of made. */
function worktreeSide() {
  const started: string[] = [];
  const real = realDaemons({
    startWorktree: async (root) => {
      started.push(root);
      return null;
    },
  });
  return { worktree: real.worktree, started };
}

/** The stand-in commit daemon's rows: `files` queued at `commit-<path>`. */
function queuedRows(f: Fixture, tree: string, files: readonly TestFileRef[]): void {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree as AbsolutePath),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: "queued" as const,
      })),
    ),
  );
}

function stopMark(
  f: Fixture,
  id: ReturnType<typeof worktreeIdFor>,
  tree: string | null,
  until: boolean,
) {
  withStore(f, (store) =>
    store.transaction(() => markStopped(store, id, 1 as EpochMs, tree, until)),
  );
}

describe("status --at --run keeps the user's stop and holds (review wave-23 S1)", SLOW, () => {
  it("starts no daemon over `squeal stop --until-start`, clears nothing, and still queues the commit side", async () => {
    const { f, a, id } = changed();
    stopMark(f, id, null, true);
    const tree = standInTree(f);
    const ports = standIn(tree, () => undefined, { rows: (at, files) => queuedRows(f, at, files) });
    const side = worktreeSide();
    const daemons = { ...ports.ports, worktree: side.worktree };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons };

    const called = await run(
      f,
      { commit: a, paths: [TEST.path], run: { allMissing: false }, waitMs: 5000 },
      options,
    );
    expect(side.started).toEqual([]);
    expect(called.out).toContain(
      `--run, now: 1 test files the change selects with no result in the working tree not queued: ${STOPPED}`,
    );
    expect(called.out).toContain(`--run: queued 1 test files with no result at ${a.slice(0, 9)}`);
    // Row 023-40c: the commit side is one ask of the commit daemon; the worktree got none.
    expect(ports.commitAsks.map((ask) => ask.named)).toEqual([[TEST.path]]);
    expect(ports.asks).toEqual([]);
    withStore(f, (store) => expect(readStop(store, id)).toMatchObject({ untilStart: true }));
  });

  it("starts none over a plain stop while the tree is as it was, nor over a live command hold", async () => {
    const { f, id } = changed();
    const root = f.root as AbsolutePath;
    stopMark(f, id, await treePrint(root), false);
    const side = worktreeSide();
    expect(await side.worktree(root)).toBe(STOPPED);

    withStore(f, (store) => store.transaction(() => clearStopped(store, id)));
    const now = Date.now();
    withStore(f, (store) =>
      addCommandHold(store, id, {
        token: "held",
        since: now as EpochMs,
        until: (now + 60_000) as EpochMs,
        command: "pnpm install",
        wrapper: null,
        child: null,
      }),
    );
    expect(await side.worktree(root)).toBe(
      "the daemon is held (squeal hold `pnpm install`); it validates again when the command ends",
    );
    withStore(f, (store) => expect(readCommandHolds(store, id)).toHaveLength(1));
    expect(side.started).toEqual([]);

    // With no stop and no hold, the daemon is started as before.
    withStore(f, (store) => store.transaction(() => clearCommandHolds(store, id)));
    expect(await side.worktree(root)).toBeNull();
    expect(side.started).toEqual([root]);
  });

  it("starts the daemon when the tree changed since a plain stop, as a hook boundary would", async () => {
    const { f, id } = changed();
    stopMark(f, id, "an older print", false);
    const side = worktreeSide();
    expect(await side.worktree(f.root as AbsolutePath)).toBeNull();
    expect(side.started).toEqual([f.root]);
  });
});
