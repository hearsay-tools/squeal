import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../../src/cli/main.js";
import { closeLoopFixtures, scratch, socketPath, stalling } from "./fixture.js";

/*
 * Row 011-327 (decision 4 item 1, the coordinator's call of 2026-11-13):
 * the first request of `run --all` and `run --slow` ends by the deadline,
 * or without `--wait` by the request loop's own bound, as `run <group>`'s
 * does. A daemon that takes the request and gives no answer is words on
 * the no-verdict path, never a stack: exit 3 with `--wait`, 1 without.
 */

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  closeLoopFixtures();
});

/** A worktree whose daemon record names a stand-in that answers its ping and holds every other request. */
async function busyDaemon() {
  const w = scratch();
  const socket = socketPath();
  process.env.XDG_RUNTIME_DIR = dirname(socket);
  w.store.worktrees.setDaemon(w.id, {
    socketPath: socket as never,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  await stalling(socket, (type) => (type === "ping" ? {} : null));
  return w.root;
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
  };
  const started = performance.now();
  const code = await main(argv, io);
  return { code, stdout, stderr, ms: performance.now() - started };
}

const MAY = "it may still take it once its current work allows";

describe("the first run --all and run --slow request on a busy daemon (row 011-327)", {
  timeout: 20_000,
}, () => {
  it.each([
    ["--all", ["run", "--all", "--wait", "300"]],
    ["--slow", ["run", "--slow", "--wait", "300"]],
  ])("run %s --wait: ends by the deadline, no verdict, exit 3", async (flag, argv) => {
    const root = await busyDaemon();
    const result = await run(argv, root);
    expect(result).toMatchObject({
      code: 3,
      stdout: `No verdict: the daemon did not answer the run ${flag} request before the deadline; ${MAY}\n`,
      stderr: "",
    });
    expect(result.ms).toBeLessThan(1_500);
  });

  it.each([
    ["--all", ["run", "--all"]],
    ["--slow", ["run", "--slow"]],
  ])("run %s without --wait: the 2 s bound, on stderr, exit 1", async (flag, argv) => {
    const root = await busyDaemon();
    const result = await run(argv, root);
    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: `squeal: the daemon did not answer the run ${flag} request within 2 s; ${MAY}\n`,
    });
    expect(result.ms).toBeLessThan(3_500);
  });
});
