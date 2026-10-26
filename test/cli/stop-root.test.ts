import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { stopCommand } from "../../src/cli/stop.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { noDaemonLine, stoppedLine } from "./stop-lines.js";

/*
 * Task 011-09 (hearsay-tools/squeal#25, C1, C9): `squeal stop <root>` stops
 * only that root's daemon. An explicit root never resolves to the checkout
 * around it: a missing one reports the path and stops nothing (exit 1), an
 * existing one with no daemon reports none there (exit 0).
 */

const saved = { ...process.env };
let dir: string;
const servers: Server[] = [];

beforeEach(() => {
  dir = realpathSync(mkdtempSync("/tmp/sq-"));
  process.env.XDG_RUNTIME_DIR = dir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A checkout with one commit and a linked worktree inside it, as a harness's worker has. */
function checkout(): { main: string; linked: string } {
  const main = join(dir, "main");
  mkdirSync(main);
  git(main, ["init", "-q"]);
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, ["add", "a.txt"]);
  git(main, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
  const linked = join(main, ".worktrees", "w1");
  git(main, ["worktree", "add", "-q", linked]);
  return { main, linked };
}

/** A pid no process has, so no process counts as one the stand-in started. */
const GONE_PID = Number.parseInt(
  spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout,
  10,
);

/** A stand-in daemon for `root`, answering ping and stop; `asked` lists what it was asked. */
function fakeDaemon(root: string): Promise<{ asked: string[] }> {
  const worktreeId = worktreeIdFor(root as AbsolutePath);
  const asked: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        asked.push(request.type);
        const base = { schemaVersion: 1, ok: true, type: request.type };
        const ping = {
          pid: GONE_PID,
          worktreeId,
          root,
          squealVersion: "0.0.0-test",
          phase: "ready",
        };
        const answer = request.type === "ping" ? { ...base, ...ping, startedAt: 1 } : base;
        socket.end(`${JSON.stringify(answer)}\n`);
      });
    });
    servers.push(server);
    server.listen(socketPathFor(worktreeId), () => resolve({ asked }));
  });
}

async function stop(args: string[], cwd: string) {
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
  const code = await stopCommand(args, io);
  return { code, stdout, stderr };
}

describe("squeal stop <root> stops only that root's daemon (task 011-09, #25)", () => {
  it("reports a missing explicit root and stops nothing, exit 1", async () => {
    const { main } = checkout();
    const daemon = await fakeDaemon(main);
    const missing = join(main, "gone");
    const result = await stop([missing], main);
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `squeal: ${missing} does not exist; nothing stopped\n`,
    });
    expect(daemon.asked).toEqual([]);
  });

  it("resolves a relative explicit root against the CLI's cwd", async () => {
    const { main } = checkout();
    const result = await stop(["gone"], main);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`squeal: ${join(main, "gone")} does not exist; nothing stopped\n`);
  });

  it("reports no daemon at an existing explicit root, exit 0, and leaves its checkout's daemon up", async () => {
    const { main, linked } = checkout();
    const daemon = await fakeDaemon(main);
    const result = await stop([linked], main);
    expect(result).toEqual({ code: 0, stdout: noDaemonLine(linked), stderr: "" });
    expect(daemon.asked).toEqual([]);
  });

  it("leaves the enclosing checkout's daemon up for a removed linked worktree", async () => {
    const { main, linked } = checkout();
    git(main, ["worktree", "remove", linked]);
    const daemon = await fakeDaemon(main);
    const removed = await stop([linked], main);
    expect(removed).toMatchObject({ code: 1, stdout: "" });
    expect(removed.stderr).toBe(`squeal: ${linked} does not exist; nothing stopped\n`);
    // A directory left behind at the removed path is no worktree root either.
    mkdirSync(linked, { recursive: true });
    const left = await stop([linked], main);
    expect(left).toEqual({
      code: 1,
      stdout: "",
      stderr: `squeal: ${linked} is not a worktree root (it lies inside ${main}); nothing stopped\n`,
    });
    expect(daemon.asked).toEqual([]);
  });

  it("an explicit root that is the checkout stops its daemon", async () => {
    const { main } = checkout();
    const daemon = await fakeDaemon(main);
    const stopping = stop([main], dir);
    // The stand-in keeps serving, so close it once asked to stop, as a daemon does.
    const result = await Promise.race([
      stopping,
      new Promise<null>((resolve) => {
        const timer = setInterval(() => {
          if (!daemon.asked.includes("stop")) return;
          clearInterval(timer);
          for (const s of servers.splice(0)) s.close();
          resolve(null);
        }, 10);
      }),
    ]).then((first) => first ?? stopping);
    expect(daemon.asked).toContain("stop");
    expect(result).toMatchObject({ code: 0, stdout: stoppedLine(main) });
  });
});
