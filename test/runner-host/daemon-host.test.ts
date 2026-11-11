import { existsSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { getPriority } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { TEST_NICE } from "../../src/core/daemon/low-priority.js";
import { childrenOf } from "../../src/core/daemon/terminate.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  readNotes,
  SLOW,
  suiteCli,
  waitFor,
  withStore,
} from "../daemon/helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";

/*
 * Spec 021 D7, D8 (row 021-11), against a real daemon in this process with
 * `runnerHost` set and a real `squeal runner-host` of a build of `src`: the
 * daemon's Vitest tiers run in a host, its child, whose working directory is
 * the root. A host killed during a tier ends that tier `crashed`, its checks
 * `unknown`, with a note; the next batch starts a new host, which runs them.
 * The daemon's stop ends its host.
 */

const built = suiteCli();
const HOLD = "test/hold.test.ts";

/**
 * A test that, while `dir/hold` exists, marks its start in `dir` and waits
 * there for `dir/release`, up to a minute; else it passes at once.
 */
const holdTest = (dir: string, edit = 0) => `import { existsSync, writeFileSync } from "node:fs";
import { it } from "vitest";
it("holds until released", async () => {
  if (!existsSync(${JSON.stringify(join(dir, "hold"))})) return;
  writeFileSync(${JSON.stringify(join(dir, "started"))}, String(process.pid));
  for (let i = 0; i < 600 && !existsSync(${JSON.stringify(join(dir, "release"))}); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
// edit ${edit}
`;

/** The runner hosts this process started for `root`: pid and working directory. */
function hosts(root: string): { pid: number; cwd: string }[] {
  return childrenOf(process.pid).flatMap((pid) => {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "latin1").split("\0");
      if (!args.includes("runner-host") || !args.includes(root)) return [];
      return [{ pid, cwd: readlinkSync(`/proc/${pid}/cwd`) }];
    } catch {
      return [];
    }
  });
}

/** The outcome of each known check of the file at `path`, by kind, the file's own included. */
const outcomes = (repo: FixtureRepo, path: string) =>
  withStore(repo, (store) =>
    store.knownStates
      .list(repo.worktreeId)
      .filter((s) => s.check.testPath === path)
      .map((s) => `${s.check.kind} ${s.outcome}`)
      .sort(),
  );

describe.runIf(process.platform === "linux")("a daemon with a runner host", SLOW, () => {
  it("runs its tiers in a host, and replaces a host killed during a tier", async () => {
    const repo = createFixtureRepo({
      files: { "squeal.config.json": runMissingConfig(), [HOLD]: holdTest("/nonexistent") },
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
      runnerHost: { execPath: process.execPath, cli: built().cli },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    running = daemon;
    await daemon.ready;
    await waitFor(
      () => outcomes(repo, HOLD).includes("test pass"),
      120_000,
      "the first run to pass",
    );
    expect(outcomes(repo, "test/plain.test.ts")).toContain("test pass");
    // The host waits for its workers before it answers, so the daemon's sweep finds none.
    expect(readNotes(repo).filter((note) => note.includes("left running"))).toEqual([]);
    const first = hosts(repo.root);
    expect(first).toEqual([{ pid: expect.any(Number), cwd: repo.root }]);

    // The next run of the hold test holds; its host is killed during it.
    writeFileSync(join(marks, "hold"), "");
    edit(1);
    await waitFor(() => existsSync(join(marks, "started")), 120_000, "the hold test to start");
    // The host lowers its workers as the daemon lowered its own (001 D11 Priority).
    const worker = Number(readFileSync(join(marks, "started"), "utf8"));
    await waitFor(() => getPriority(worker) === TEST_NICE, 10_000, "the worker at nice 10");
    const tier = withStore(repo, (store) =>
      store.runs
        .inFlight(repo.worktreeId, 0)
        .find((run) => run.testFiles.some((f) => f.path === HOLD)),
    );
    expect(tier).toBeDefined();
    const killed = hosts(repo.root)[0]?.pid ?? 0;
    expect(killed).toBe(first[0]?.pid);
    process.kill(killed, "SIGKILL");
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
      "the vitest runner host exited (signal SIGKILL); a new one starts at the next call",
    );

    // The next batch starts a new host, which runs the file again; this time it is released.
    writeFileSync(join(marks, "release"), "");
    edit(2);
    await waitFor(
      () => outcomes(repo, HOLD).includes("test pass"),
      120_000,
      "the hold test to pass",
    );
    const second = hosts(repo.root);
    expect(second).toEqual([{ pid: expect.any(Number), cwd: repo.root }]);
    expect(second[0]?.pid).not.toBe(killed);

    await daemon.stop("stop-requested");
    running = null;
    await waitFor(() => hosts(repo.root).length === 0, 30_000, "the host to exit with the daemon");
  });
});
