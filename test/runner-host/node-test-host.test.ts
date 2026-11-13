import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  readNotes,
  SLOW,
  waitFor,
  withStore,
} from "../daemon/helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { hostsOf, SOURCE_LAUNCH } from "./process-helpers.js";

/*
 * Spec 021 D7, D8 (row 021-12): a daemon with `runnerHost` runs its
 * node:test tiers in a runner host, its child. A host killed during a tier
 * ends that tier `crashed`, its checks `unknown`, with a note; the next
 * batch starts a new host, which runs them. A hosted runner keeps
 * `runner.tierSize` as its tier width, as one in process does.
 */

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const HOLD = "nt/test/hold.test.mjs";
const PLAIN = "nt/test/plain.test.mjs";

const PLAIN_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
test("adds", () => assert.equal(1 + 1, 2));
`;

/** While `dir/hold` exists, marks its start in `dir` and waits for `dir/release`, up to a minute. */
const holdTest = (dir: string, edit = 0) => `import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";
test("holds until released", async () => {
  if (!existsSync(${JSON.stringify(join(dir, "hold"))})) return;
  writeFileSync(${JSON.stringify(join(dir, "started"))}, String(process.pid));
  for (let i = 0; i < 600 && !existsSync(${JSON.stringify(join(dir, "release"))}); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
// edit ${edit}
`;

/** The outcome of each known check of the file at `path`, by kind, the file's own included. */
const outcomes = (repo: FixtureRepo, path: string) =>
  withStore(repo, (store) =>
    store.knownStates
      .list(repo.worktreeId)
      .filter((s) => s.check.testPath === path)
      .map((s) => `${s.check.kind} ${s.outcome}`)
      .sort(),
  );

describe("a node:test runner in a runner host", SLOW, () => {
  it.runIf(process.platform === "linux")(
    "replaces a host killed during a tier, whose checks end unknown",
    async () => {
      const repo = createFixtureRepo({
        files: {
          "squeal.config.json": runMissingConfig(JSON.stringify({ nodeTest: [NT] })),
          [PLAIN]: PLAIN_TEST,
          [HOLD]: holdTest("/nonexistent"),
        },
      });
      onTestFinished(repo.cleanup);
      // The marks live outside the root, so writing them is no revision.
      const marks = repo.runtimeDir;
      const edit = (n: number) => writeFileSync(join(repo.root, HOLD), holdTest(marks, n));
      edit(0);
      let running: RunningDaemon | null = null;
      onTestFinished(async () => {
        writeFileSync(join(marks, "release"), "");
        await running?.stop("stop-requested");
      });
      const daemon = await startDaemon({
        root: repo.root,
        env: repo.env,
        log: () => {},
        timings: { checkMs: 50 },
        runnerHost: SOURCE_LAUNCH,
      });
      if ("reason" in daemon) throw new Error(daemon.message);
      running = daemon;
      await daemon.ready;
      // Both baseline files, which need not end together (review 0.1.442 S2), before the kill.
      await waitFor(
        () => [HOLD, PLAIN].every((path) => outcomes(repo, path).includes("test pass")),
        120_000,
        "the first run of both files to pass",
      );
      const first = hostsOf("node-test");
      expect(first).toHaveLength(1);

      // The next run of the hold test holds; its host is killed during it.
      writeFileSync(join(marks, "hold"), "");
      edit(1);
      await waitFor(() => existsSync(join(marks, "started")), 120_000, "the hold test to start");
      const tier = withStore(repo, (store) =>
        store.runs
          .inFlight(repo.worktreeId, 0)
          .find((run) => run.testFiles.some((f) => f.path === HOLD)),
      );
      expect(tier).toBeDefined();
      expect(hostsOf("node-test")).toEqual(first);
      process.kill(first[0] ?? 0, "SIGKILL");
      await waitFor(
        () => withStore(repo, (store) => store.runs.get(tier?.id ?? "")?.end === "crashed"),
        60_000,
        "the killed host's tier to end crashed",
      );
      await waitFor(
        () => outcomes(repo, HOLD).includes("test unknown"),
        30_000,
        "the hold test unknown",
      );
      expect(readNotes(repo)).toContain(
        "the node-test runner host exited (signal SIGKILL); a new one starts at the next call",
      );

      // The next batch starts a new host, which runs the file again; this time it is released.
      writeFileSync(join(marks, "release"), "");
      edit(2);
      await waitFor(
        () => outcomes(repo, HOLD).includes("test pass"),
        120_000,
        "the hold test to pass",
      );
      const second = hostsOf("node-test");
      expect(second).toHaveLength(1);
      expect(second[0]).not.toBe(first[0]);

      await daemon.stop("stop-requested");
      running = null;
      await waitFor(
        () => hostsOf("node-test").length === 0,
        30_000,
        "the host to exit with the daemon",
      );
    },
  );
});
