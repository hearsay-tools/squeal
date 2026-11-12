import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type EndedRun, keptLogs, type RunLog } from "../../../src/core/code/gate/evidence.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * #197 (row 020-40): the collector offers a runner kind's log folders to its
 * keeper as one, only those of runs with a file that failed or did not
 * finish, and only while the folders exist, before the temporary folder is
 * removed. node:test has one run per project, so one kind can offer several.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const report = (end: RunReport["end"], durationMs: number) => ({ end, durationMs }) as RunReport;

function file(path: string, completed: boolean, failed: readonly string[] = []): TestFileEvidence {
  return { runner: "vitest", path, completed, failed, skipped: false, loads: [], record: null };
}

/** A run of `runner` that wrote a log folder, `ran` its files' evidence. */
function ended(
  runner: EndedRun["runner"],
  ran: readonly TestFileEvidence[],
  end: RunReport | null = report("completed", 10),
): EndedRun {
  const logDir = mkdtempSync(join(tmpdir(), "squeal-kept-log-"));
  dirs.push(logDir);
  const files = ran.map((f) => ({ project: "", path: f.path }));
  return { runner, files, logDir, report: end, ran };
}

/** A keeper that records what it was given and keeps each at `/store/runs/gate-<n>`. */
function keeper() {
  const given: RunLog[] = [];
  const keep = async (run: RunLog) => {
    given.push(run);
    return `/store/runs/gate-${given.length}`;
  };
  return { keep, given };
}

describe("keptLogs: which runs keep their log (#197)", () => {
  it("keeps the log of a run with a failed test, or with a file that did not finish", async () => {
    for (const ran of [[file("a", true, ["adds"])], [file("a", true), file("b", false)]]) {
      const { keep, given } = keeper();
      const run = ended("vitest", ran);
      expect(await keptLogs(keep, [run])).toEqual([
        { runner: "vitest", path: "/store/runs/gate-1" },
      ]);
      expect(given).toEqual([
        { runner: "vitest", files: run.files, logDirs: [run.logDir], report: run.report },
      ]);
    }
  });

  it("keeps nothing when every file completed with no failure", async () => {
    const { keep, given } = keeper();
    expect(await keptLogs(keep, [ended("vitest", [file("a", true), file("b", true)])])).toEqual([]);
    expect(given).toEqual([]);
  });

  it("keeps nothing when the run did not start, wrote no folder, or the keeper kept none", async () => {
    const unfinished = [file("a", false)];
    const { keep, given } = keeper();
    expect(await keptLogs(keep, [ended("vitest", unfinished, null)])).toEqual([]);
    const noFolder = ended("vitest", unfinished);
    rmSync(noFolder.logDir, { recursive: true });
    expect(await keptLogs(keep, [noFolder])).toEqual([]);
    expect(given).toEqual([]);

    expect(await keptLogs(async () => null, [ended("vitest", unfinished)])).toEqual([]);
    expect(await keptLogs(undefined, [ended("vitest", unfinished)])).toEqual([]);
  });

  it("keeps one log per runner kind: each node:test project's failed run, merged", async () => {
    const { keep, given } = keeper();
    const vitest = ended("vitest", [file("v", true, ["adds"])]);
    const unit = ended("node-test", [file("u", true, ["names"])], report("completed", 10));
    const passed = ended("node-test", [file("p", true)]);
    const e2e = ended("node-test", [file("e", false)], report("timed-out", 30));

    const logs = await keptLogs(keep, [vitest, unit, passed, e2e]);

    // One entry per kind, as the report has one `runs` entry per kind.
    expect(logs).toEqual([
      { runner: "vitest", path: "/store/runs/gate-1" },
      { runner: "node-test", path: "/store/runs/gate-2" },
    ]);
    // The passing project's run offers nothing; the others' ends and durations combine.
    expect(given[1]).toEqual({
      runner: "node-test",
      files: [...unit.files, ...e2e.files],
      logDirs: [unit.logDir, e2e.logDir],
      report: { end: "timed-out", durationMs: 40 },
    });
  });
});
