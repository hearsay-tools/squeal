import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { type StatusWait, waitForStatus } from "../../src/cli/status-wait.js";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type RevisionNumber,
  type RunnerAdapter,
  type RunReport,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { git } from "../hash/git-repo.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { outcome, PRELOAD_SRC, PRELOADED } from "./preload-worktrees.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Review wave 4 (003), B1: a run that grew its environment re-keys its file
 * (task 003-43). When a later, unrelated revision landed meanwhile, that move
 * counted as the later revision's and took the file out of a `status --wait`
 * that had captured the edit's revision, which then ended quiet before the
 * file's re-run. The growth keeps the edit's attribution (task 003-45). The
 * control is the same sequence with a run that observed no environment file.
 */

const TEST = "nt/test/a.test.mjs";

function gate() {
  let open = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { shut, open };
}

describe("status --wait over an edit whose run grew its environment (task 003-45)", SLOW, () => {
  it.each([
    ["grew its environment", true],
    ["observed no environment file (control)", false],
  ])("holds for the edit's file until its re-run when the run %s", async (_, grows) => {
    const repo = createRepo("basic");
    const root = repo.main;
    mkdirSync(join(root, "nt/scripts"), { recursive: true });
    mkdirSync(join(root, "nt/src"), { recursive: true });
    mkdirSync(join(root, "nt/test"), { recursive: true });
    writeFileSync(join(root, "nt/scripts/setup.cjs"), 'require("../src/hidden" + ".cjs");\n');
    writeFileSync(join(root, PRELOAD_SRC), "globalThis.hiddenValue = 1;\n");
    writeFileSync(
      join(root, TEST),
      'import { test } from "node:test";\ntest("passes", () => {});\n',
    );
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "nt"]);
    const store = openRepoStore(repo.commonDir);
    const worktreeId = worktreeIdFor(root);
    // A live daemon, as the wait reads it.
    store.worktrees.upsert({
      id: worktreeId,
      root,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: "/tmp/squeal-test.sock",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        heartbeatIntervalMs: 600_000,
        squealVersion: "0.0.0-test",
      },
    });

    const adapter = await createNodeTestAdapter(PRELOADED, {
      root,
      observed: observedStore(store, PRELOADED.name),
    });
    const firstReport = gate();
    const refinement = gate();
    const rerun = gate();
    let runs = 0;
    let held = null as RunReport | null;
    let firstRunId = "";
    let holdClosures = false;
    let heldClosures = 0;
    const runner: RunnerAdapter = {
      ...adapter,
      async closure(testFile) {
        const closure = await adapter.closure(testFile);
        if (holdClosures) {
          heldClosures += 1;
          await refinement.shut;
        }
        return closure;
      },
      async run(files, options) {
        runs += 1;
        const run = runs;
        if (run === 2) await rerun.shut;
        const report = await adapter.run(files, options);
        if (run !== 1) return report;
        firstRunId = options.runId;
        held = report;
        await firstReport.shut;
        if (grows) return report;
        const { environmentObserved: _, ...withoutGrowth } = report;
        return withoutGrowth;
      },
    };
    const scheduler = createScheduler({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: DEFAULT_POLICY,
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      head: () => readHead(root),
    });
    onTestFinished(async () => {
      for (const held of [firstReport, refinement, rerun]) held.open();
      await scheduler.close();
      await adapter.close();
    });
    const hasher = createFsHasher(root, "sha1");
    const edit = async (path: string) => {
      appendFileSync(join(root, path), "// edited\n");
      await scheduler.handleBatch({
        trigger: "watch",
        paths: await statCandidates([path], hasher),
      });
    };

    // 1. The baseline's run completes and is held before the scheduler records it.
    await scheduler.start();
    await expect.poll(() => held, { timeout: 60_000 }).not.toBeNull();
    expect(held?.environmentObserved?.flatMap((o) => o.paths)).toContain(PRELOAD_SRC);
    // 2. The edit of the test file: its revision, whose runner part is held after its closure.
    holdClosures = true;
    await edit(TEST);
    const edited = scheduler.status().revision;
    await expect.poll(() => heldClosures, { timeout: 60_000 }).toBeGreaterThan(0);

    // 3. The wait starts; its sync captures the edit's revision, then awaits the runner part.
    let captured = null as RevisionNumber | null;
    let synced = false;
    const sync = (_root: string, _pollMs: number, after: RevisionNumber): DaemonSync => {
      let current: SyncState = { state: "pending" };
      const revision = scheduler.status().revision;
      captured = revision;
      void scheduler.refined().then(() => {
        current = { state: "synced", revision, rekeyed: scheduler.rekeyedSince(after, revision) };
        synced = true;
      });
      return { current: () => current, stop: () => {} };
    };
    let ended = null as StatusWait | null;
    const wait = waitForStatus(root, { timeoutMs: 60_000, pollMs: 50, settleMs: 0, sync }).then(
      (result) => {
        ended = result;
        return result;
      },
    );
    expect(captured).toBe(edited);

    // 4. An unrelated tracked edit: a later revision that re-keys no node:test file.
    await edit("src/strings.ts");
    expect(scheduler.status().revision).toBe(edited + 1);
    // 5. The held run is recorded; 6. then the runner part is applied while the re-run is held.
    const phase = () =>
      store.testFileKeys.list(worktreeId).find((row) => row.testFile.path === TEST)?.pending;
    // The edit re-keyed the file during its run: its row is queued at the new key (task 001-205).
    expect(phase()).toBe("queued");
    firstReport.open();
    await expect
      .poll(() => store.runs.get(firstRunId)?.end ?? null, { timeout: 60_000 })
      .not.toBeNull();
    refinement.open();
    await expect.poll(() => runs, { timeout: 60_000 }).toBe(2);
    await expect.poll(() => synced, { timeout: 60_000 }).toBe(true);
    // Ten of the wait's reads after the daemon named the files.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 7. The wait still holds for the file while its re-run is held, then ends on its result.
    expect(ended).toBeNull();
    rerun.open();
    const result = await wait;
    expect(result).toMatchObject({
      outcome: "quiet",
      edit: { since: edited, testFiles: 1, pending: 0 },
    });
    expect(outcome(store, root, TEST)).toBe("pass");
  });
});
