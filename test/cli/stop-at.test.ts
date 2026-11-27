import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { stopCommand } from "../../src/cli/stop.js";
import { ensureCommitWorktree } from "../../src/core/checkout/commit-worktree.js";
import { readMarker, writeMarker } from "../../src/core/checkout/marker.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type CommitFixture, commitFixture, countingInstall } from "../checkout/commit-fixture.js";

/*
 * Row 023-38 (spec 023 D7.7): `squeal stop --at <commit>` stops the commit
 * daemon at that commit, waits for its process to go, and removes its
 * worktree; plain `squeal stop` in the user's worktree leaves commit
 * worktrees alone. The daemon is a stand-in: a socket that answers `stop`
 * by ending a sleeping child that claimed the worktree.
 */

const saved = { ...process.env };
let fx: CommitFixture;
const servers: Server[] = [];

beforeEach(() => {
  fx = commitFixture();
  process.env.XDG_RUNTIME_DIR = fx.base;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  rmSync(fx.base, { recursive: true, force: true });
  process.env = { ...saved };
});

const ensure = (commit: string) =>
  ensureCommitWorktree({
    root: fx.repo,
    commit,
    dir: fx.dir,
    cacheRoot: fx.cacheRoot,
    install: countingInstall([]),
  });

/** The stand-in's child: its pid, whether the stop's kill was sent, and its exit once reaped. */
interface StandIn {
  readonly pid: number;
  readonly killed: () => boolean;
  readonly exited: Promise<void>;
}

/**
 * A stand-in commit daemon for `tree`: a child that claimed it, and a socket whose `stop` ends it.
 * With `slowExit`, the stop first closes the socket, then removes the tree as the real daemon's
 * exit does, slowly: its `.git` file first, so the marker no longer reads, the rest after
 * `slowExit` ms, and only then the process ends (review 0.1.596 B1).
 */
function commitDaemon(tree: AbsolutePath, slowExit?: number): Promise<StandIn> {
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  const pid = child.pid as number;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  const standIn = { pid, killed: () => child.killed, exited };
  const folder = join(tree, "..");
  const marker = readMarker(folder);
  if (marker === null) throw new Error("no marker");
  writeMarker(folder, { ...marker, daemon: leaseProcess(pid) });
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const { type } = JSON.parse(data.toString()) as { type: string };
        const ping = { pid, startedAt: 1, worktreeId: worktreeIdFor(tree), root: tree };
        const answer = { schemaVersion: 1, ok: true, type, ...(type === "ping" ? ping : {}) };
        socket.end(`${JSON.stringify(answer)}\n`);
        if (type === "stop") {
          server.close();
          if (slowExit === undefined) child.kill("SIGTERM");
          else void removeSlowly(tree, slowExit).then(() => child.kill("SIGTERM"));
        }
      });
    });
    servers.push(server);
    server.listen(socketPathFor(worktreeIdFor(tree)), () => resolve(standIn));
  });
}

async function removeSlowly(tree: AbsolutePath, ms: number): Promise<void> {
  rmSync(join(tree, ".git"));
  await sleep(ms);
  rmSync(join(tree, ".."), { recursive: true, force: true });
}

async function stop(args: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    env: { XDG_CACHE_HOME: join(fx.base, "cache") },
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: fx.repo,
    now: () => 5_000,
  };
  const code = await stopCommand(args, io);
  return { code, stdout, stderr };
}

describe("squeal stop --at <commit> (row 023-38)", () => {
  it("stops the commit daemon at that commit and removes its worktree, and no other", async () => {
    const at = await ensure("HEAD~1");
    const other = await ensure("HEAD");
    await commitDaemon(at.tree);

    expect(await stop(["--at", "HEAD~1"])).toEqual({
      code: 0,
      stdout: `Commit daemon stopped at ${fx.first.slice(0, 12)}; removed ${at.tree}\n`,
      stderr: "",
    });
    expect(existsSync(at.folder)).toBe(false);
    expect(existsSync(other.tree)).toBe(true);
  });

  it("waits for the daemon whose exit is still removing its worktree (review 0.1.596 B1)", async () => {
    const at = await ensure("HEAD~1");
    const daemon = await commitDaemon(at.tree, 1_000);

    expect(await stop(["--at", "HEAD~1"])).toEqual({
      code: 0,
      stdout: `Commit daemon stopped at ${fx.first.slice(0, 12)}; removed ${at.tree}\n`,
      stderr: "",
    });
    expect(existsSync(at.folder)).toBe(false);
    // Row 011-430: the stand-in sends its kill only after the slow removal; a killed child
    // lives on unreaped for a moment, so its kill is read here and its exit awaited.
    expect(daemon.killed()).toBe(true);
    await daemon.exited;
  });

  it("removes a worktree whose daemon is not running, and says when there is none", async () => {
    const at = await ensure(fx.second);

    expect((await stop(["--at", fx.second])).stdout).toBe(
      `No commit daemon ran at ${fx.second.slice(0, 12)}; removed ${at.tree}\n`,
    );
    expect(await stop(["--at", fx.second])).toEqual({
      code: 0,
      stdout: `No commit worktree at ${fx.second.slice(0, 12)}\n`,
      stderr: "",
    });
  });

  it("refuses a revision that names no commit, and a call without one", async () => {
    const bad = await stop(["--at", "no-such-ref"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/^squeal stop --at: no-such-ref names no commit here/);
    expect(await stop(["--at"])).toEqual({
      code: 2,
      stdout: "",
      stderr: "usage: squeal stop --at <commit>\n",
    });
  });

  it("is never reached by plain squeal stop in the user's worktree", async () => {
    const at = await ensure("HEAD~1");
    const { pid } = await commitDaemon(at.tree);

    const plain = await stop([]);
    expect(plain.code).toBe(0);
    expect(existsSync(at.tree)).toBe(true);
    expect(() => process.kill(pid, 0)).not.toThrow();
    await stop(["--at", "HEAD~1"]);
  });
});
