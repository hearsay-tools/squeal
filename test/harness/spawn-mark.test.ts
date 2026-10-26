import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import { daemonStart, spawnMarkFor } from "../../src/core/daemon/start-mark.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type {
  AbsolutePath,
  EnsureDaemonResult,
  EpochMs,
  WorktreeId,
} from "../../src/core/types/index.js";
import type { HookDeps } from "../../src/harness/claude-code/index.js";
import { ensure } from "../../src/harness/shared/ensure.js";
import { squealRepo } from "./helpers.js";

/*
 * Row 011-251 (F1, gh-1): a hook's spawn returns before the daemon takes
 * the lock, so the hook marks the spawn beside the lock; a reader then
 * tells the start from a stopped daemon until the daemon marks its own.
 */

const AT = 1_790_000_000_000 as EpochMs;

function hookAt(ensured: EnsureDaemonResult) {
  const r = squealRepo();
  const location = {
    root: r.repo.main as AbsolutePath,
    commonDir: r.repo.commonDir as AbsolutePath,
  };
  const lockFile = lockFileFor(location.commonDir, r.worktreeId as WorktreeId);
  const asked: EnsureDaemonOptions[] = [];
  const deps: HookDeps = {
    env: {},
    now: () => AT,
    ensureDaemon: async (_root, options) => {
      asked.push(options ?? {});
      return ensured;
    },
  };
  return { location, lockFile, deps, asked };
}

describe("a hook's spawn mark (row 011-251, F1)", () => {
  it("is written when the hook spawned a daemon, with the spawn's time, the locks directory made", async () => {
    const { location, lockFile, deps, asked } = hookAt("spawned");
    rmSync(dirname(lockFile), { recursive: true, force: true });

    expect(await ensure(location, deps)).toBe("spawned");

    expect(asked).toHaveLength(1);
    expect(JSON.parse(readFileSync(spawnMarkFor(lockFile), "utf8"))).toEqual({ at: AT });
    expect(daemonStart(lockFile, AT)).toEqual({ kind: "spawned", since: AT });
  });

  it.each(["alive", "unavailable"] as const)(
    "is not written when the ensure answered %s",
    async (ensured) => {
      const { location, lockFile, deps } = hookAt(ensured);

      expect(await ensure(location, deps)).toBe(ensured);

      expect(existsSync(spawnMarkFor(lockFile))).toBe(false);
    },
  );
});
