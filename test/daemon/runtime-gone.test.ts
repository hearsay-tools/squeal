import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { interruptedMetaKey } from "../../src/core/scheduler/interrupted.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";
import { testBuildDir } from "./strays.js";

/*
 * Row 011-106 (gh-72 and gh-70; spec 011 C9, C11): a daemon whose own
 * runtime is gone starts no tier and exits as `reinstalled` does, its files
 * left queued, with one note that names `squeal start`; a tier during which
 * the runtime went stores nothing and queues its files again once. The
 * shape of `research/probes/issue-72/probe.sh`: two copies of one build, a
 * daemon from copy A, which the test deletes as Codex deletes an old
 * version, and copy B's CLI, the installed one. Six held test files import
 * one module, tiers of two; each spawns a Node child after its hold, which
 * loads the recorder from the daemon's runtime, so a child of a deleted
 * runtime fails and its test with it.
 */

const suite = daemonSuite({ observe: true });
const SHARED = "src/held.ts";
const HELD = [1, 2, 3, 4, 5, 6].map((i) => `test/h${i}.test.ts`);
const RUNTIME_NOTE = /^Squeal's own files at .* were removed under its running daemon/;

/** Appends its path to `started`, holds while `hold` exists, then spawns a Node child. */
function heldTest(dir: string, path: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { appendFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { held } from "../src/held";
it("holds while the flag exists, then spawns a node child", async () => {
  appendFileSync(${at("started")}, ${JSON.stringify(`${path}\n`)});
  const deadline = Date.now() + 150_000;
  while (existsSync(${at("hold")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
  expect(child.status, child.stderr).toBe(0);
  expect(held).toBeGreaterThan(0);
}, 170_000);
`;
}

interface Probe {
  readonly repo: FixtureRepo;
  /** Copy A's daemon, whose runtime the test deletes. */
  readonly daemon: SpawnedProcess;
  /** Copy A's build directory. */
  readonly runtime: string;
  /** Copy B's CLI, the suite's own build. */
  readonly squeal: (...args: string[]) => SpawnedProcess;
  /** The held files that started a run since the edit. */
  readonly started: () => string[];
  readonly flag: string;
}

/** A fixture whose every file ran once under copy A's daemon, its first run under the hold. */
async function probe(): Promise<Probe> {
  const dir = mkdtempSync(join(tmpdir(), "sq-011-106-"));
  const flag = join(dir, "hold");
  const startedPath = join(dir, "started");
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  const repo = suite.fixture({
    "squeal.config.json": `${JSON.stringify({
      baseline: { onStart: "lookup-only" },
      runner: { tierSize: 2 },
    })}\n`,
    [SHARED]: "export const held = 1;\n",
    ...Object.fromEntries(HELD.map((path) => [path, heldTest(dir, path)])),
  });
  // Under this run's build directory, so the teardown stops what it leaves (`strays.ts`).
  const runtime = testBuildDir(expect.getState().testPath);
  cpSync(dirname(dirname(dirname(suite.cli))), runtime, { recursive: true });
  suite.cleanup(() => rmSync(runtime, { recursive: true, force: true }));
  const daemon = spawnCli(join(runtime, "dist/cli/index.js"), ["daemon", repo.root], {
    cwd: repo.root,
    env: repo.env,
  });
  const squeal = (...args: string[]) =>
    spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
  const started = () =>
    existsSync(startedPath) ? readFileSync(startedPath, "utf8").split("\n").filter(Boolean) : [];
  await waitReady(repo, daemon);
  expect((await squeal("run", "--all", "--wait").exited).code).toBe(0);
  rmSync(startedPath);
  return { repo, daemon, runtime, squeal, started, flag };
}

/** Each held file's `pending` as its row has it. */
function pendingOf(repo: FixtureRepo): Map<string, "queued" | "running" | null> {
  return withStore(
    repo,
    (store) =>
      new Map(
        store.testFileKeys
          .list(repo.worktreeId)
          .filter((row) => HELD.includes(row.testFile.path))
          .map((row) => [row.testFile.path, row.pending]),
      ),
  );
}

/** The held files whose checks read `fail` or `unknown`. */
function failedOrUnknown(repo: FixtureRepo): string[] {
  const states = withStore(repo, (store) => store.knownStates.list(repo.worktreeId));
  return HELD.filter((path) =>
    states.some(
      (s) => s.check.testPath === path && (s.outcome === "fail" || s.outcome === "unknown"),
    ),
  );
}

/** The worktree's interrupted runs as `meta` has them (`interrupted.ts`); `null` when none ran. */
function interrupted(repo: FixtureRepo): string | null {
  return withStore(repo, (store) => store.meta.get(interruptedMetaKey(repo.worktreeId)));
}

/**
 * `squeal hold` through copy B, its command running while `flag` exists; once the daemon holds.
 * The teardown removes the flag and sends SIGTERM, which the wrapper passes on to its command,
 * so neither outlives a failed case.
 */
async function holding({ squeal, flag }: Probe): Promise<SpawnedProcess> {
  writeFileSync(flag, "");
  const wait = `setInterval(() => require("node:fs").existsSync(${JSON.stringify(flag)}) || process.exit(0), 50);`;
  const hold = squeal("hold", "--", process.execPath, "-e", wait);
  suite.cleanup(() => {
    rmSync(flag, { force: true });
    if (hold.child.exitCode === null && hold.child.signalCode === null) hold.child.kill("SIGTERM");
  });
  await waitFor(() => / is on hold until /.test(hold.stderr()), 60_000, "the hold");
  expect(hold.stderr()).not.toContain("did not take the hold");
  return hold;
}

/** The edit's first tier running under the hold, each of its files started, others queued behind it. */
async function heldTier({ repo, flag, started }: Probe): Promise<string[]> {
  writeFileSync(flag, "");
  writeFileSync(join(repo.root, SHARED), "export const held = 2;\n");
  return waitFor(
    () => {
      const rows = [...pendingOf(repo)];
      const running = rows.filter(([, p]) => p === "running").map(([path]) => path);
      const queued = rows.filter(([, p]) => p === "queued").length;
      return running.length > 0 && started().length >= running.length && queued > 0
        ? running
        : null;
    },
    120_000,
    "the edit's first tier running, held, with files queued behind it",
  );
}

/** Copy A's daemon exits 0 with the runtime's note, which names `squeal start`. */
async function exitsAsReinstalled({ repo, daemon }: Probe): Promise<void> {
  expect(await daemon.exited, diagnose(repo, daemon)).toEqual({ code: 0, signal: null });
  const notes = readNotes(repo).filter((note) => RUNTIME_NOTE.test(note));
  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain("`squeal start`");
}

describe.runIf(process.platform === "linux")(
  "a daemon whose own runtime is gone (row 011-106)",
  SLOW,
  () => {
    it("a deletion during a live tier stores no FAIL and leaves its files queued", async () => {
      const run = await probe();
      const running = await heldTier(run);
      rmSync(run.runtime, { recursive: true, force: true });
      rmSync(run.flag);
      await exitsAsReinstalled(run);
      // Its children failed on the missing recorder: nothing stored, the tier queued again.
      expect(running.length).toBeGreaterThan(0);
      expect(failedOrUnknown(run.repo)).toEqual([]);
      expect([...pendingOf(run.repo).values()]).toEqual(HELD.map(() => "queued"));
      expect(run.started().sort()).toEqual([...running].sort());
    });

    it("a deletion with queued work starts no tier, and the note names `squeal start`", async () => {
      const run = await probe();
      // Row 011-216: the write before the deletion, else the daemon can exit before it queues the
      // write. Without the hold a tier starts about 12 ms after the six files read queued, and one
      // that starts before the deletion still passes: its children cannot load the recorder, so
      // `started` stays empty. The hold ends only after the deletion; `interrupted` sees a tier.
      const hold = await holding(run);
      writeFileSync(join(run.repo.root, SHARED), "export const held = 2;\n");
      await waitFor(
        () => [...pendingOf(run.repo).values()].filter((p) => p === "queued").length === 6,
        60_000,
        "the edit's six files queued",
      );
      rmSync(run.runtime, { recursive: true, force: true });
      rmSync(run.flag);
      await exitsAsReinstalled(run);
      expect((await hold.exited).code, hold.stderr()).toBe(0);
      expect(run.started()).toEqual([]);
      // A tier that ran while the runtime went leaves its files here.
      expect(interrupted(run.repo)).toBeNull();
      expect([...pendingOf(run.repo).values()]).toEqual(HELD.map(() => "queued"));
      expect(failedOrUnknown(run.repo)).toEqual([]);
    });

    it("a start through another copy makes every file current", async () => {
      const run = await probe();
      await heldTier(run);
      rmSync(run.runtime, { recursive: true, force: true });
      rmSync(run.flag);
      await exitsAsReinstalled(run);
      expect(await run.squeal("start").exited).toEqual({ code: 0, signal: null });
      const wait = run.squeal("status", "--wait", "60000", ...HELD);
      expect((await wait.exited).code, wait.stdout()).toBe(0);
      expect(wait.stdout()).toMatch(
        /Named test files at revision \d+: no known failures; 6 test files, each with a current result/,
      );
      const all = run.squeal("run", "--all", "--wait");
      expect((await all.exited).code, all.stdout()).toBe(0);
      expect(all.stdout()).toMatch(
        /no known failures; (\d+) test files, \1 already current, 0 run now/,
      );
      await run.squeal("stop").exited;
    });
  },
);
