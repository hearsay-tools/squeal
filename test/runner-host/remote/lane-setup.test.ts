import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { remoteHostOver } from "../../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import { readHeader } from "../../../src/core/state/header.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import {
  type CatchUpFile,
  CatchUpRunner,
  catchUpRepo,
  catchUpSide,
} from "../../scheduler/catch-up-fixture.js";
import { rows } from "../../scheduler/merge-hold-fixture.js";
import { inProcessHost, POLICY, REPORT } from "../fake-channel.js";
import { background, setup, until } from "./lane-fixture.js";

/*
 * Review 0.1.457 B3 (row 021-23, spec 021 D19.2): a split tier's two parts
 * may each fail to start, but a report holds one setup failure. A part after
 * one that failed to start does not run; its files join that failure's, and
 * the scheduler queues them again (another project) or blocks them (the
 * failed one). Each project's setup failure is recorded with its own error.
 */

const A = { project: "a", path: "a/test/a.test.ts" };
const B = { project: "b", path: "b/test/b.test.ts" };
const C = { project: "c", path: "c/test/c.test.ts" };
const FATAL = "fatal: not a git repository (or any of the parent directories): .git";

/** A run of `files` whose global setup for `project` failed with `message`. */
function failedSetup(project: string, message: string, files: readonly TestFileRef[]): RunReport {
  return {
    ...REPORT,
    failure: `global setup ${project}/setup.ts failed`,
    startupFailure: {
      projects: [project],
      testFiles: [...files],
      setupFile: `${project}/setup.ts`,
      error: { name: "Error", message, stack: null, location: null, diff: null, phase: "setup" },
    },
  };
}

describe("a split tier whose parts fail to start (review 0.1.457 B3)", () => {
  it("does not run the remote part after the local part's setup failure; its files join that failure", async () => {
    const s = await setup({
      needsRepository: ["a/**"],
      localRun: async (files) => failedSetup("a", "local setup A failed", files),
      remoteRun: async () => failedSetup("b", "remote setup B failed", [B]),
    });
    const report = await s.lane.run([A, B], background());
    expect(s.remoteRuns).toEqual([]);
    expect(s.localFiles).toEqual([A.path]);
    expect(report.startupFailure?.projects).toEqual(["a"]);
    expect(report.startupFailure?.error.message).toBe("local setup A failed");
    expect(report.startupFailure?.testFiles).toEqual([A, B]);
  });

  it("keeps the local part's results and the remote part's setup failure when only the remote fails", async () => {
    const s = await setup({
      needsRepository: ["a/**"],
      remoteRun: async () => failedSetup("b", "remote setup B failed", [B]),
    });
    const report = await s.lane.run([A, B], background());
    expect(report.completedFiles).toEqual([A]);
    expect(report.startupFailure?.projects).toEqual(["b"]);
    expect(report.startupFailure?.testFiles).toEqual([B]);
  });

  it("does not rerun a missing-repository file here beside the remote's own setup failure", async () => {
    const s = await setup({
      remoteRun: async () => ({
        ...failedSetup("b", "remote setup B failed", [B]),
        completedFiles: [C],
        results: [
          {
            check: { kind: "test", project: "c", testPath: C.path, fullName: "reads HEAD" },
            outcome: "fail",
            durationMs: 1,
            location: null,
            errors: [{ name: "Error", message: FATAL, stack: null, location: null, diff: null }],
          },
        ],
      }),
    });
    const report = await s.lane.run([B, C], background());
    expect(s.localFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.completedFiles).toEqual([]);
    expect(report.startupFailure?.projects).toEqual(["b"]);
    expect(report.startupFailure?.testFiles).toEqual([B, C]);
    expect(s.repository.at(-1)).toContain(`run here: ${C.path};`);
    await s.lane.run([C], background());
    expect(s.localFiles).toEqual([C.path]);
  });

  it("starts no remote part after a stop during the local part", async () => {
    const stop = new AbortController();
    const s = await setup({
      needsRepository: ["a/**"],
      localRun: async (files) => {
        stop.abort();
        return { ...REPORT, completedFiles: [...files] };
      },
    });
    const report = await s.lane.run([A, B], background({ stop: stop.signal }));
    expect(s.remoteRuns).toEqual([]);
    expect(report.completedFiles).toEqual([A]);
  });
});

describe("the scheduler over a split tier whose parts fail to start (review 0.1.457 B3)", () => {
  it("records each project's own setup failure and blocks each project's files", {
    timeout: 60_000,
  }, async () => {
    const files: CatchUpFile[] = [
      { ...A, ms: 10, imports: [] },
      { ...B, ms: 10, imports: [] },
    ];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    const remoteRoot = mkdtempSync(join(tmpdir(), "squeal-lane-setup-"));
    onTestFinished(() => rmSync(remoteRoot, { recursive: true, force: true }));
    mkdirSync(join(remoteRoot, "root"));

    const here = side.runner.run.bind(side.runner);
    const localRuns: string[][] = [];
    const remoteRuns: string[][] = [];
    const local: RunnerAdapter = {
      ...side.runner,
      name: side.runner.name,
      adapterVersion: side.runner.adapterVersion,
      run: async (ran, options) => {
        localRuns.push(ran.map((f) => f.path));
        if (ran.some((f) => f.project === "a"))
          return failedSetup("a", "local setup A failed", ran);
        return here(ran, options);
      },
    };
    const remote = new CatchUpRunner(files);
    remote.run = async (ran) => {
      remoteRuns.push(ran.map((f) => f.path));
      return failedSetup("b", "remote setup B failed", ran);
    };
    const statuses: string[] = [];
    const lane = withRemoteLane({
      target: "box",
      whenLost: "local",
      root: side.root,
      version: "0.0.0-test",
      local,
      connect: async () => {
        const host = inProcessHost(async () => remote, "0.0.0-test", {
          tree: createTreeHost(join(remoteRoot, "root"), () => {}),
        });
        onTestFinished(() => host.channel.kill());
        return remoteHostOver(host.channel, "v-test", {
          target: { destination: "box" },
          version: "0.0.0-test",
          root: side.root,
          runner: "vitest",
          options: { childEnv: {} },
          policy: () => POLICY,
        });
      },
      allowlist: () => [],
      needsRepository: () => ["a/**"],
      status: (text) => statuses.push(text),
      log: () => {},
    });
    onTestFinished(() => lane.close());
    await until(() => statuses.some((s) => / go there| refused| unreachable/.test(s)));
    expect(statuses.at(-1)).toMatch(/ go there/);
    side.runner.run = (ran, options) => lane.run(ran, options);

    await side.scheduler.start();
    await side.scheduler.idle();

    // The first tier ran A here and deferred B; B ran remote in the next.
    expect(localRuns).toEqual([[A.path]]);
    expect(remoteRuns).toEqual([[B.path]]);
    const setups = side.store.knownStates
      .list(side.worktreeId)
      .filter((state) => state.check.kind === "setup")
      .map((state) => [state.check.project, state.outcome, state.validity, state.summary]);
    expect(setups).toEqual([
      ["a", "fail", "current", expect.stringContaining("local setup A failed")],
      ["b", "fail", "current", expect.stringContaining("remote setup B failed")],
    ]);
    const now = rows(side);
    expect([now.get(A.path)?.pending, now.get(B.path)?.pending]).toEqual([null, null]);
    // Neither file is queued: each is unknown, blocked behind its own project's setup.
    expect(readHeader(side.store, side.worktreeId).testFilesWithoutChecks).toMatchObject({
      pending: 0,
      unknown: 2,
    });
    await side.scheduler.close();
  });
});
