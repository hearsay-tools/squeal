import { describe, expect, it } from "vitest";
import { claimHandoff, readShortHandoff } from "../../src/core/delivery/handoff.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { daemonSuite, ping, SLOW, waitFor, withStore } from "./helpers.js";
import { startIn } from "./start-helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Row 011-140 (011 C9): a successor older than the claim it ends, as a Codex
 * kept copy of older code spawned it, ends the handoff short, and no hook
 * asks it to step down again. `squeal start` of a newer version replaces it:
 * it asks the daemon to step down, as a hook would, and finishes the handoff.
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, sockets } = stepDownKit(suite);
/** Older than this tree's version. */
const OLDER = "0.1.1";

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
  },
);
