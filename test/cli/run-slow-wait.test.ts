import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { check } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import {
  A,
  fail,
  finish,
  INCARNATION,
  later,
  NOW,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";

/*
 * Task 001-282 (research `slow-claims.md` §2): `run --slow --wait` returned
 * on quiet in 0.5 s while the slow file it queued still ran. It holds for
 * the slow files the request queued, bounded by its ms.
 */

const saved = { ...process.env };
let runtimeDir: string;

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CODEX_SESSION_ID;
});

afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const SECOND = "test/slow-two.test.ts";

/** A worktree at revision 4 whose `slow` files are queued, and a daemon that took `run --slow`. */
async function slowQueued(slow: readonly string[], fast: readonly string[] = []) {
  const { repo, store } = repoWith([...slow, ...fast]);
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ slow: { include: slow } }));
  await fakeDaemon(socketPathFor(repo.mainId), {
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
  return { repo, store };
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

describe("squeal run --slow --wait holds for the slow files it queued (001-282)", () => {
  it("returns only once the queued slow file has a result", async () => {
    const { repo, store } = await slowQueued([SLOW_FILE]);
    later(1_200, () => finish(store, repo.mainId, SLOW_FILE));

    const result = await run(["run", "--slow", "--wait", "60000"], repo.main);

    expect(result.code).toBe(0);
    expect(result.ms).toBeGreaterThanOrEqual(1_200);
    expect(result.ms).toBeLessThan(10_000);
    expect(result.stdout).toMatch(
      /^Slow tier requested at revision 4: 1 slow file queued; [^\n]*\nReturned on quiet: [^\n]*; the 1 slow file run --slow queued has its result\n\nRevision/,
    );
  });

  it("returns on timeout naming the slow files still pending", async () => {
    const { repo, store } = await slowQueued([SLOW_FILE, SECOND]);
    later(200, () => finish(store, repo.mainId, SECOND));

    const result = await run(["run", "--slow", "--wait", "1000"], repo.main);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /\nReturned on timeout after 1\.\d s: [^\n]*; 1 of the 2 slow files run --slow queued pending: test\/slow\.test\.ts\n/,
    );
  });

  it("ends on news of a queued slow file's checks", async () => {
    const { repo, store } = await slowQueued([SLOW_FILE, SECOND]);
    later(300, () => fail(store, repo.mainId, check(SLOW_FILE, "holds")));

    const result = await run(["run", "--slow", "--wait", "60000"], repo.main);

    expect(result.ms).toBeLessThan(10_000);
    expect(result.stdout).toMatch(/\nReturned on news: 1 transition[^\n]*; 1 of the 2 slow files/);
  });

  it("does not hold for fast files outside the edit", async () => {
    const { repo, store } = await slowQueued([SLOW_FILE], [A]);
    later(300, () => finish(store, repo.mainId, SLOW_FILE));

    const result = await run(["run", "--slow", "--wait", "60000"], repo.main);

    expect(result.ms).toBeLessThan(10_000);
    expect(result.stdout).toMatch(/\nReturned on quiet: /);
  });
});

describe("squeal status --wait does not hold for slow files, and says so (001-282)", () => {
  it("returns quiet at once while a slow file is pending, naming the command that waits", async () => {
    const { repo } = await slowQueued([SLOW_FILE]);

    const result = await run(["status", "--wait", "60000"], repo.main);

    expect(result.ms).toBeLessThan(5_000);
    expect(result.stdout).toMatch(
      /^Returned on quiet: [^\n]*; 1 slow file is not current, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for it\n/,
    );
  });
});
