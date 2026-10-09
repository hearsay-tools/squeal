import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
 * Re-review 003-46 (003-node-test-runner/reviews/wave-4.5.md, B1), closed by
 * task 001-194: a and c had their results, a's of an edit at revision 1;
 * b's edit at revision 2 ran with a preload path its key lacked, and the
 * growth re-keyed a, b and c. Growth kept a's and c's old, discharged
 * attributions (1 and 0), so a wait captured at revision 2 saw them
 * discharged and ended quiet while both were pending. A result now clears
 * `keyedAt`, so the growth gives them revision 2; b's own result, landed
 * before the wait, holds nothing.
 */

const A = "nt/test/a.test.mjs";
const B = "nt/test/b.test.mjs";
const C = "nt/test/c.test.mjs";

const PASSING = 'import { test } from "node:test";\ntest("passes", () => {});\n';
/** Slower than b, so D5's shortest-first order runs b's re-run before them. */
const SLOWER =
  'import { test } from "node:test";\ntest("passes", () => new Promise((done) => setTimeout(done, 700)));\n';

describe(
  "status --wait over a growth that re-keyed files with results (task 001-194)",
  SLOW,
  () => {
    it("holds for the siblings the growth re-keyed until their results", async () => {
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
      for (const n of [0, 1])
        writeFileSync(join(root, `nt/src/p${n}.cjs`), "module.exports = 1;\n");
      for (const path of [A, C]) writeFileSync(join(root, path), SLOWER);
      writeFileSync(join(root, B), PASSING);
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
      const siblings = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holdSiblings = false;
      let runsOfB = 0;
      const runner: RunnerAdapter = {
        ...adapter,
        async run(files, options) {
          if (holdSiblings && files.some((file) => file.path !== B)) await siblings;
          if (files.some((file) => file.path === B)) runsOfB += 1;
          return adapter.run(files, options);
        },
      };
      const scheduler = createScheduler({
        root,
        worktreeId,
        store,
        runner,
        sink: new RecordingSink(store, worktreeId),
        // One file per tier: b's re-run lands while a sibling's is held.
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
      const edit = async (path: string) => {
        appendFileSync(join(root, path), "// edited\n");
        await scheduler.handleBatch({
          trigger: "watch",
          paths: await statCandidates([path], hasher),
        });
      };
      const pending = (path: string) =>
        store.testFileKeys.list(worktreeId).find((row) => row.testFile.path === path)?.pending;

      // The baseline, its own growth included, then a's edit at revision 1 and its result.
      await scheduler.start();
      await scheduler.idle();
      await edit(A);
      await scheduler.idle();
      expect(scheduler.status().revision).toBe(1);
      expect([A, B, C].map((path) => outcome(store, root, path))).toEqual(["pass", "pass", "pass"]);

      // b's edit at revision 2 runs with p1, which its key lacks: the growth re-keys a, b and c.
      writeFileSync(switchFile, "1");
      holdSiblings = true;
      const before = runsOfB;
      await edit(B);
      await expect.poll(() => runsOfB - before, { timeout: 60_000 }).toBe(2);
      await expect.poll(() => pending(B), { timeout: 60_000 }).toBeNull();
      expect(pending(A)).not.toBeNull();
      expect(pending(C)).not.toBeNull();

      // The wait's sync captures revision 2, as the daemon's does.
      const captured = scheduler.status().revision;
      expect(captured).toBe(2);
      const sync = (_root: string, _pollMs: number, after: RevisionNumber): DaemonSync => {
        let current: SyncState = { state: "pending" };
        void scheduler.refined().then(() => {
          current = {
            state: "synced",
            revision: captured,
            rekeyed: scheduler.rekeyedSince(after, captured),
          };
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
      // Ten of the wait's reads with a and c held.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(ended).toBeNull();
      release();
      const result = await wait;
      expect(result).toMatchObject({ outcome: "quiet", edit: { testFiles: 2, pending: 0 } });
      expect([A, B, C].map((path) => outcome(store, root, path))).toEqual(["pass", "pass", "pass"]);
      expect([A, B, C].map(pending)).toEqual([null, null, null]);
    });
  },
);
