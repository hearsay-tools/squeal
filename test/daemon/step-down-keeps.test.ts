import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { resume, stoppedItself, testPause } from "../e2e/restart-evidence.js";
import {
  daemonSuite,
  delay,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  spawnCli,
  waitFor,
  withStore,
} from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Row 011-137 (`tasks/011-137/notes.md`): what a step-down's cancelled tier
 * leaves. After a first full run, an edit's tier of three files runs in an
 * older daemon under `lookup-only` when newer hooks arrive: one file has
 * ended, one holds its module open in `afterAll` until just after the
 * cancel, and one is running a test. The first two keep the results the old
 * daemon stored, the second
 * by the grace rule (`endedWhole`). The third is handed over, and the
 * successor runs it and nothing else: no lookup-only miss, no finished file.
 *
 * The old daemon stops itself between its store's close and its lock
 * release (`testPause("stop-gap")`, task 001-355), so the test reads what it
 * stored before the successor takes over.
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, sockets, hookDeps, hook, exitWithin } = stepDownKit(suite);
const STOP_GAP = testPause("stop-gap");
const STEP_DOWN_WITHIN_MS = 15_000;
const FINISHED = "test/finished.test.ts";
const WHOLE = "test/whole.test.ts";
const CUT = "test/cut.test.ts";

/** Polls `flag` every 10 ms, for at most `ms`, until `exists` says it is. */
const until = (flag: string, exists: boolean, ms: number) => `{
  const deadline = Date.now() + ${ms};
  while (existsSync(${JSON.stringify(flag)}) !== ${exists} && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 10));
  }
}`;

/** The fixture's files; markers and flags live in `dir`. */
function files(dir: string): Record<string, string> {
  const at = (name: string) => JSON.stringify(join(dir, name));
  const fs = 'import { existsSync, writeFileSync } from "node:fs";';
  return {
    // Each file of the tier starts at once: an edit's tier runs at the project's own width.
    "vitest.config.ts": `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, maxWorkers: 3 } });
`,
    "squeal.config.json": `${JSON.stringify({ baseline: { onStart: "lookup-only" } })}\n`,
    [FINISHED]: `${fs}
import { it } from "vitest";
it("ends", () => writeFileSync(${at("finished")}, ""));
`,
    // Its test passes; under the hold the module ends once `release` exists, after the cancel.
    [WHOLE]: `${fs}
import { afterAll, it } from "vitest";
it("passes", () => {});
afterAll(async () => {
  if (!existsSync(${at("hold")})) return;
  writeFileSync(${at("whole")}, "");
  ${until(join(dir, "release"), true, 30_000)}
});
`,
    // Running at the cancel, so the cancel skips it; in the successor it passes once `hold` is gone.
    [CUT]: `${fs}
import { expect, it } from "vitest";
it("waits for the hold to end", async () => {
  writeFileSync(${at("cut")}, "");
  ${until(join(dir, "hold"), false, 120_000)}
  expect(existsSync(${at("hold")})).toBe(false);
}, 150_000);
`,
  };
}

/** Each run of the worktree, oldest first: its id and test files. */
function runs(repo: FixtureRepo): { id: string; files: string[] }[] {
  const db = new DatabaseSync(storePaths(repo.commonDir).database, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT id, test_files FROM runs WHERE worktree_id = ? ORDER BY started_at, rowid")
      .all(repo.worktreeId) as { id: string; test_files: string }[];
    return rows.map((row) => ({
      id: row.id,
      files: (JSON.parse(row.test_files) as { path: string }[]).map((f) => f.path).sort(),
    }));
  } finally {
    db.close();
  }
}

/** The test files whose results run `runId` stored, sorted. */
function storedBy(repo: FixtureRepo, runId: string): string[] {
  const db = new DatabaseSync(storePaths(repo.commonDir).database, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT c.test_path AS path FROM results r JOIN checks c ON c.id = r.check_id
         WHERE r.run_id = ? ORDER BY 1`,
      )
      .all(runId) as { path: string }[];
    return rows.map((row) => row.path);
  } finally {
    db.close();
  }
}

/** Each test file's checks as the worktree knows them: `outcome/validity` by check, sorted. */
function states(repo: FixtureRepo, path: string): string[] {
  return withStore(repo, (store) =>
    store.knownStates
      .list(repo.worktreeId)
      .filter((s) => s.check.testPath === path)
      .map((s) => `${s.check.kind}:${s.outcome}/${s.validity}`)
      .sort(),
  );
}

describe.runIf(process.platform === "linux")(
  "a step-down's cancelled tier (row 011-137)",
  SLOW,
  () => {
    it("keeps what its tier finished, and the successor runs only the file it cut", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-011-137-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      const marker = (name: string) => join(dir, name);
      const repo = suite.fixture(files(dir));
      const squeal = (...args: string[]) =>
        spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
      const old = start(buildAt("0.1.0"), repo, [], STOP_GAP);
      const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.0 serving");
      expect(first.squealVersion).toBe("0.1.0");
      expect((await squeal("run", "--all", "--wait").exited).code).toBe(0);
      for (const name of ["finished", "whole", "cut"]) rmSync(marker(name), { force: true });
      const earlier = runs(repo).length;

      // One edit's tier of the three files: lookup-only queues nothing else.
      writeFileSync(marker("hold"), "");
      for (const path of [FINISHED, WHOLE, CUT]) appendFileSync(join(repo.root, path), "// edit\n");
      await waitFor(
        () => ["finished", "whole", "cut"].every((name) => existsSync(marker(name))),
        120_000,
        "the tier's three files started, the first ended",
      );
      // The first file's end reaches the daemon before the cancel.
      await delay(1_000);

      const ensured: EnsureDaemonResult[] = [];
      sockets.push(repo.socketPath);
      // The daemon writes its step-down note after it cancelled: `afterAll` ends in the grace.
      const released = waitFor(
        () => readNotes(repo).some((n) => /are newer than this daemon \(0\.1\.0\)/.test(n)),
        STEP_DOWN_WITHIN_MS,
        "the step-down's note",
      ).then(() => writeFileSync(marker("release"), ""));
      await hook("session-start", repo, hookDeps(repo, ensured));
      expect(ensured).toEqual(["spawned"]);
      await released;

      expect(await stoppedItself(first.pid, STEP_DOWN_WITHIN_MS)).toBe(true);
      let cancelled: { id: string; files: string[] } | undefined;
      try {
        const before = runs(repo).slice(earlier);
        expect(before.map((r) => r.files)).toEqual([[CUT, FINISHED, WHOLE]]);
        cancelled = before[0];
        if (cancelled === undefined) throw new Error("no run");
        // What ended keeps its result; the file the cancel cut is handed over.
        expect(storedBy(repo, cancelled.id)).toEqual([FINISHED, WHOLE]);
        const pending = withStore(repo, (store) =>
          store.testFileKeys
            .list(repo.worktreeId)
            .filter((r) => [FINISHED, WHOLE, CUT].includes(r.testFile.path))
            .map((r) => [r.testFile.path, r.pending])
            .sort(),
        );
        expect(pending).toEqual([
          [CUT, "queued"],
          [FINISHED, null],
          [WHOLE, null],
        ]);
      } finally {
        resume(first.pid);
      }
      expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });
      rmSync(marker("hold"));

      await waitFor(
        async () => (await ping(repo.socketPath, 500))?.squealVersion === HOOKS,
        60_000,
        "the successor serving",
      );
      await waitFor(
        () => states(repo, CUT).join() === "file:pass/current,test:pass/current",
        120_000,
        "the cut file's result in the successor",
      );
      // The successor ran the cut file alone: no new pick, no finished file again.
      const after = runs(repo).slice(earlier);
      expect(after.map((r) => r.files)).toEqual([[CUT, FINISHED, WHOLE], [CUT]]);
      expect(storedBy(repo, cancelled.id)).toEqual([FINISHED, WHOLE]);
      for (const path of [FINISHED, WHOLE]) {
        expect(states(repo, path)).toEqual(["file:pass/current", "test:pass/current"]);
      }
    });
  },
);
