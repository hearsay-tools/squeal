import { describe, expect, it } from "vitest";
import { readRunRemotes, remoteOf } from "../../../src/core/retry/remote.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import { claimRepo, fileName, side } from "../../scheduler/claims-fixture.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup } from "./lane-fixture.js";

/*
 * Row 026-28 (spec 026 D12, spec 001 D6): a remote lane's proven report
 * names the remote that ran it, a split names only its remote files, and the
 * scheduler keeps the remote of each file whose run stored a failure, per
 * run, in `failed-run-remotes`. A file that ran here keeps none.
 */

const GIT: TestFileRef = { project: "", path: "test/git.test.ts" };
const FILES = { "test/git.test.ts": "import '../src/a';\n" };
const VM = "agent37:eu:vm:l1l8w0bsw8";
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

describe("a remote lane's report names its remote (row 026-28)", () => {
  it("tags a proven remote run with the lane's target", async () => {
    const s = await setup();
    const report = await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(report.remote).toBe("box");
    expect(report.fileRemotes).toBeUndefined();
    expect(remoteOf(report, REF)).toBe("box");
  });

  it("tags only the remote files of a split with a file here", async () => {
    const s = await setup({ needsRepository: ["test/git.*"], files: FILES });
    const report = await s.lane.run([REF, GIT], background());
    expect(s.localFiles).toEqual([GIT.path]);
    expect(report.remote).toBeUndefined();
    expect(report.fileRemotes).toEqual([{ testFile: REF, remote: "box" }]);
    expect(remoteOf(report, REF)).toBe("box");
    expect(remoteOf(report, GIT)).toBeUndefined();
  });

  it("names no remote for a run here after the remote refused", async () => {
    const s = await setup({ refusal: "tests need python3; not found on PATH there" });
    const report = await s.lane.run([REF], background());
    expect(s.localFiles).toEqual([REF.path]);
    expect(report.remote).toBeUndefined();
    expect(report.fileRemotes).toBeUndefined();
  });
});

describe("the scheduler keeps a failing file's remote per run (row 026-28)", SLOW, () => {
  it("keeps the remote of a remote file's failure only: not a pass, not a failure here", async () => {
    const { main } = claimRepo(3);
    const [remoteFail, hereFail, remotePass] = [0, 1, 2].map((i) => ({
      project: "",
      path: fileName(i),
    })) as [TestFileRef, TestFileRef, TestFileRef];
    const b = side(main, { count: 3, policy: RUN_MISSING });
    b.runner.failing.add(remoteFail.path);
    b.runner.failing.add(hereFail.path);
    const run = b.runner.run.bind(b.runner);
    // A split: the first and third files ran on the remote, the second here.
    Object.assign(b.runner, {
      run: async (...args: Parameters<typeof run>): Promise<RunReport> => {
        const report = await run(...args);
        const remote = report.completedFiles.filter((f) => f.path !== hereFail.path);
        return { ...report, fileRemotes: remote.map((testFile) => ({ testFile, remote: VM })) };
      },
    });
    await b.scheduler.start();
    await b.quiet();

    // A first failure runs once more, so each failing run keeps it; the stored row is the last's.
    const stored = b.store.results.listForCheck(
      { kind: "test", project: "", testPath: remoteFail.path, fullName: "passes" },
      1,
    )[0];
    expect(stored?.outcome).toBe("fail");
    const passed = b.store.results.listForCheck(
      { kind: "test", project: "", testPath: remotePass.path, fullName: "passes" },
      1,
    )[0];
    expect(passed?.outcome).toBe("pass");
    const kept = readRunRemotes(b.store);
    expect([...kept.keys()]).toContain(stored?.provenance.runId);
    for (const files of kept.values()) expect(files).toEqual({ [`\0${remoteFail.path}`]: VM });
  });

  it("keeps none for a run here", async () => {
    const { main } = claimRepo(1);
    const b = side(main, { count: 1, policy: RUN_MISSING });
    b.runner.failing.add(fileName(0));
    await b.scheduler.start();
    await b.quiet();
    expect(b.runner.ran(fileName(0))).toBeGreaterThan(0);
    expect(readRunRemotes(b.store).size).toBe(0);
  });
});

describe("remoteOf (row 026-28)", () => {
  it("reads the file's own remote before the report's, and none for an untagged file", () => {
    const report: RunReport = {
      ...REPORT,
      completedFiles: [REF, GIT],
      fileRemotes: [{ testFile: GIT, remote: "vm-2" }],
    };
    expect(remoteOf(report, GIT)).toBe("vm-2");
    expect(remoteOf(report, REF)).toBeUndefined();
    expect(remoteOf({ ...REPORT, remote: "vm-1" }, REF)).toBe("vm-1");
    expect(remoteOf(REPORT, REF)).toBeUndefined();
  });
});
