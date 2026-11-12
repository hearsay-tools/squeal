import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
 * Spec 021 D20 (row 021-26), against a real daemon with `runnerHost` and a
 * real node:test runner host from the sources: a host with no call for the
 * idle time closes and its process exits. The next edit starts a new host,
 * which runs the edited file only: no check is `unknown`, no note is
 * written, and the unchanged file does not run again.
 */

const IDLE_MS = 2_000;
const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const A = "nt/test/a.test.mjs";
const B = "nt/test/b.test.mjs";
const SOURCE = "nt/src/b.mjs";

/** A test that appends a line to `mark` at each run, and checks `../src/b.mjs` when `imports`. */
const countingTest = (mark: string, imports: boolean) => `import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { test } from "node:test";
${imports ? 'import { b } from "../src/b.mjs";' : "const b = 1;"}
test("counts", () => {
  appendFileSync(${JSON.stringify(mark)}, "run\\n");
  assert.ok(b > 0);
});
`;

const runs = (mark: string) =>
  existsSync(mark) ? readFileSync(mark, "utf8").split("\n").length - 1 : 0;

/** The outcome of each known check of the file at `path`, by kind, the file's own included. */
const outcomes = (repo: FixtureRepo, path: string) =>
  withStore(repo, (store) =>
    store.knownStates
      .list(repo.worktreeId)
      .filter((s) => s.check.testPath === path)
      .map((s) => `${s.check.kind} ${s.outcome}`)
      .sort(),
  );

describe.runIf(process.platform === "linux")("an idle runner host (spec 021 D20)", SLOW, () => {
  it("closes when idle, and the next edit reruns only its file in a new host", async () => {
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": runMissingConfig(JSON.stringify({ nodeTest: [NT] })),
        [A]: "",
        [B]: "",
        [SOURCE]: "export const b = 1;\n",
      },
    });
    onTestFinished(repo.cleanup);
    // The marks live outside the root, so writing them is no revision.
    const markA = join(repo.runtimeDir, "a");
    const markB = join(repo.runtimeDir, "b");
    writeFileSync(join(repo.root, A), countingTest(markA, false));
    writeFileSync(join(repo.root, B), countingTest(markB, true));
    let running: RunningDaemon | null = null;
    onTestFinished(async () => {
      await running?.stop("stop-requested");
    });
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      log: () => {},
      timings: { checkMs: 50 },
      runnerHost: SOURCE_LAUNCH,
      hostIdleMs: IDLE_MS,
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    running = daemon;
    await daemon.ready;
    await waitFor(
      () => [A, B].every((path) => outcomes(repo, path).includes("test pass")),
      120_000,
      "the first run of both files to pass",
    );

    // No call for the idle time: the host closes and its process exits.
    await waitFor(() => hostsOf("node-test").length === 0, 60_000, "the idle host to exit");
    const notes = readNotes(repo);
    const before = { a: runs(markA), b: runs(markB) };
    expect(before).toEqual({ a: 1, b: 1 });

    writeFileSync(join(repo.root, SOURCE), "export const b = 2;\n");
    await waitFor(() => runs(markB) === 2, 120_000, "the edited file to run in a new host");
    await waitFor(
      () => withStore(repo, (store) => store.runs.inFlight(repo.worktreeId, 0)).length === 0,
      60_000,
      "the edit's tier to end",
    );
    for (const path of [A, B]) {
      expect(outcomes(repo, path)).toContain("test pass");
      expect(outcomes(repo, path).filter((o) => !o.endsWith(" pass"))).toEqual([]);
    }
    expect(runs(markA)).toBe(1);
    expect(readNotes(repo)).toEqual(notes);

    await daemon.stop("stop-requested");
    running = null;
    await waitFor(() => hostsOf("node-test").length === 0, 30_000, "no host after the stop");
  });
});
