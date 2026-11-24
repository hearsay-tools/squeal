import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRest } from "../../src/core/presence/stored.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { sessionRootFiles } from "../../src/harness/shared/session-root.js";
import { hookText, recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Spec 026 D2 (row 026-09), against real daemons under an edit-free test
 * policy (every test group `manual`), `daemon.unusedExitMinutes` 0.05 (3 s).
 *
 * D2.1's root cause (`research/daemonless-hooks.md` Q5 item 3, `restart.sh`):
 * the probe cloned into a fresh `.git`, so its SessionStart found no store,
 * spawned the daemon and registered no consumer (`startSession`). With none
 * registered the unused stop does not apply, and the daemon fell to the
 * no-consumer idle bound, `daemon.idleExitMinutes` (60 min); the probe was
 * stopped at 20. Under an edit-free policy with that key unset, the loader
 * now caps it by the unused bound (the coordinator, 2026-11-24).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const suite = daemonSuite();
const { fixture, daemon } = suite;

const EDIT_FREE = {
  "squeal.config.json": JSON.stringify({
    checks: [{ name: "unit", runner: "vitest", at: "manual" }],
    daemon: { unusedExitMinutes: 0.05 },
    complexity: { enabled: false },
    coverage: { enabled: false },
  }),
};

function deps(repo: FixtureRepo): HookDeps {
  return {
    env: repo.env,
    cli: suite.cli,
    harnessProcess: () => findHarnessProcess({ ppid: process.pid }),
    sessionRoots: sessionRootFiles(repo.env),
  };
}

/** The daemon's record; `null` also before the first daemon creates the store. */
const recordOf = (repo: FixtureRepo) => {
  if (!existsSync(join(repo.commonDir, "squeal", "store.sqlite"))) return null;
  return withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon ?? null);
};
const consumers = (repo: FixtureRepo) =>
  withStore(repo, (store) => store.consumers.list(repo.worktreeId).length);

/** A daemon registered for `repo` that answers its socket. */
const serving = (repo: FixtureRepo) =>
  waitFor(
    async () => {
      const record = recordOf(repo);
      return record !== null && (await ping(record.socketPath, 500)) !== null && record;
    },
    60_000,
    "a daemon registered and serving",
  );

describe("the short-lived daemon of an edit-free policy (spec 026 D2, row 026-09)", SLOW, () => {
  it("a fresh store's SessionStart registers no consumer; its daemon stops at the capped idle bound", async () => {
    const repo = fixture(EDIT_FREE);
    vi.stubEnv("XDG_RUNTIME_DIR", repo.runtimeDir);
    const d = deps(repo);
    // No store yet: the hook only spawns the daemon, as in restart.sh.
    expect(hookText(await runHook("session-start", recorded("session-start", repo.root), d))).toBe(
      "",
    );
    const first = await serving(repo);
    expect(consumers(repo)).toBe(0);
    const startedAt = Date.now();
    await waitFor(() => recordOf(repo) === null, 30_000, "the daemon gone");
    expect(Date.now() - startedAt).toBeLessThan(20_000);
    expect(
      readNotes(repo).filter((n) => /idle for 3 s with no registered consumers/.test(n)),
    ).toHaveLength(1);

    // The next hook starts the next daemon and registers: no error, no stop news.
    const text = hookText(await runHook("session-start", recorded("session-start", repo.root), d));
    expect(text).toMatch(/^SQUEAL · registered/);
    expect(text).not.toMatch(/stopped|error|failed/i);
    expect((await serving(repo)).startedAt).toBeGreaterThan(first.startedAt);
  });

  it("stops unused with a registered consumer, marks the rest, and the next hook restarts it silently", async () => {
    const repo = fixture(EDIT_FREE);
    vi.stubEnv("XDG_RUNTIME_DIR", repo.runtimeDir);
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const d = deps(repo);
    await runHook("session-start", recorded("session-start", repo.root), d);
    expect(consumers(repo)).toBe(1);

    const exit = await Promise.race([
      spawned.exited,
      new Promise<null>((done) => setTimeout(() => done(null), 30_000)),
    ]);
    expect(exit).toEqual({ code: 0, signal: null });
    const unused = readNotes(repo).filter((n) =>
      /no edit, run, wait or request for 3 s \(daemon.unusedExitMinutes\), with 1 session registered/.test(
        n,
      ),
    );
    expect(unused).toHaveLength(1);
    expect(withStore(repo, (store) => readRest(store, repo.worktreeId))).not.toBeNull();
    expect(consumers(repo)).toBe(1);

    const next = await runHook("post-tool-batch", recorded("post-tool-batch", repo.root), d);
    expect(next).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    const again = await serving(repo);
    expect(again.socketPath).toBe(repo.socketPath);
  });
});
