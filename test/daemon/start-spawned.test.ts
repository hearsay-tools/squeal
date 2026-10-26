import { afterEach, describe, expect, it, vi } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { squealVersion } from "../../src/core/daemon/version.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { DaemonRecord, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "../cli/fake-daemon.js";
import { createFixtureRepo, delay, type FixtureRepo, SLOW, waitFor } from "./helpers.js";
import { spawnLog, startIn } from "./start-helpers.js";

/*
 * Row 011-214 (011 C9, gh-94): `squeal start` waits 30 s for the daemon it
 * spawned. It exits 0 once that daemon answers and is recorded (row 011-111),
 * 1 once its process ended without an answer, and 3 past the bound while the
 * process lives: at load 40 on 24 CPUs a daemon answered seconds after a
 * 10 s bound, and the exit 1 failed a passing measurement's EXIT trap. Row
 * 011-219: it reads the process's end from its exit event, not its pid, which
 * another process may have by then. The spawned CLI is a stub (`spawnLog`); a
 * stand-in answers for the daemon.
 */

const BOUNDS = { socketMs: 10_000, lockMs: 5_000, leftoversMs: 0 };

const cleanups: (() => void)[] = [];
const suite = { cleanup: (fn: () => void) => cleanups.push(fn) };

/** A fixture whose store has the worktree's row, with no daemon recorded. */
function fixture() {
  const repo = createFixtureRepo();
  cleanups.push(repo.cleanup);
  const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  const id = repo.worktreeId as WorktreeId;
  store.worktrees.upsert({
    id,
    root: repo.root,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  const register = (daemon: DaemonRecord) => store.worktrees.setDaemon(id, daemon);
  return { repo, register };
}

/** The record of a daemon of this version that started a second ago. */
function record(repo: FixtureRepo): DaemonRecord {
  const now = Date.now();
  return {
    socketPath: repo.socketPath,
    startedAt: (now - 1_000) as EpochMs,
    heartbeatAt: now as EpochMs,
    heartbeatIntervalMs: 5_000,
    squealVersion: squealVersion(),
    token: "new",
  };
}

/** The stand-in for the daemon of `daemon`: it answers every ping as that daemon. */
function answers(repo: FixtureRepo, daemon: DaemonRecord) {
  return fakeDaemon(repo.socketPath, {
    ping: [
      {
        ok: true,
        type: "ping",
        pid: process.pid,
        worktreeId: repo.worktreeId,
        root: repo.root,
        squealVersion: daemon.squealVersion,
        phase: "serving",
        startedAt: daemon.startedAt,
      },
    ],
  });
}

describe.runIf(process.platform === "linux")(
  "squeal start and the daemon it spawned (row 011-214)",
  SLOW,
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
      closeFakeDaemons();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    });

    it("exits 0 with its status once that daemon answers and registers, seconds after the spawn", async () => {
      const { repo, register } = fixture();
      const { cli, spawns } = spawnLog(suite, 60_000);
      // Once spawned, the daemon is silent for 1 s, then answers; it registers 1.5 s later
      // (row 011-111: status read before then says no daemon validates).
      const serving = (async () => {
        await waitFor(() => spawns().length > 0, 30_000, "the spawn");
        await delay(1_000);
        const daemon = record(repo);
        await answers(repo, daemon);
        await delay(1_500);
        register(daemon);
      })();

      const { code, stdout, stderr } = await startIn(repo, BOUNDS, cli);
      await serving;
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(/^Squeal daemon spawned for /);
      expect(squealEvidence(stdout, "pull"), stdout).toMatchObject({ daemon: true });
    });

    it("exits 1 once the process it spawned ended without an answer, before the bound, also when another process has its pid", async () => {
      const { repo } = fixture();
      const { cli, spawns } = spawnLog(suite);
      // Row 011-219 (review 0.1.319, N1): every pid no process has reads as running, as one
      // does once the kernel gives the ended child's pid to another process.
      const kill = process.kill.bind(process);
      vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (signal !== 0) return kill(pid, signal);
        try {
          return kill(pid, 0);
        } catch {
          return true;
        }
      });

      const began = performance.now();
      const { code, stdout, stderr } = await startIn(repo, BOUNDS, cli);
      vi.restoreAllMocks();
      expect(code, stdout).toBe(1);
      expect(spawns()).toHaveLength(1);
      expect(stderr).toBe(
        `squeal: spawned a daemon for ${repo.root}, but it exited without answering\n`,
      );
      expect(stdout).not.toMatch(/Squeal daemon/);
      // It did not wait out the 30 s bound for a process that is gone.
      expect(performance.now() - began).toBeLessThan(20_000);
    });

    it("exits 3, still starting, past 30 s while the process lives; the daemon serves later", async () => {
      const { repo, register } = fixture();
      const { cli, spawns } = spawnLog(suite, 60_000);
      // A clock 60 times as fast: the 30 s bound passes in about half a second.
      const real = Date.now.bind(Date);
      const began = real();
      vi.spyOn(Date, "now").mockImplementation(() => began + (real() - began) * 60);

      const { code, stdout, stderr } = await startIn(repo, BOUNDS, cli);
      vi.restoreAllMocks();
      expect(code, stderr).toBe(3);
      expect(spawns()).toHaveLength(1);
      expect(stderr).toMatch(
        /^squeal: the daemon spawned for .* \(pid \d+\) is still starting: it has not answered after 30 s; `[^`]* status` says when it serves\n$/,
      );
      expect(stdout).not.toMatch(/Squeal daemon/);

      // Readiness after the bound: the daemon answers and registers, and a later start finds it.
      const daemon = record(repo);
      await answers(repo, daemon);
      register(daemon);
      const after = await startIn(repo, BOUNDS, cli);
      expect(after.code, after.stderr).toBe(0);
      expect(after.stdout).toMatch(/^Squeal daemon alive for /);
      expect(squealEvidence(after.stdout, "pull"), after.stdout).toMatchObject({ daemon: true });
      expect(spawns()).toHaveLength(1);
    });

    it("exits 0 and spawns nothing when another daemon already serves", async () => {
      const { repo, register } = fixture();
      const { cli, spawns } = spawnLog(suite);
      const daemon = record(repo);
      await answers(repo, daemon);
      register(daemon);

      const { code, stdout, stderr } = await startIn(repo, BOUNDS, cli);
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(/^Squeal daemon alive for /);
      expect(squealEvidence(stdout, "pull"), stdout).toMatchObject({ daemon: true });
      expect(spawns()).toHaveLength(0);
    });
  },
);
