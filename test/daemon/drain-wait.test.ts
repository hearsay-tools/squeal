import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireSlowSlot, slowSlotDir } from "../../src/core/slow/index.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  type SpawnedProcess,
  spawnCli,
  waitFor,
  withStore,
} from "./helpers.js";
import { resultOf } from "./scratch-helpers.js";

/*
 * 011 C9 and 004 D2 as amended 2026-10-23 (the human, row 011-163), against
 * real daemons: a draining daemon runs its fast work to the end; once that is
 * done, 60 s with no slow run ends the drain with one note naming the slow
 * files left queued, and the next daemon in the worktree runs them; a drain
 * whose slow files get the slot runs them as before. The test holds the
 * fixture's one slow permit, as a live session's daemon in another worktree
 * would. Under `lookup-only` an edit queues the files, so the next daemon
 * runs the slow file only because it resumes its predecessor's queue (011-33).
 */

const suite = daemonSuite();

const DRAIN_NOTE = /^the last session ended with slow files pending; this daemon runs them/;
const DRAINED_NOTE = /daemon stopped: the slow files pending when its last session ended have run/;
const WAITED_NOTE =
  /^daemon stopped: no slow file ran for 60 s once the fast work pending when its last session ended was done; 1 slow file left queued for the next daemon in this worktree: test\/slow\.test\.ts$/;

const SLOW_TEST = "test/slow.test.ts";
const FAST_TEST = "test/held.test.ts";

/** A Vitest file that writes `started-<name>` and holds until `release-<name>` exists. */
function heldTest(dir: string, name: string): string {
  const at = (file: string) => JSON.stringify(join(dir, `${file}-${name}`));
  return `import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
it("holds until released", async () => {
  writeFileSync(${at("started")}, "");
  const deadline = Date.now() + 200_000;
  while (!existsSync(${at("release")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("release")})).toBe(true);
}, 220_000);
`;
}

const self = () => findHarnessProcess({ ppid: process.pid });

function deps(repo: FixtureRepo): HookDeps {
  return { env: repo.env, ensureDaemon: async () => "alive", harnessProcess: self };
}

async function hook(repo: FixtureRepo, event: "session-start" | "session-end", id: string) {
  const extra = event === "session-start" ? { source: "startup" } : {};
  await runHook(event, recorded(event, repo.root, { session_id: id, ...extra }), deps(repo));
}

/**
 * A daemon whose session `s1` edited a fast and a slow test file, with the
 * slow slot held by the test: the slow file waits at it.
 */
async function edited() {
  const dir = mkdtempSync(join(tmpdir(), "sq-011-163-"));
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  const repo = suite.fixture({
    [SLOW_TEST]: heldTest(dir, "slow"),
    [FAST_TEST]: heldTest(dir, "fast"),
    "squeal.config.json": `${JSON.stringify({
      baseline: { onStart: "lookup-only" },
      // The load guard (004 D3) would defer the slow file on a loaded host past the waits.
      slow: { include: [SLOW_TEST], maxParallel: 1, maxLoadPerCpu: 1000 },
    })}\n`,
  });
  const owner = { pid: process.pid, worktreeId: "feedfacefeedface" };
  const slot = acquireSlowSlot({ dir: slowSlotDir(repo.env), owner, permits: 1 });
  if (slot === null) throw new Error("the test could not take the fixture's slow slot");
  suite.cleanup(() => slot.release());
  const release = (name: string) => writeFileSync(join(dir, `release-${name}`), "");
  suite.cleanup(() => {
    release("fast");
    release("slow");
  });
  const spawned = suite.daemon(repo);
  await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
  await hook(repo, "session-start", "s1");
  // A wait's sync answers once the daemon's start ended, so its watcher sees the edit (001 D9).
  await spawnCli(suite.cli, ["status", "--wait", "1000"], { cwd: repo.root, env: repo.env }).exited;
  for (const path of [SLOW_TEST, FAST_TEST]) appendFileSync(join(repo.root, path), "// edited\n");
  await waitFor(() => existsSync(join(dir, "started-fast")), 120_000, "the edit's fast tier").catch(
    (error: Error) => {
      throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
    },
  );
  return {
    repo,
    spawned,
    slot,
    release,
    started: (name: string) => existsSync(join(dir, `started-${name}`)),
  };
}

async function exitWithin(spawned: SpawnedProcess, ms: number, repo: FixtureRepo) {
  const exit = await Promise.race([spawned.exited, delay(ms).then(() => null)]);
  if (exit === null) {
    throw new Error(`the daemon still runs after ${ms} ms\n${diagnose(repo, spawned)}`);
  }
  return exit;
}

const notesLike = (repo: FixtureRepo, pattern: RegExp) =>
  readNotes(repo).filter((n) => pattern.test(n));

const pendingOf = (repo: FixtureRepo, path: string) =>
  withStore(
    repo,
    (store) =>
      store.testFileKeys.list(repo.worktreeId).find((r) => r.testFile.path === path)?.pending,
  );

const slowActivity = (repo: FixtureRepo) =>
  withStore(repo, (store) => readSlowActivity(store, repo.worktreeId));

describe.runIf(process.platform === "linux")(
  "a departure drain ends when its slow files wait (row 011-163)",
  { timeout: 300_000 },
  () => {
    it("runs its fast work to the end, exits 60 s later naming the slow file, and the next daemon runs it", async () => {
      const { repo, spawned, slot, release } = await edited();
      await hook(repo, "session-end", "s1");
      await waitFor(() => notesLike(repo, DRAIN_NOTE).length > 0 || null, 30_000, "the drain");
      // Its fast work holds past the slow files' would-be 60 s from the drain's start.
      await delay(30_000);
      expect(spawned.child.exitCode).toBeNull();

      const released = Date.now();
      release("fast");
      expect((await resultOf(repo, spawned, FAST_TEST)).outcome).toBe("pass");
      expect(await exitWithin(spawned, 120_000, repo)).toEqual({ code: 0, signal: null });
      // The 60 s count from the fast work's end, not from the drain's start.
      expect(Date.now() - released).toBeGreaterThanOrEqual(50_000);
      expect(notesLike(repo, DRAIN_NOTE)).toHaveLength(1);
      expect(notesLike(repo, WAITED_NOTE)).toHaveLength(1);
      expect(notesLike(repo, DRAINED_NOTE)).toEqual([]);
      expect(pendingOf(repo, SLOW_TEST)).toBe("queued");

      // The slot is free and no session registered: the next daemon resumes the queue.
      slot.release();
      release("slow");
      const next = suite.daemon(repo);
      expect(await resultOf(repo, next, SLOW_TEST)).toMatchObject({
        outcome: "pass",
        validity: "current",
      });
    });

    it("a slow file that gets the slot during the drain runs to its end, and the drain exits as before", async () => {
      const { repo, spawned, slot, release, started } = await edited();
      release("fast");
      expect((await resultOf(repo, spawned, FAST_TEST)).outcome).toBe("pass");
      await waitFor(
        () => (slowActivity(repo)?.kind === "waiting" ? true : null),
        30_000,
        "the slow file waiting",
      );
      await hook(repo, "session-end", "s1");
      await waitFor(() => notesLike(repo, DRAIN_NOTE).length > 0 || null, 30_000, "the drain");
      // Within its 60 s, so the slot's next recheck (SLOW_RECHECK_MS) comes before them.
      await delay(20_000);
      expect(spawned.child.exitCode).toBeNull();

      // The live session's daemon is done with the slot: the drain takes it.
      slot.release();
      await waitFor(() => started("slow") || null, 60_000, "the slow file started");
      // Past 60 s from the drain's start, the running file keeps it.
      await delay(45_000);
      expect(spawned.child.exitCode).toBeNull();

      release("slow");
      expect(await exitWithin(spawned, 60_000, repo)).toEqual({ code: 0, signal: null });
      expect((await resultOf(repo, spawned, SLOW_TEST)).outcome).toBe("pass");
      expect(notesLike(repo, DRAINED_NOTE)).toHaveLength(1);
      expect(notesLike(repo, WAITED_NOTE)).toEqual([]);
    });
  },
);
