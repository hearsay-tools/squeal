import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDaemonLoop, type DaemonLoop } from "../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Revision,
  type Store,
  type WatcherBackend,
} from "../../src/core/types/index.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Task 001-166: git lists a symlinked directory, never the files under it, so
 * the start seed left them to the change feed's first walk, which recorded
 * them as adds of revision 1. The seed covers them now; a real addition at
 * start, an edit under the link, and an addition found by an interval pass
 * each still make a revision.
 */
describe("a worktree with a linked directory starts at revision 0", SLOW, () => {
  /** A repository whose `.agents/skills/w` links to `.claude/skills/w`, as this one's do. */
  function linkedRepo(): { root: string; store: Store; worktreeId: string; commonDir: string } {
    const repo = createRepo();
    const root = repo.main;
    mkdirSync(join(root, ".claude/skills/w/references"), { recursive: true });
    writeFileSync(join(root, ".claude/skills/w/SKILL.md"), "# w\n");
    writeFileSync(join(root, ".claude/skills/w/references/a.md"), "a\n");
    mkdirSync(join(root, ".agents/skills"), { recursive: true });
    symlinkSync("../../.claude/skills/w", join(root, ".agents/skills/w"));
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "skills"], { cwd: root });
    const store = openRepoStore(repo.commonDir);
    return { root, store, worktreeId: worktreeIdFor(root), commonDir: repo.commonDir };
  }

  async function withLoop(
    repo: ReturnType<typeof linkedRepo>,
    options: { backend?: WatcherBackend; reconcileIntervalMs?: number },
    body: (loop: DaemonLoop) => Promise<void>,
  ): Promise<void> {
    const { root, store, worktreeId, commonDir } = repo;
    const runner = await createVitestAdapter({ root });
    const errors: Error[] = [];
    const loop = createDaemonLoop({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: DEFAULT_POLICY,
      squealVersion: "0.0.0-test",
      runsDir: storePaths(commonDir).runsDir,
      onError: (error) => errors.push(error),
      ...(options.backend === undefined ? {} : { backend: options.backend }),
      timings: { reconcileIntervalMs: options.reconcileIntervalMs ?? 60_000 },
    });
    try {
      await loop.start();
      await loop.scheduler.idle();
      await body(loop);
    } finally {
      await loop.close();
      await runner.close();
    }
    expect(errors).toEqual([]);
  }

  const revisions = (store: Store, worktreeId: string): readonly Revision[] =>
    store.revisions.range(worktreeId, 0, store.revisions.latest(worktreeId)?.number ?? 0);
  const changed = (revision: Revision) => revision.changes.map((c) => c.path);

  it("seeds the files under the link without a revision; an edit under it makes one", async () => {
    const repo = linkedRepo();
    await withLoop(repo, {}, async () => {
      expect(revisions(repo.store, repo.worktreeId)).toEqual([]);
      writeFileSync(join(repo.root, ".agents/skills/w/references/a.md"), "edited\n");
      await waitFor(
        () =>
          revisions(repo.store, repo.worktreeId).some((r) =>
            changed(r).includes(".agents/skills/w/references/a.md"),
          ),
        10_000,
      );
      for (const revision of revisions(repo.store, repo.worktreeId)) {
        expect(revision.changes.every((c) => c.oldHash !== null)).toBe(true);
      }
    });
  });

  it("records a file added while the feed starts, and nothing under the link", async () => {
    const repo = linkedRepo();
    const inner = createWatcherBackend(process.platform);
    // The start seed has run when the feed starts its watch; an agent adds a file now.
    const backend: WatcherBackend = {
      name: inner.name,
      watch: (spec, listener) => {
        writeFileSync(join(repo.root, "src/added.ts"), "export const added = 1;\n");
        return inner.watch(spec, listener);
      },
    };
    await withLoop(repo, { backend }, async () => {
      const all = revisions(repo.store, repo.worktreeId);
      expect(all.map((r) => [r.trigger, changed(r)])).toEqual([["interval", ["src/added.ts"]]]);
    });
  });

  it("records a file only an interval pass finds, and nothing under the link", async () => {
    const repo = linkedRepo();
    // Hears nothing: only reconciliation passes see the worktree.
    const deaf: WatcherBackend = {
      name: "chokidar",
      watch: async () => ({ update: async () => {}, close: async () => {} }),
    };
    await withLoop(repo, { backend: deaf, reconcileIntervalMs: 300 }, async () => {
      expect(revisions(repo.store, repo.worktreeId)).toEqual([]);
      writeFileSync(join(repo.root, "src/later.ts"), "export const later = 1;\n");
      await waitFor(() => revisions(repo.store, repo.worktreeId).length > 0, 10_000);
      const all = revisions(repo.store, repo.worktreeId);
      expect(all.map((r) => [r.trigger, changed(r)])).toEqual([["interval", ["src/later.ts"]]]);
    });
  });
});
