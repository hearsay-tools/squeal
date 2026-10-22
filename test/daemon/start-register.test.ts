import { afterEach, describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { clearHandoff, readHandoff } from "../../src/core/delivery/handoff.js";
import { isStoreOpenFailure, lockFileFor, openStore } from "../../src/core/store/index.js";
import type { DaemonRecord, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "../cli/fake-daemon.js";
import { daemonSuite, SLOW } from "./helpers.js";
import { spawnLog, startIn } from "./start-helpers.js";

/*
 * Row 011-111 (011 C9, row 011-34): a successor answers on its socket before
 * it registers, and until it registers its predecessor's handoff claim
 * stands, so status says the daemon is handing over. CI 39864834794 printed
 * that under `Squeal daemon started`, and the evals read no daemon from it.
 * `start` prints its status once the store records the daemon that answered.
 */

const suite = daemonSuite();
const HOOKS = squealVersion();

describe.runIf(process.platform === "linux")(
  "squeal start when the successor answers before it registers (row 011-111)",
  SLOW,
  () => {
    afterEach(() => closeFakeDaemons());

    /** A stopping daemon of 0.1.0 that holds the lock; its successor answers once start asked it to stop. */
    async function handingOver(registerAfterMs: number | null) {
      const repo = suite.fixture();
      const id = repo.worktreeId as WorktreeId;
      const now = Date.now();
      const old: DaemonRecord = {
        socketPath: repo.socketPath,
        startedAt: (now - 60_000) as EpochMs,
        heartbeatAt: (now - 20_000) as EpochMs,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.1.0",
        token: "old",
      };
      const next: DaemonRecord = {
        ...old,
        startedAt: (now - 1_000) as EpochMs,
        heartbeatAt: now as EpochMs,
        squealVersion: HOOKS,
        token: "new",
      };
      const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
      if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
      suite.cleanup(() => store.close());
      store.worktrees.upsert({
        id,
        root: repo.root,
        commonDir: repo.commonDir,
        isMain: true,
        registeredAt: 1,
        daemon: old,
      });
      const lock = acquireDaemonLock(lockFileFor(repo.commonDir, id));
      if (lock === null) throw new Error("the lock is taken");
      suite.cleanup(() => lock.release());
      const answer = (record: DaemonRecord, phase: string) => ({
        ok: true,
        type: "ping",
        pid: process.pid,
        worktreeId: id,
        root: repo.root,
        squealVersion: record.squealVersion,
        phase,
        startedAt: record.startedAt,
      });
      // The first ping after the stop comes once start claimed the handoff. Then, as a 0.1.31
      // daemon's shutdown and its successor's start run: the old record is cleared, and the
      // successor answers from its socket while its registration (`#register`) has not run.
      const pings = [answer(old, "stopping")];
      let stopped = false;
      let answering = false;
      await fakeDaemon(repo.socketPath, { ping: pings }, (type) => {
        if (type === "stop") stopped = true;
        if (type !== "ping" || !stopped || answering) return;
        answering = true;
        store.worktrees.setDaemon(id, null);
        pings[0] = answer(next, "starting");
        if (registerAfterMs === null) return;
        setTimeout(() => {
          store.transaction(() => {
            store.worktrees.setDaemon(id, next);
            clearHandoff(store, id);
          });
        }, registerAfterMs);
      });
      return { repo, store, id };
    }

    it("prints its status once the successor registered, which says it validates", async () => {
      const { repo, store, id } = await handingOver(1_500);
      // It claims the handoff, so it spawns a successor with the lock wait; this CLI only logs it.
      const { cli } = spawnLog(suite);

      const bounds = { socketMs: 10_000, lockMs: 5_000, leftoversMs: 0 };
      const { code, stdout, stderr } = await startIn(repo, bounds, cli);
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(
        /^Squeal daemon started for .*, after the 0\.1\.0 daemon handed over in \d+\.\d s\n/,
      );
      // The evals read a daemon validating from it (CI 39864834794 read none).
      expect(squealEvidence(stdout, "pull"), stdout).toMatchObject({ daemon: true });
      expect(stdout).not.toMatch(/handing over|stopping/);
      // It claimed the handoff, and the registration ended it before start read the status.
      expect(readHandoff(store, id)).toBeNull();
    });

    it("past its bound, a successor that answered and never registered is still the one it names", async () => {
      const { repo } = await handingOver(null);
      const { cli } = spawnLog(suite);

      const bounds = { socketMs: 1_000, lockMs: 1_000, leftoversMs: 0 };
      const { code, stdout, stderr } = await startIn(repo, bounds, cli);
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(/^Squeal daemon started for .*, after the 0\.1\.0 daemon handed over/);
      // The claim stands, so the status says what is so: the handoff has not ended.
      expect(stdout).toMatch(/handing over from 0\.1\.0 to /);
    });
  },
);
