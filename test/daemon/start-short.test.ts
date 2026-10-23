import { afterEach, describe, expect, it } from "vitest";
import {
  claimHandoff,
  endHandoff,
  handoffFrom,
  readShortHandoff,
  SUCCESSOR_LOCK_WAIT_MS,
} from "../../src/core/delivery/handoff.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { DaemonRecord, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "../cli/fake-daemon.js";
import { daemonSuite, type FixtureRepo, ping, SLOW, waitFor, withStore } from "./helpers.js";
import { spawnLog, startIn } from "./start-helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Row 011-140 (011 C9): a successor older than the claim it ends, as a Codex
 * kept copy of older code spawned it, ends the handoff short, and no hook
 * asks it to step down again. `squeal start` of a newer version replaces it:
 * it asks the daemon to step down, as a hook would, and finishes the handoff.
 * Review 0.1.277, B3: it read the daemon again after the acceptance, before
 * the daemon's ping or the store said it was stopping, and said it was alive.
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, sockets } = stepDownKit(suite);
/** Older than this tree's version. */
const OLDER = "0.1.1";

/** The ping the daemon of `record` answers in `phase`. */
const answer = (repo: FixtureRepo, record: DaemonRecord, phase: string) => ({
  ok: true,
  type: "ping",
  pid: process.pid,
  worktreeId: repo.worktreeId,
  root: repo.root,
  squealVersion: record.squealVersion,
  phase,
  startedAt: record.startedAt,
});

describe.runIf(process.platform === "linux")(
  "squeal start and a daemon that ended its handoff short (row 011-140)",
  SLOW,
  () => {
    it("asks it to step down and serves with a daemon of its own version", async () => {
      const repo = suite.fixture();
      const id = repo.worktreeId as WorktreeId;
      // A hook of this version claimed the handoff; the successor that came runs older code.
      const store = openStore(repo.commonDir);
      if (isStoreOpenFailure(store)) throw new Error("no store");
      claimHandoff(store, id, { from: "0.1.0@1#old", to: HOOKS, at: Date.now() as EpochMs });
      store.close();
      const old = start(buildAt(OLDER), repo);
      const first = await waitFor(
        async () => {
          const answer = await ping(repo.socketPath, 500);
          const short = withStore(repo, (store) => readShortHandoff(store, id));
          return answer?.phase === "ready" && short !== null ? answer : null;
        },
        60_000,
        "the older successor serving, its handoff ended short",
      );
      expect(first.squealVersion).toBe(OLDER);
      sockets.push(repo.socketPath);

      const bounds = { socketMs: 30_000, lockMs: 30_000, leftoversMs: 0 };
      const { code, stdout, stderr } = await startIn(repo, bounds, suite.cli);
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(
        /^Squeal daemon started for .*, after the 0\.1\.1 daemon handed over in \d+\.\d s\n/,
      );
      const served = await ping(repo.socketPath, 500);
      expect(served).toMatchObject({ squealVersion: HOOKS });
      expect(served?.pid).not.toBe(first.pid);
      expect(await old.exited).toEqual({ code: 0, signal: null });
      // Its successor registered at the claim's version: no mark is left.
      expect(withStore(repo, (store) => readShortHandoff(store, id))).toBeNull();
    });

    describe("when it reads serving after it accepted", () => {
      afterEach(() => closeFakeDaemons());

      it("finishes the handoff, and never says it is alive", async () => {
        const repo = suite.fixture();
        const id = repo.worktreeId as WorktreeId;
        const store = openStore(repo.commonDir);
        if (isStoreOpenFailure(store)) throw new Error("no store");
        suite.cleanup(() => store.close());
        const now = Date.now();
        const short: DaemonRecord = {
          socketPath: repo.socketPath,
          startedAt: (now - 60_000) as EpochMs,
          heartbeatAt: now as EpochMs,
          heartbeatIntervalMs: 3_600_000,
          squealVersion: OLDER,
          token: "short",
        };
        const next: DaemonRecord = {
          ...short,
          startedAt: now as EpochMs,
          squealVersion: HOOKS,
          token: "next",
        };
        store.worktrees.upsert({
          id,
          root: repo.root,
          commonDir: repo.commonDir,
          isMain: true,
          registeredAt: 1,
          daemon: short,
        });
        claimHandoff(store, id, { from: "0.1.0@1#old", to: HOOKS, at: now as EpochMs });
        endHandoff(store, id, {
          of: handoffFrom(short),
          version: OLDER,
          executable: "/data/versions/0.1.2/dist/cli/squeal.mjs",
          at: now as EpochMs,
        });
        // It takes the step-down; neither its ping nor the store says it stops. Its successor
        // answers and registers only once start spawned it.
        const { cli, spawns } = spawnLog(suite);
        const pings = [answer(repo, short, "ready")];
        const stepDown = { ok: true, type: "step-down", squealVersion: OLDER, steppingDown: true };
        let stopped = false;
        const seen = await fakeDaemon(
          repo.socketPath,
          { ping: pings, "step-down": [stepDown] },
          (type) => {
            if (type === "stop") stopped = true;
            if (type !== "ping" || !stopped || spawns().length === 0) return;
            pings[0] = answer(repo, next, "ready");
            store.transaction(() => {
              store.worktrees.setDaemon(id, next);
              endHandoff(store, id, {
                of: handoffFrom(next),
                version: HOOKS,
                executable: cli,
                at: Date.now() as EpochMs,
              });
            });
          },
        );

        const bounds = { socketMs: 10_000, lockMs: 5_000, leftoversMs: 0 };
        const { code, stdout, stderr } = await startIn(repo, bounds, cli);
        expect(code, stderr).toBe(0);
        expect(stdout).toMatch(
          /^Squeal daemon started for .*, after the 0\.1\.1 daemon handed over in \d+\.\d s\n/,
        );
        expect(stdout).not.toContain("Squeal daemon alive");
        expect(seen.filter((type) => type !== "ping")).toEqual(["step-down", "stop"]);
        expect(spawns().map((args) => args.slice(2))).toEqual([
          ["--await-lock", String(SUCCESSOR_LOCK_WAIT_MS)],
        ]);
      });
    });
  },
);
