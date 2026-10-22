import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stoppedMetaKey } from "../../src/core/delivery/stopped.js";
import { readCommandHolds } from "../../src/core/scheduler/hold-rows.js";
import { storePaths } from "../../src/core/store/index.js";
import { cancelled } from "../../src/runners/vitest/run.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  LOADED,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Row 011-74 (011 C9 as amended 2026-10-21, *Hold command*;
 * `tasks/011-61/design.md` R3, tests 1, 2, 3 and 5): `squeal hold -- <command>`
 * against a real daemon and its Vitest. The hold cancels the Vitest tier in
 * flight and starts none while the command runs; edits are recorded; the
 * queued work runs when the command exits, when its processes are gone at a
 * heartbeat, or at `squeal start`; a daemon started meanwhile starts on hold.
 */

const suite = daemonSuite();

/** A test that appends to `started-<name>` and sleeps until `release-<name>` exists. */
function heldTest(dir: string, name: string): string {
  const at = (file: string) => JSON.stringify(join(dir, `${file}-${name}`));
  return `import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("holds until released", async () => {
  appendFileSync(${at("started")}, "x");
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("release")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("release")})).toBe(true);
}, 170_000);
`;
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "sq-011-74-"));
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fixture whose `test/held.test.ts` runs until released, released after the test. */
function heldFixture(): { repo: FixtureRepo; starts: () => number } {
  const dir = scratch();
  const repo = suite.fixture({ "test/held.test.ts": heldTest(dir, "a") });
  suite.cleanup(() => writeFileSync(join(dir, "release-a"), ""));
  const started = join(dir, "started-a");
  return { repo, starts: () => (existsSync(started) ? readFileSync(started, "utf8").length : 0) };
}

/** `squeal hold <args>` in the fixture's root; killed after the test if it still runs. */
function holdCli(repo: FixtureRepo, args: readonly string[]): SpawnedProcess {
  const spawned = spawnCli(suite.cli, ["hold", ...args], { cwd: repo.root, env: repo.env });
  suite.cleanup(() => {
    if (spawned.child.exitCode === null && spawned.child.signalCode === null) {
      spawned.child.kill("SIGKILL");
    }
  });
  return spawned;
}

/** The run directories of the fixture's store, each written when its run ends. */
function runDirs(repo: FixtureRepo): string[] {
  const runs = storePaths(repo.commonDir).runsDir;
  return existsSync(runs) ? readdirSync(runs) : [];
}

/** The test files a tier runs now: their queue rows read `running` from its start. */
const running = (repo: FixtureRepo) =>
  withStore(repo, (store) =>
    store.testFileKeys
      .list(repo.worktreeId)
      .filter((row) => row.pending === "running")
      .map((row) => row.testFile.path),
  );

/** The Vitest runs cancelled with `cause`, from each run's `report.json` (row 011-56). */
function cancels(repo: FixtureRepo, cause: "hold"): number {
  const runs = storePaths(repo.commonDir).runsDir;
  return runDirs(repo).filter((id) => {
    const path = join(runs, id, "report.json");
    if (!existsSync(path)) return false;
    const { report } = JSON.parse(readFileSync(path, "utf8")) as {
      report: { failure: string | null };
    };
    return report.failure === cancelled(cause);
  }).length;
}

const revision = (repo: FixtureRepo) =>
  withStore(repo, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);

const holds = (repo: FixtureRepo) =>
  withStore(repo, (store) => readCommandHolds(store, repo.worktreeId));

/** The pid of the command the hold's entry records, once it records it. */
const commandPid = (repo: FixtureRepo) => holds(repo)[0]?.child?.pid ?? null;

/** An edit of a source file, whose revision the daemon records. */
async function editRecorded(repo: FixtureRepo): Promise<void> {
  const before = revision(repo);
  appendFileSync(join(repo.root, "src/math.ts"), `// edit ${Date.now()}\n`);
  await waitFor(() => revision(repo) > before || null, 30_000, "the edit's revision");
}

describe.runIf(process.platform === "linux")("squeal hold (row 011-74)", SLOW, () => {
  it("1: cancels the Vitest tier in flight, records an edit and starts nothing, runs the queue at the command's exit; exits 0, 7 and 143", async () => {
    const { repo, starts } = heldFixture();
    suite.daemon(repo);
    await waitFor(() => starts() > 0 || null, 150_000, "the held test started");

    const began = performance.now();
    const wrapper = holdCli(repo, ["--", "sleep", "4"]);
    await waitFor(() => wrapper.stderr().includes("is on hold") || null, 30_000, "the hold");
    const settled = performance.now() - began;
    console.log(`011-74: the hold settled ${Math.round(settled)} ms after the wrapper's spawn`);
    // Its line comes once the cancelled tier ended: the cancel is recorded by then.
    expect(cancels(repo, "hold")).toBe(1);
    if (!LOADED) expect(settled).toBeLessThan(4_000);

    expect(running(repo)).toEqual([]);
    await editRecorded(repo);
    await delay(1_000);
    expect(running(repo)).toEqual([]);
    expect(starts()).toBe(1);

    expect(await wrapper.exited).toEqual({ code: 0, signal: null });
    expect(holds(repo)).toEqual([]);
    await waitFor(() => starts() > 1 || null, 60_000, "the held test ran again");

    for (const [script, code] of [
      ["exit 7", 7],
      ["kill -TERM $$", 143],
    ] as const) {
      const other = holdCli(repo, ["--", "sh", "-c", script]);
      expect((await other.exited).code).toBe(code);
    }
    expect(holds(repo)).toEqual([]);
  });

  it("2: with its wrapper killed the hold holds until the command exits, and ends within one heartbeat after", async () => {
    const { repo } = heldFixture();
    const daemon = suite.daemon(repo);
    // Ready: an edit before its start scan would be its baseline, with no revision.
    await waitReady(repo, daemon);
    const wrapper = holdCli(repo, ["--", "sleep", "6"]);
    const pid = await waitFor(() => commandPid(repo), 30_000, "the command's entry");
    wrapper.child.kill("SIGKILL");
    await wrapper.exited;

    await editRecorded(repo).catch((error: Error) => {
      throw new Error(`${error.message}\n${diagnose(repo, daemon)}`);
    });
    await delay(1_000);
    expect(running(repo)).toEqual([]);
    expect(holds(repo)).toHaveLength(1);

    await waitFor(() => !existsSync(`/proc/${pid}`) || null, 15_000, "the command's exit");
    const exited = performance.now();
    await waitFor(() => holds(repo).length === 0 || null, 30_000, "the heartbeat's removal");
    if (!LOADED) expect(performance.now() - exited).toBeLessThan(6_000);
    expect(readNotes(repo)).toContain(
      `the hold for \`sleep 6\` (pid ${pid}) ended: its command is gone; validating again`,
    );
    await waitFor(
      () => running(repo).includes("test/math.test.ts") || null,
      60_000,
      "the edit's run",
    );
  });

  it("3: a daemon started after the last one was killed during a hold starts on hold, and resumes at the command's exit", async () => {
    const { repo, starts } = heldFixture();
    const first = suite.daemon(repo);
    await waitFor(() => starts() > 0 || null, 150_000, "the held test started");
    const wrapper = holdCli(repo, ["--", "sleep", "8"]);
    await waitFor(() => commandPid(repo), 30_000, "the command's entry");
    await waitFor(() => cancels(repo, "hold") > 0 || null, 30_000, "the hold's cancel");
    first.child.kill("SIGKILL");
    await first.exited;
    appendFileSync(join(repo.root, "src/math.ts"), "// edit while no daemon runs\n");

    suite.daemon(repo);
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "the next daemon serving");
    await delay(3_000);
    expect(starts()).toBe(1);

    expect(await wrapper.exited).toEqual({ code: 0, signal: null });
    await waitFor(() => starts() > 1 || null, 60_000, "the held test ran again");
  });

  it("5: `squeal start` ends the hold and the command runs on; `squeal stop` leaves the mark and the row, and the next daemon starts on hold", async () => {
    const { repo, starts } = heldFixture();
    suite.daemon(repo);
    await waitFor(() => starts() > 0 || null, 150_000, "the held test started");
    holdCli(repo, ["--", "sleep", "60"]);
    const pid = await waitFor(() => commandPid(repo), 30_000, "the command's entry");
    await waitFor(() => cancels(repo, "hold") > 0 || null, 30_000, "the hold's cancel");

    const start = spawnCli(suite.cli, ["start", repo.root], { cwd: "/", env: repo.env });
    expect(await start.exited).toEqual({ code: 0, signal: null });
    expect(start.stdout()).toContain(
      `Ended the hold for \`sleep 60\` (pid ${pid}); the command still runs\n`,
    );
    expect(holds(repo)).toEqual([]);
    await waitFor(() => starts() > 1 || null, 60_000, "the held test ran again");
    expect(existsSync(`/proc/${pid}`)).toBe(true);

    const second = holdCli(repo, ["--", "sleep", "60"]);
    await waitFor(() => holds(repo)[0]?.child ?? null, 30_000, "the second hold's entry");
    await waitFor(() => cancels(repo, "hold") > 1 || null, 30_000, "the second hold's cancel");
    const stop = spawnCli(suite.cli, ["stop", repo.root], { cwd: "/", env: repo.env });
    expect((await stop.exited).code).toBe(0);
    expect(holds(repo)).toHaveLength(1);
    expect(withStore(repo, (store) => store.meta.get(stoppedMetaKey(repo.worktreeId)))).not.toBe(
      null,
    );

    const ran = starts();
    suite.daemon(repo);
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "the next daemon serving");
    await delay(3_000);
    expect(starts()).toBe(ran);

    second.child.kill("SIGTERM");
    expect(await second.exited).toEqual({ code: 143, signal: null });
    await waitFor(() => starts() > ran || null, 60_000, "the held test ran after the hold");
  });
});
