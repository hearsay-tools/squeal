import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, ENV, options, REF, setup } from "./lane-fixture.js";

/*
 * Spec 021 D11 to D13 (row 021-14): the lane sends background runs to the
 * remote and keeps a result only over a proven tree and an equal
 * environment; a refusal sends the files again and retries once; a lost or
 * hung host ends its attempt incomplete, and the policy decides what follows.
 * The host is served in this process over a real proxy and tree host.
 */

describe("a remote lane (row 021-14)", () => {
  it("runs a background tier on the remote, proven, and every other run here", async () => {
    const s = await setup();
    await s.lane.run([REF], options());
    await s.lane.run([REF], background({ lane: "slow:vitest" }));
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(2);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(s.remoteRuns).toEqual(["test/a.test.ts"]);
    expect(s.statuses.at(-1)).toMatch(/^remote box: background runs of vitest go there; proven at/);
    expect(report).not.toHaveProperty("proof");
  });

  it("refuses a tree that differs before the run, sends the files again, and runs the retry", async () => {
    const s = await setup();
    writeFileSync(join(s.remoteRoot, "src/a.ts"), "drifted\n");
    await s.lane.run([REF], background());
    expect(s.logs).toContain("remote box: tree differs at src/a.ts; sending again");
    expect(readFileSync(join(s.remoteRoot, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localRuns).toHaveLength(0);
  });

  it("keeps no result of a run whose tree moved during it, twice: it runs here", async () => {
    const s = await setup({
      remoteRun: async (remoteRoot) => {
        writeFileSync(join(remoteRoot, "src/a.ts"), `moved ${Math.random()}\n`);
        return REPORT;
      },
    });
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(2);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toBe(
      "remote box: refused a run whose tree stayed different; ran it here",
    );
  });

  it("refuses a remote whose environment differs, and names the difference", async () => {
    const s = await setup({ remoteEnv: { ...ENV, runnerVersion: "5.0.2" } });
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toMatch(
      /^remote box refused: .*5\.0\.2 on the remote, 5\.0\.3 here; running here$/,
    );
  });

  it("ends a hung remote's attempt within its deadline, runs its files here, and reconnects later", async () => {
    const s = await setup({
      deadlines: { aliveMs: 200 },
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    const started = Date.now();
    const report = await s.lane.run([REF], background());
    // Review 0.1.442 B4: under `local`, the lost attempt's files run here at once.
    expect(report.end).toBe("completed");
    expect(s.localRuns).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(s.statuses.at(-1)).toMatch(
      /^remote box unreachable since .* \(the vitest runner host did not answer run, nor tell it is alive, within 200 ms; Squeal stopped it\); running here$/,
    );
    await s.lane.run([REF], background());
    expect(s.localRuns).toHaveLength(2);
    expect(s.connects).toHaveLength(1);
    s.advance(60_000);
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(2);
  });

  it("ends a lost remote's run unknown under whenLost not-run, and counts its files", async () => {
    const s = await setup({
      whenLost: "not-run",
      deadlines: { aliveMs: 200 },
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    const lost = await s.lane.run([REF], background());
    expect(lost.end).toBe("timed-out");
    // Row 026-23: in the backoff nothing connects, so the next run does not wait for one.
    expect(lost.completedFiles).toEqual([]);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("crashed");
    expect(report.failure).toBe('remote box unreachable; not run here (whenLost "not-run")');
    expect(s.localRuns).toHaveLength(0);
    expect(s.statuses.at(-1)).toMatch(/unreachable since .*; 2 files not run$/);
  });

  // Row 026-20 (lessons D3): a reachable remote that refused says so, never "unreachable".
  it("says refused, with its reason, when a reachable remote refused a run under whenLost not-run", async () => {
    const s = await setup({
      whenLost: "not-run",
      remoteRun: async (remoteRoot) => {
        writeFileSync(join(remoteRoot, "src/a.ts"), `moved ${Math.random()}\n`);
        return REPORT;
      },
    });
    const report = await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(2);
    expect(s.localRuns).toHaveLength(0);
    expect(report.failure).toBe(
      'remote box refused (its tree stayed different at src/a.ts); not run here (whenLost "not-run")',
    );
  });

  it("says refused, with the difference, for a remote whose environment differs under whenLost not-run", async () => {
    const s = await setup({ whenLost: "not-run", remoteEnv: { ...ENV, runnerVersion: "5.0.2" } });
    const report = await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([]);
    expect(report.failure).toMatch(
      /^remote box refused \(.*5\.0\.2 on the remote, 5\.0\.3 here.*\); not run here \(whenLost "not-run"\)$/,
    );
    expect(report.failure).not.toMatch(/unreachable/);
  });

  // Row 026-23: under not-run a run waits for a connect or a wake in flight, as under awaitConnect.
  it("waits for a reconnect under whenLost not-run and runs there once it is ready", async () => {
    const s = await setup({ whenLost: "not-run", eager: false });
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([REF]);
    expect(s.connects).toHaveLength(1);
    expect(s.remoteRuns).toEqual(["test/a.test.ts"]);
    expect(s.localRuns).toHaveLength(0);
    // A machine asleep wakes at the next run, which waits for it too.
    expect(await s.lane.sleep(async () => {})).toBe("slept");
    const woken = await s.lane.run([REF], background());
    expect(woken.completedFiles).toEqual([REF]);
    expect(s.connects).toHaveLength(2);
    expect(s.remoteRuns).toHaveLength(2);
  });

  it("ends a run cancelled while it waits for the connect not started under whenLost not-run", async () => {
    const s = await setup({ whenLost: "not-run", eager: false });
    const report = await s.lane.run([REF], background({ signal: AbortSignal.abort("edit") }));
    expect(report).toEqual({
      end: "completed",
      durationMs: 0,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: "cancelled while it waited for permits",
    });
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(0);
    expect(s.statuses.filter((line) => /not run$/.test(line))).toEqual([]);
  });

  it("still runs here at once while connecting under whenLost local", async () => {
    const s = await setup({ eager: false });
    const report = await s.lane.run([REF], background());
    expect(report.completedFiles).toEqual([REF]);
    expect(s.localRuns).toHaveLength(1);
    expect(s.remoteRuns).toEqual([]);
  });
});

/*
 * Row 026-24 (gh-280): the proof holds file by file. A local git-ignored
 * input is never sent (021 D10), so only the files that read it are
 * refused, at once; their siblings keep the remote's results.
 */
describe("a remote lane's proof, file by file (row 026-24)", () => {
  const A = REF;
  const B = { project: "", path: "test/b.test.ts" };
  const C = { project: "", path: "test/c.test.ts" };
  const TIER = [A, B, C];
  const paths = (report: RunReport) => report.completedFiles.map((f) => f.path).sort();
  const IGNORED =
    'remote box refused (git-ignored input dist/index.html exists locally and is not synced to remote); not run here (whenLost "not-run")';

  /** A local tree with three test files and an ignored `dist/`, which the remote never gets. */
  const tree = {
    files: {
      ".gitignore": "dist/\n",
      "test/b.test.ts": "import '../src/b';\n",
      "test/c.test.ts": "import '../src/a';\n",
      "src/b.ts": "export const b = 1;\n",
    },
    before: (root: string) => {
      mkdirSync(join(root, "dist"));
      writeFileSync(join(root, "dist/index.html"), "<html>built here</html>\n");
      writeFileSync(join(root, "dist/hsq.js"), "built here\n");
    },
  };
  const closure =
    (extra: Readonly<Record<string, readonly string[]>> = {}) =>
    (file: TestFileRef) => [
      file.path,
      file.path === B.path ? "src/b.ts" : "src/a.ts",
      ...(extra[file.path] ?? []),
    ];
  /**
   * The remote's report of the files it ran (the fixture's last remote run),
   * what each observed, and a coverage record each, which the host's reply carries.
   */
  const ranThere =
    (runs: () => readonly string[], observed: Readonly<Record<string, readonly string[]>>) =>
    async (): Promise<RunReport> => {
      const files = (runs().at(-1) ?? "").split(",").map((path) => ({ project: "", path }));
      return {
        ...REPORT,
        completedFiles: files,
        observed: files.map((testFile) => ({
          testFile,
          paths: [...(observed[testFile.path] ?? [])],
          directories: [],
        })),
        coverage: files.map((testFile) => ({ testFile, record: testFile.path })),
      } as RunReport;
    };

  it("keeps the siblings of a file that observed a git-ignored input, runs once, and leaves only it not run", async () => {
    let runs: () => readonly string[] = () => [];
    const s = await setup({
      ...tree,
      whenLost: "not-run",
      closure: closure(),
      remoteRun: () => ranThere(runs, { [B.path]: ["dist/index.html"] })(),
    });
    runs = () => s.remoteRuns;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toEqual(["test/a.test.ts,test/b.test.ts,test/c.test.ts"]);
    expect(s.localRuns).toHaveLength(0);
    expect(report.end).toBe("completed");
    expect(paths(report)).toEqual(["test/a.test.ts", "test/c.test.ts"]);
    expect(report.observed?.map((o) => o.testFile)).toEqual([A, C]);
    expect(report.failure).toBe(IGNORED);
    expect(report).not.toHaveProperty("coverage");
    // D9: the proven siblings' records alone.
    expect(s.coverage.flatMap((c) => c.records.map((r) => r.testFile.path))).toEqual([
      "test/a.test.ts",
      "test/c.test.ts",
    ]);
    expect(s.logs.filter((line) => /sending again/.test(line))).toEqual([]);
    expect(s.statuses.at(-1)).toBe(
      "remote box: refused 1 files whose git-ignored inputs are not synced; not run",
    );
  });

  it("runs only the file that observed a git-ignored input here under whenLost local", async () => {
    let runs: () => readonly string[] = () => [];
    const s = await setup({
      ...tree,
      closure: closure(),
      remoteRun: () => ranThere(runs, { [B.path]: ["dist/index.html"] })(),
    });
    runs = () => s.remoteRuns;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localFiles).toEqual(["test/b.test.ts"]);
    expect(paths(report)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
    expect(report.failure).toBeNull();
    expect(s.coverage.flatMap((c) => c.records.map((r) => r.testFile.path))).toEqual([
      "test/a.test.ts",
      "test/c.test.ts",
    ]);
  });

  it("isolates a file whose closure holds a git-ignored input before the run, and runs its siblings there", async () => {
    let runs: () => readonly string[] = () => [];
    const s = await setup({
      ...tree,
      closure: closure({ [B.path]: ["dist/hsq.js"] }),
      remoteRun: () => ranThere(runs, {})(),
    });
    runs = () => s.remoteRuns;
    const report = await s.lane.run(TIER, background());
    // The host refused the first attempt before it ran; the second, without b, ran.
    expect(s.remoteRuns).toEqual(["test/a.test.ts,test/c.test.ts"]);
    expect(s.localFiles).toEqual(["test/b.test.ts"]);
    expect(paths(report)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
    expect(s.logs).toContain(
      "remote box: git-ignored input dist/hsq.js exists locally and is not synced to remote; refused test/b.test.ts",
    );
    expect(s.logs.filter((line) => /sending again/.test(line))).toEqual([]);
    expect(existsSync(join(s.remoteRoot, "dist/hsq.js"))).toBe(false);
  });

  it("fails closed when no file of the tier holds the differing path", async () => {
    let runs: () => readonly string[] = () => [];
    const s = await setup({
      ...tree,
      whenLost: "not-run",
      closure: closure(),
      // Observed by a file outside the tier: nothing attributes the path, so it taints all.
      remoteRun: async () => ({
        ...(await ranThere(runs, {})()),
        observed: [
          {
            testFile: { project: "", path: "test/z.test.ts" },
            paths: ["dist/index.html"],
            directories: [],
          },
        ],
      }),
    });
    runs = () => s.remoteRuns;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(report.completedFiles).toEqual([]);
    expect(report.failure).toBe(IGNORED);
  });

  it("retries only the file a tracked difference taints, and keeps its siblings' first results", async () => {
    let runs: () => readonly string[] = () => [];
    let moves = 1;
    const s = await setup({
      ...tree,
      closure: closure(),
      remoteRun: async (remoteRoot) => {
        if (moves-- > 0) writeFileSync(join(remoteRoot, "src/b.ts"), "moved\n");
        return ranThere(runs, {})();
      },
    });
    runs = () => s.remoteRuns;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toEqual([
      "test/a.test.ts,test/b.test.ts,test/c.test.ts",
      "test/b.test.ts",
    ]);
    expect(s.logs).toContain("remote box: tree differs at src/b.ts; sending again");
    expect(s.localRuns).toHaveLength(0);
    expect(paths(report)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
  });

  it("names a tracked difference that stayed after the retry, and keeps the proven siblings under whenLost not-run", async () => {
    let runs: () => readonly string[] = () => [];
    const s = await setup({
      ...tree,
      whenLost: "not-run",
      closure: closure(),
      remoteRun: async (remoteRoot) => {
        writeFileSync(join(remoteRoot, "src/b.ts"), `moved ${Math.random()}\n`);
        return ranThere(runs, {})();
      },
    });
    runs = () => s.remoteRuns;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(2);
    expect(paths(report)).toEqual(["test/a.test.ts", "test/c.test.ts"]);
    expect(report.failure).toBe(
      'remote box refused (its tree stayed different at src/b.ts); not run here (whenLost "not-run")',
    );
    expect(s.statuses.at(-1)).toBe(
      "remote box: refused a run whose tree stayed different; not run",
    );
  });

  it("treats a file deleted here as one a resend repairs: removed there, then run", async () => {
    let runs: () => readonly string[] = () => [];
    const s = await setup({
      ...tree,
      files: { ...tree.files, "src/gone.ts": "export const gone = 1;\n" },
      closure: closure({ [B.path]: ["src/gone.ts"] }),
      remoteRun: () => ranThere(runs, {})(),
    });
    runs = () => s.remoteRuns;
    // The connect sent it; deleted here since, unseen, it stays there.
    expect(existsSync(join(s.remoteRoot, "src/gone.ts"))).toBe(true);
    rmSync(join(s.root, "src/gone.ts"));
    const report = await s.lane.run(TIER, background());
    expect(s.logs).toContain("remote box: tree differs at src/gone.ts; sending again");
    expect(existsSync(join(s.remoteRoot, "src/gone.ts"))).toBe(false);
    expect(s.remoteRuns).toEqual(["test/a.test.ts,test/b.test.ts,test/c.test.ts"]);
    expect(s.localRuns).toHaveLength(0);
    expect(paths(report)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
  });
});
