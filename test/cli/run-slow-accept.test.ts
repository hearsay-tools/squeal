import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { finish, INCARNATION, NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Row 011-271 (gh-119, `research/issue-119.md`): `run --slow --wait` gave up
 * after 10 s while the scheduler had not taken its request yet, with exit 1
 * and before its wait began. The scheduler's taking the request now counts
 * against the one `--wait` budget. Each `run-slow-status` poll moves the
 * clock 1.5 s on, so 10 s pass in about ten polls of real time.
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
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  for (const timer of timers.splice(0)) clearTimeout(timer);
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const POLL_STEP_MS = 1_500;

/** The pending request's line at a 3 s budget: two polls, 4.5 s on the clock. */
const PENDING =
  "Returned on timeout after 4.5 s: the daemon has not taken slow tier request s1 yet; the request is pending and this command has no verdict for it. The daemon takes it once its current work allows; `squeal status --wait 60000 <slow test file>` then waits for that file's result.\n";

function slow(requested: { revision: number; queued: number } | null) {
  return { ok: true, type: "run-slow", requestId: "s1", requested, error: null };
}

/**
 * A worktree at revision 4 with one slow file, pending or `current`, and a
 * daemon whose scheduler takes `run --slow` at its `takenAt`th status poll,
 * never when `null`.
 */
async function delayed(takenAt: number | null, current = false) {
  const { repo, store } = current ? repoWith([], [SLOW_FILE]) : repoWith([SLOW_FILE]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: [SLOW_FILE] } }),
  );
  const pending = Array.from({ length: (takenAt ?? 1) - 1 }, () => slow(null));
  const seen = await fakeDaemon(
    socketPathFor(repo.mainId),
    {
      "run-slow": [slow(null)],
      "run-slow-status":
        takenAt === null ? [slow(null)] : [...pending, slow({ revision: 4, queued: 1 })],
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
    },
    (type) => {
      if (type === "run-slow-status") vi.setSystemTime(Date.now() + POLL_STEP_MS);
    },
  );
  return { repo, store, seen };
}

/** Runs `fn` `ms` after the wait asked for its first sync. */
function onceWaiting(seen: readonly string[], ms: number, fn: () => void): void {
  const poll = setInterval(() => {
    if (!seen.includes("sync")) return;
    clearInterval(poll);
    timers.push(setTimeout(fn, ms));
  }, 20);
  timers.push(poll);
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

describe("squeal run --slow waits for the scheduler within its one budget (row 011-271)", {
  timeout: 30_000,
}, () => {
  it("with --wait, a request taken after 10 s reaches the result wait and its verdict", async () => {
    // Taken at the 10th poll, 15 s on the clock.
    const { repo, store, seen } = await delayed(10);
    onceWaiting(seen, 100, () => finish(store, repo.mainId, SLOW_FILE));

    const result = await run(["run", "--slow", "--wait", "20000"], repo.main);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^Slow tier requested at revision 4: 1 slow file queued; [^\n]*\nRevision[\s\S]*\n\nReturned on quiet: [^\n]*; the 1 slow file run --slow queued has its result\. Worktree: [^\n]*\n$/,
    );
  });

  it("with --wait, the result wait gets only the budget the scheduler left", async () => {
    // Taken at 15 s of a 16 s budget; the slow file never gets its result.
    const { repo, seen } = await delayed(10);

    const result = await run(["run", "--slow", "--wait", "16000"], repo.main);

    expect(seen).toContain("sync");
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(8_000);
    expect(result.stdout).toMatch(
      /\nReturned on timeout after \d+\.\d s: [^\n]*; 1 of the 1 slow file run --slow queued pending: test\/slow\.test\.ts\. Worktree: [^\n]*\n$/,
    );
  });

  it("with --wait, a budget that ends with the request pending exits 3 and names the request", async () => {
    const { repo, seen } = await delayed(null);

    const result = await run(["run", "--slow", "--wait", "3000"], repo.main);

    expect(result).toMatchObject({ code: 3, stdout: PENDING, stderr: "" });
    expect(seen).not.toContain("sync");
  });

  it("with --wait, a pending request says nothing of a slow file's result (review 0.1.382 B2)", async () => {
    // The slow file has a current result before the request; the scheduler never takes it.
    const { repo, store, seen } = await delayed(null, true);

    const result = await run(["run", "--slow", "--wait", "3000"], repo.main);

    expect(result).toMatchObject({ code: 3, stdout: PENDING, stderr: "" });
    expect(result.stdout).not.toMatch(/no slow file has a result/);
    expect(seen).not.toContain("sync");
    const slowStates = store.knownStates
      .list(repo.mainId)
      .filter((s) => s.check.kind === "test" && s.check.testPath === SLOW_FILE);
    expect(slowStates.map((s) => s.validity)).toEqual(["current"]);
  });

  it("without --wait, a request pending after 10 s prints its receipt and exits 0", async () => {
    const { repo, seen } = await delayed(null);

    const result = await run(["run", "--slow"], repo.main);

    expect(result).toMatchObject({
      code: 0,
      stdout:
        "Slow tier requested (request s1); the daemon takes it once its current work allows\n",
      stderr: "",
    });
    // 10.5 s on the clock at the 7th poll.
    expect(seen.filter((type) => type === "run-slow-status")).toHaveLength(7);
  });
});
