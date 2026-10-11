import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { type StatusWait, waitForStatus } from "../../../../../../src/cli/status-wait.js";
import { observedStore } from "../../../../../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../../../../../src/core/daemon-loop/head.js";
import { tellRevision } from "../../../../../../src/core/delivery/liveness.js";
import { worktreeIdFor } from "../../../../../../src/core/fs/index.js";
import { createFsHasher } from "../../../../../../src/core/hash/index.js";
import { statCandidates } from "../../../../../../src/core/revision/index.js";
import { createScheduler } from "../../../../../../src/core/scheduler/index.js";
import { storePaths } from "../../../../../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  MAIN_AGENT,
  type NodeTestProject,
  type RevisionNumber,
  type RunnerAdapter,
} from "../../../../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../../../../src/runners/node-test/adapter.js";
import { git } from "../../../../../../test/hash/git-repo.js";
import { createRepo, openRepoStore, SLOW } from "../../../../../../test/scheduler/helpers.js";
import { outcome } from "../../../../../../test/scheduler/preload-worktrees.js";
import { RecordingSink } from "../../../../../../test/scheduler/recording-sink.js";

// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
// reviews/wave-13k.md B1 (test/scheduler/environment-growth-same-revision.test.ts),
// answered from the store instead of `rekeyedSince`, and its open-only control.
import { SHADOW } from "./shadow.js";
import { type StoreSyncLog, storeSync } from "./store-sync.js";

vi.mock("../../../../../../src/core/scheduler/rekeyed-record.js", async (importOriginal) =>
  (await import("./mock.js")).shadowedRecord(importOriginal as never),
);

const A = "nt/test/a.test.mjs";
const B = "nt/test/b.test.mjs";

const sleeping = (ms: number) =>
  `import { test } from "node:test";\ntest("passes", () => new Promise((done) => setTimeout(done, ${ms})));\n`;

describe("13k B1 from the store: a growth at the revision of a sibling's result", () => {
  it.each([
    { name: "holds for the regrown sibling until its re-run's result", noReopen: false },
    { name: "control: a resolved revision is not reopened", noReopen: true },
  ])("$name", SLOW, async ({ noReopen }) => {
    SHADOW.noReopen = noReopen;
    onTestFinished(() => {
      SHADOW.noReopen = false;
    });
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
    const log: StoreSyncLog = { sinceSeqs: [], outcomes: [] };
    const sync = storeSync(store, worktreeId, () => captured, undefined, log);
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

    expect(log.outcomes).toEqual(["answered", "answered"]);
    if (noReopen) {
      // The 13k B1 failure: both waits quiet with no file while a's re-run is held.
      expect(ended).toMatchObject([
        { outcome: "quiet", edit: { testFiles: 0, pending: 0 } },
        { outcome: "quiet", edit: { testFiles: 0, pending: 0 } },
      ]);
      expect(pending(A)).not.toBeNull();
      release();
      return;
    }
    expect(ended).toEqual([]);
    release();
    for (const result of await Promise.all(waits)) {
      expect(result).toMatchObject({ outcome: "quiet", edit: { testFiles: 1, pending: 0 } });
    }
    expect([A, B].map((path) => outcome(store, root, path))).toEqual(["pass", "pass"]);
    expect([A, B].map(pending)).toEqual([null, null]);
  });
});
