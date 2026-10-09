import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createDelivery } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type CheckKey,
  type Consumer,
  DEFAULT_POLICY,
  MAIN_AGENT,
  type NodeTestProject,
  type RunnerAdapter,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { git } from "../hash/git-repo.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import {
  CONTROL_TEST,
  HIDDEN_TEST,
  keyOf,
  open,
  origin,
  outcome,
  PRELOADED,
  twoWorktrees,
} from "./preload-worktrees.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Task 003-43: a run whose preload loaded an environment file its key lacked
 * stores nothing and runs again under the key with it. A preload that loads
 * a new path on every run cannot re-run forever: after three runs in a row
 * the file is unknown, naming the path, as task 001-134 bounds first
 * observations.
 */

const TEST = "nt/test/a.test.mjs";

describe("scheduler: a run that grew its environment (task 003-43)", SLOW, () => {
  it("is unknown after three runs in a row that each loaded a new environment file", async () => {
    const counter = mkdtempSync(join(tmpdir(), "squeal-003-43-"));
    onTestFinished(() => rmSync(counter, { recursive: true, force: true }));
    const repo = createRepo("basic");
    mkdirSync(join(repo.main, "nt/scripts"), { recursive: true });
    mkdirSync(join(repo.main, "nt/test"), { recursive: true });
    // Each process of a run loads the next of ten helpers, counted outside the worktree.
    writeFileSync(
      join(repo.main, "nt/scripts/setup.cjs"),
      [
        'const fs = require("node:fs");',
        'const file = require("node:path").join(process.env.COUNTER_DIR, "n");',
        'const n = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) : 0;',
        "fs.writeFileSync(file, String(n + 1));",
        'require("../src/p" + n + ".cjs");',
        "",
      ].join("\n"),
    );
    mkdirSync(join(repo.main, "nt/src"), { recursive: true });
    for (let n = 0; n < 10; n++) {
      writeFileSync(join(repo.main, `nt/src/p${n}.cjs`), "module.exports = 1;\n");
    }
    writeFileSync(
      join(repo.main, TEST),
      'import { test } from "node:test";\ntest("passes", () => {});\n',
    );
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "nt"]);
    const store = openRepoStore(repo.commonDir);
    const project: NodeTestProject = {
      name: "nt",
      cwd: "nt",
      node: process.execPath,
      argv: ["--require", "./scripts/setup.cjs"],
      env: { COUNTER_DIR: counter },
      include: ["test/*.test.mjs"],
    };
    const adapter = await createNodeTestAdapter(project, {
      root: repo.main,
      observed: observedStore(store, project.name),
    });
    const runs: TestFileRef[][] = [];
    // What a wait at the latest revision is told while each run starts.
    const named: unknown[] = [];
    const runner: RunnerAdapter = {
      ...adapter,
      run(files, options) {
        runs.push([...files]);
        const { revision } = scheduler.status();
        named.push(scheduler.rekeyedSince(revision - 1, revision));
        return adapter.run(files, options);
      },
    };
    const worktreeId = worktreeIdFor(repo.main);
    const sink = new RecordingSink(store, worktreeId);
    const scheduler = createScheduler({
      root: repo.main,
      worktreeId,
      store,
      runner,
      sink,
      policy: DEFAULT_POLICY,
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      head: () => readHead(repo.main),
    });
    onTestFinished(async () => {
      await scheduler.close();
      await adapter.close();
    });

    await scheduler.start();
    await scheduler.idle();
    expect(runs.flat().map((f) => f.path)).toEqual([TEST, TEST, TEST]);
    // Each growth's move counts as the latest revision's, so `status --wait` holds for the file
    // while it re-runs; its `unknown` is its result and ends that (task 001-194).
    const { revision } = scheduler.status();
    const held = [{ testFile: { project: "nt", path: TEST }, revision }];
    expect(named).toEqual([[], held, held]);
    expect(scheduler.rekeyedSince(revision - 1, revision)).toEqual([]);
    // It never ran to a result, so the file itself is what is unknown.
    expect(sink.calls.filter((call) => call.method === "markUnknown")).toEqual([
      expect.objectContaining({
        testFiles: [{ project: "nt", path: TEST }],
        reason: expect.stringMatching(
          /^3 runs in a row loaded environment files their key lacked \(nt\/src\/p\d\.cjs/,
        ),
      }),
    ]);
  });

  /*
   * 001 review wave 13j, B2: under 001-187's stopgap, A's pass stored under
   * the key lacking the preload path healed no worktree at once, but B's
   * forced full suite refreshed B's states from that shared row, delivering
   * FAIL -> PASS while B's own run was held. Here A's run, which loaded the
   * path its key lacked, stores nothing under that key: there is no row to
   * read, and B keeps its own fail through the request.
   */
  it("a forced full suite in B reads no pass A stored under the key lacking the preload path", async () => {
    const { repo, rootB, store } = await twoWorktrees(true);
    let releaseA = () => {};
    const heldA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let gateB: Promise<void> | undefined;
    let releaseB = () => {};
    onTestFinished(() => {
      releaseA();
      releaseB();
    });
    // The key each file of each run went under, read as the run starts.
    const ranUnder: { root: string; path: string; key: CheckKey | null | undefined }[] = [];
    const note = (root: string) => () => {
      for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
        ranUnder.push({ root, path, key: keyOf(store, root, path) });
      }
      return root === rootB ? gateB : undefined;
    };
    const a = await open(repo.main, store, repo.commonDir, heldA, PRELOADED, note(repo.main));
    const b = await open(rootB, store, repo.commonDir, undefined, PRELOADED, note(rootB));

    // A read its environment and computed a closure; B runs to its own fail meanwhile.
    const aStarted = a.scheduler.start();
    await expect.poll(() => a.closures()).toBeGreaterThan(0);
    await b.scheduler.start();
    await b.scheduler.idle();
    for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
      expect(outcome(store, rootB, path)).toBe("fail");
      expect(origin(store, rootB, path)).toBe("own");
    }
    releaseA();
    await aStarted;
    await a.scheduler.idle();
    expect(outcome(store, repo.main)).toBe("pass");

    // A's first run went under keys lacking the path, the keys B's first run went under too:
    // no result of either file is stored under them.
    const first = (root: string, path: string) =>
      ranUnder.find((r) => r.root === root && r.path === path)?.key;
    for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
      const incomplete = first(repo.main, path);
      expect(incomplete).toBeTruthy();
      expect(first(rootB, path)).toBe(incomplete);
      expect(store.results.byKey(incomplete ?? null, 0)).toEqual([]);
      expect(keyOf(store, repo.main, path)).not.toBe(keyOf(store, rootB, path));
    }

    // B's consumer, then B's forced full suite with B's next run held before it starts.
    const delivery = createDelivery(store, {
      status: {
        build: () => ({
          schemaVersion: 1,
          available: false,
          reason: "timeout",
          message: "status is not under test here",
        }),
      },
    });
    const consumer: Consumer = {
      worktreeId: worktreeIdFor(rootB),
      sessionId: "session",
      agentId: MAIN_AGENT,
    };
    await delivery.register(consumer);
    gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const before = b.runs.length;
    await b.scheduler.requestFullSuite({ force: true });
    for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
      expect(outcome(store, rootB, path)).toBe("fail");
      expect(origin(store, rootB, path)).toBe("own");
    }
    const held = await delivery.onToolBoundary(consumer);
    expect(held?.entries.filter((e) => e.kind === "fail-to-pass") ?? []).toEqual([]);

    // B's own run confirms its fail; nothing ever told B it passed.
    releaseB();
    await b.scheduler.idle();
    expect(b.runs.length).toBeGreaterThan(before);
    for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
      expect(outcome(store, rootB, path)).toBe("fail");
      expect(origin(store, rootB, path)).toBe("own");
    }
    const after = await delivery.onToolBoundary(consumer);
    expect(after?.entries.filter((e) => e.kind === "fail-to-pass") ?? []).toEqual([]);
  });
});
