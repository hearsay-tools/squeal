import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { check } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { A, fail, finish, INCARNATION, NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Task 001-282 (research `slow-claims.md` §2): `run --slow --wait` returned
 * on quiet in 0.5 s while the slow file it queued still ran. It holds for
 * the slow files the request queued, bounded by its ms.
 */

const saved = { ...process.env };
let runtimeDir: string;
/** `onceWaiting`'s timers, cleared after each test so none writes to a closed store. */
const timers: NodeJS.Timeout[] = [];

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CODEX_SESSION_ID;
});

afterEach(() => {
  for (const timer of timers.splice(0)) clearTimeout(timer);
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const SECOND = "test/slow-two.test.ts";

/** A worktree at revision 4 whose `slow` files are queued, and a daemon that took `run --slow`. */
async function slowQueued(
  slow: readonly string[],
  fast: readonly string[] = [],
  stop: Record<string, unknown> = {},
) {
  const { repo, store } = repoWith([...slow, ...fast]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: slow }, stop }),
  );
  const seen = await fakeDaemon(socketPathFor(repo.mainId), {
    "run-slow": [
      {
        ok: true,
        type: "run-slow",
        requestId: "s1",
        requested: { revision: 4, queued: slow.length },
        error: null,
      },
    ],
    // The pass is stored and moved nothing: the edit's window is empty.
    sync: [
      {
        ok: true,
        type: "sync",
        requestId: "y1",
        revision: 4,
        error: null,
        moves: true,
        incarnation: INCARNATION,
      },
    ],
  });
  return { repo, store, seen };
}

/**
 * Runs `fn` `ms` after the wait asked for its sync, which it does after its
 * first read took the start view and the queued slow files: a fixed delay
 * from the command's start may fall before that read on a loaded host.
 * Resolves to whether `fn` ran.
 */
function onceWaiting(seen: readonly string[], ms: number, fn: () => void): () => boolean {
  let ran = false;
  const poll = setInterval(() => {
    if (!seen.includes("sync")) return;
    clearInterval(poll);
    timers.push(
      setTimeout(() => {
        fn();
        ran = true;
      }, ms),
    );
  }, 20);
  timers.push(poll);
  return () => ran;
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
    env: {},
  };
  const started = performance.now();
  const code = await main(argv, io);
  return { code, stdout, stderr, ms: performance.now() - started };
}

describe("squeal run --slow --wait holds for the slow files it queued (001-282)", {
  timeout: 30_000,
}, () => {
  it("returns only once the queued slow file has a result", async () => {
    const { repo, store, seen } = await slowQueued([SLOW_FILE]);
    const finished = onceWaiting(seen, 1_000, () => finish(store, repo.mainId, SLOW_FILE));

    const result = await run(["run", "--slow", "--wait", "20000"], repo.main);

    expect(result.code).toBe(0);
    expect(finished()).toBe(true);
    expect(result.stdout).toMatch(
      /^Slow tier requested at revision 4: 1 slow file queued; [^\n]*\nRevision[\s\S]*\n\nReturned on quiet: [^\n]*; the 1 slow file run --slow queued has its result\. Worktree: [^\n]*\n$/,
    );
  });

  it("returns on timeout naming the slow files still pending, exit 3", async () => {
    const { repo, store, seen } = await slowQueued([SLOW_FILE, SECOND]);
    const finished = onceWaiting(seen, 100, () => finish(store, repo.mainId, SECOND));

    const result = await run(["run", "--slow", "--wait", "1500"], repo.main);

    // Task 004-66: a queued slow file without its result is no verdict.
    expect(result.code).toBe(3);
    expect(finished()).toBe(true);
    expect(result.stdout).toMatch(
      /\nReturned on timeout after \d+\.\d s: [^\n]*; 1 of the 2 slow files run --slow queued pending: test\/slow\.test\.ts\. Worktree: [^\n]*\n$/,
    );
  });

  it("ends on news of a queued slow file's checks", async () => {
    const { repo, store, seen } = await slowQueued([SLOW_FILE, SECOND]);
    // Its run ended with a failure: the row and the check, as one commit records them.
    onceWaiting(seen, 100, () => {
      finish(store, repo.mainId, SLOW_FILE);
      fail(store, repo.mainId, check(SLOW_FILE, "holds"));
    });

    const result = await run(["run", "--slow", "--wait", "20000"], repo.main);

    // The news is the slow files', not the empty edit window's (review wave-13ak, S1).
    expect(result.stdout).toMatch(
      /\nReturned on news: 1 transition in the 2 slow files run --slow queued, at revision 4 after \d+\.\d s; 1 of the 2 slow files run --slow queued pending: test\/slow-two\.test\.ts\. Worktree: [^\n]*\n$/,
    );
  });

  it("does not hold for fast files outside the edit", async () => {
    const { repo, store, seen } = await slowQueued([SLOW_FILE], [A]);
    onceWaiting(seen, 100, () => finish(store, repo.mainId, SLOW_FILE));

    const result = await run(["run", "--slow", "--wait", "20000"], repo.main);

    expect(result.stdout).toMatch(/\nReturned on quiet: /);
  });
});

describe("squeal status --wait does not hold for slow files, and says so (001-282)", {
  timeout: 30_000,
}, () => {
  // Spec 004 D8 as amended 2026-10-18 (gh-35, task 004-71): the clause follows the policy.
  it("returns quiet at once while a slow file is pending; off, it is not required", async () => {
    const { repo } = await slowQueued([SLOW_FILE]);

    const result = await run(["status", "--wait", "20000"], repo.main);

    expect(result.ms).toBeLessThan(10_000);
    expect(result.stdout).toMatch(
      /\n\nReturned on quiet: [^\n]*; 1 slow file is not current and Squeal runs it after the fast tests; this repository does not require it before you finish; `squeal run --slow --wait 60000` waits for its result\. Worktree: [^\n]*\n$/,
    );
  });

  it("with `stop.requireSlowSuite` on, names the command that runs and waits", async () => {
    const { repo } = await slowQueued([SLOW_FILE], [], { requireSlowSuite: true });

    const result = await run(["status", "--wait", "20000"], repo.main);

    expect(result.stdout).toMatch(
      /\n\nReturned on quiet: [^\n]*; 1 slow file is not current and Squeal runs it after the fast tests, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for it\. Worktree: [^\n]*\n$/,
    );
  });

  it("with --json, the line on stderr follows the policy the snapshot carries", async () => {
    for (const requireSlowSuite of [false, true]) {
      const { repo } = await slowQueued([SLOW_FILE], [], { requireSlowSuite });

      const result = await run(["status", "--json", "--wait", "20000"], repo.main);

      const snapshot = JSON.parse(result.stdout);
      expect(snapshot.wait).toMatchObject({ outcome: "quiet" });
      expect(snapshot.slowTier.pending).toBe(1);
      expect(snapshot.slowTier.stopWaitMs !== undefined).toBe(requireSlowSuite);
      expect(result.stderr).toMatch(/^Returned on quiet: /);
      expect(result.stderr.includes("this repository does not require it before you finish")).toBe(
        !requireSlowSuite,
      );
      expect(result.stderr.includes("`squeal run --slow --wait 60000` runs and waits for it")).toBe(
        requireSlowSuite,
      );
      closeFakeDaemons();
    }
  });
});
