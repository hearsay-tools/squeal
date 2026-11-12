import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keptLog, type RunLog } from "../../../src/core/code/gate/evidence.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";

/*
 * #197 (row 020-40): the collector offers a run's log folder to its keeper
 * only when a file the run was given failed or did not finish, and only
 * while the folder exists, before the temporary folder is removed.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REPORT = { end: "completed", durationMs: 10 } as RunLog["report"];

function file(path: string, completed: boolean, failed: readonly string[] = []): TestFileEvidence {
  return { runner: "vitest", path, completed, failed, skipped: false, loads: [], record: null };
}

/** A run with a log folder that exists, and a keeper that records what it was given. */
function setUp(report: RunLog["report"] | null = REPORT) {
  const logDir = mkdtempSync(join(tmpdir(), "squeal-kept-log-"));
  dirs.push(logDir);
  const given: RunLog[] = [];
  const keep = async (run: RunLog) => {
    given.push(run);
    return "/store/runs/gate-1";
  };
  const files = [{ project: "", path: "test/a.test.ts" }];
  return { run: { runner: "vitest" as const, files, logDir, report }, keep, given };
}

describe("keptLog: which runs keep their log (#197)", () => {
  it("keeps the log of a run with a failed test, or with a file that did not finish", async () => {
    for (const ran of [[file("a", true, ["adds"])], [file("a", true), file("b", false)]]) {
      const { run, keep, given } = setUp();
      expect(await keptLog(keep, run, ran)).toEqual({
        runner: "vitest",
        path: "/store/runs/gate-1",
      });
      expect(given).toEqual([run]);
    }
  });

  it("keeps nothing when every file completed with no failure", async () => {
    const { run, keep, given } = setUp();
    expect(await keptLog(keep, run, [file("a", true), file("b", true)])).toBeNull();
    expect(given).toEqual([]);
  });

  it("keeps nothing when the run did not start, wrote no folder, or the keeper kept none", async () => {
    const unfinished = [file("a", false)];
    const notStarted = setUp(null);
    expect(await keptLog(notStarted.keep, notStarted.run, unfinished)).toBeNull();
    expect(notStarted.given).toEqual([]);

    const noFolder = setUp();
    rmSync(noFolder.run.logDir, { recursive: true });
    expect(await keptLog(noFolder.keep, noFolder.run, unfinished)).toBeNull();
    expect(noFolder.given).toEqual([]);

    const { run } = setUp();
    expect(await keptLog(async () => null, run, unfinished)).toBeNull();
    expect(await keptLog(undefined, run, unfinished)).toBeNull();
  });
});
