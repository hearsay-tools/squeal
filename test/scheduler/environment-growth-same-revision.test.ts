import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { type StatusWait, waitForStatus } from "../../src/cli/status-wait.js";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { tellRevision } from "../../src/core/delivery/liveness.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type EpochMs,
  MAIN_AGENT,
  type NodeTestProject,
  type RevisionNumber,
  type RunnerAdapter,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { git } from "../hash/git-repo.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { outcome } from "./preload-worktrees.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Review wave 13k, B1 (task 001-196): a and b are edited at revision 2. a
 * runs first and stores its result at revision 2, which discharges its
 * attribution; b's run then observes a preload path its key lacks, and the
 * growth re-keys a at revision 2 again. a's old result was observed at 2,
 * so a wait that heard of revision 2 counted a as seen and ended quiet with
 * no files while a's re-run ran. Seen is now a result under the current key:
 * the daemon names a until its re-run lands. The control's session was last
 * told revision 1, so revision 2 is in its window either way.
 */

const A = "nt/test/a.test.mjs";
const B = "nt/test/b.test.mjs";

const sleeping = (ms: number) =>
  `import { test } from "node:test";\ntest("passes", () => new Promise((done) => setTimeout(done, ${ms})));\n`;

describe("status --wait over a growth at the revision of a sibling's result (task 001-196)", () => {
  it("holds for the regrown sibling until its re-run's result", SLOW, async () => {
    const repo = createRepo("basic");
    const root = repo.main;
    // Which tracked preload helper the setup loads: a stimulus outside the keys.
    const switchFile = join(mkdtempSync(join(tmpdir(), "squeal-switch-")), "n");
    writeFileSync(switchFile, "0");
    for (const dir of ["scripts", "src", "test"])
      mkdirSync(join(root, "nt", dir), { recursive: true });
    writeFileSync(
      join(root, "nt/scripts/setup.cjs"),
      'const n = require("node:fs").readFileSync(process.env.SWITCH_FILE, "utf8").trim();\nrequire("../src/p" + n + ".cjs");\n',
    );
    for (const n of [0, 1]) writeFileSync(join(root, `nt/src/p${n}.cjs`), "module.exports = 1;\n");
    writeFileSync(join(root, A), sleeping(0));
    writeFileSync(join(root, B), sleeping(700));
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

    const project: NodeTestProject = {
      name: "nt",
      cwd: "nt",
      node: process.execPath,
      argv: ["--require", "./scripts/setup.cjs"],
      env: { SWITCH_FILE: switchFile },
      include: ["test/*.test.mjs"],
    };
    const adapter = await createNodeTestAdapter(project, {
      root,
      observed: observedStore(store, project.name),
    });
    let release = () => {};
    const rerun = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Set at revision 2: b's first run sees p1, and a's run after its first is held.
    let growing = false;
    let runsOfA = 0;
    let runsOfB = 0;
    const runner: RunnerAdapter = {
      ...adapter,
      async run(files, options) {
        const paths = files.map((file) => file.path);
        if (growing && paths.includes(B) && runsOfB === 0) writeFileSync(switchFile, "1");
        if (growing && paths.includes(A) && runsOfA > 0) await rerun;
        if (growing && paths.includes(A)) runsOfA += 1;
        if (growing && paths.includes(B)) runsOfB += 1;
        return adapter.run(files, options);
      },
    };
    const scheduler = createScheduler({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      // One file per tier, shortest first: a, then b, then b's re-run before a's.
      policy: {
        ...DEFAULT_POLICY,
        runner: { ...DEFAULT_POLICY.runner, tierSize: 1, backlogTierSize: 1 },
      },
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      head: () => readHead(root),
    });
    onTestFinished(async () => {
      release();
      await scheduler.close();
      await adapter.close();
    });
    const hasher = createFsHasher(root, "sha1");
    const batch = async (...paths: string[]) =>
      scheduler.handleBatch({ trigger: "watch", paths: await statCandidates(paths, hasher) });
    const pending = (path: string) =>
      store.testFileKeys.list(worktreeId).find((row) => row.testFile.path === path)?.pending;

    // The baseline, then a's edit at revision 1 and its quick result.
    await scheduler.start();
    await scheduler.idle();
    appendFileSync(join(root, A), "// edited\n");
    await batch(A);
    await scheduler.idle();
    expect(scheduler.status().revision).toBe(1);
    expect([A, B].map((path) => outcome(store, root, path))).toEqual(["pass", "pass"]);

    // Revision 2 edits both: a, now slower, runs first on its last quick time.
    growing = true;
    writeFileSync(join(root, A), sleeping(1_400));
    appendFileSync(join(root, B), "// edited\n");
    await batch(A, B);
    expect(scheduler.status().revision).toBe(2);
    await expect.poll(() => runsOfB, { timeout: 60_000 }).toBe(2);
    await expect.poll(() => pending(B), { timeout: 60_000 }).toBeNull();
    expect(runsOfA).toBe(1);
    expect(pending(A)).not.toBeNull();
    // a's result under its previous key was observed at the revision the growth re-keyed it at.
    const observedA = store.knownStates
      .list(worktreeId)
      .filter((state) => state.check.testPath === A)
      .map((state) => state.observedAt);
    expect(observedA).toContain(2);

    // The wait's sync captures revision 2, as the daemon's does.
    const captured = scheduler.status().revision;
    const sync = (
      _root: string,
      _pollMs: number,
      after: RevisionNumber,
      resolvedSince: EpochMs,
    ): DaemonSync => {
      let current: SyncState = { state: "pending" };
      void scheduler.refined().then(() => {
        current = {
          state: "synced",
          revision: captured,
          rekeyed: scheduler.rekeyedSince(after, captured, resolvedSince),
        };
      });
      return { current: () => current, stop: () => {} };
    };
    const control = { worktreeId, sessionId: "told-1", agentId: MAIN_AGENT };
    store.consumers.register(control, Date.now());
    tellRevision(store, control, 1 as RevisionNumber);
    const ended: StatusWait[] = [];
    const waits = [null, "told-1"].map((session) =>
      waitForStatus(root, { timeoutMs: 60_000, pollMs: 50, settleMs: 0, sync, session }).then(
        (result) => {
          ended.push(result);
          return result;
        },
      ),
    );
    // Ten of the waits' reads with a's re-run held.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(ended).toEqual([]);
    release();
    for (const result of await Promise.all(waits)) {
      expect(result).toMatchObject({ outcome: "quiet", edit: { testFiles: 1, pending: 0 } });
    }
    expect([A, B].map((path) => outcome(store, root, path))).toEqual(["pass", "pass"]);
    expect([A, B].map(pending)).toEqual([null, null]);
  });
});
