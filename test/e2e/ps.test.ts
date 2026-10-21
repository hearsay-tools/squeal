import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { psCommand } from "../../src/cli/ps.js";
import { currentUid } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { PsSnapshot } from "../../src/core/ps/shape.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { e2eSuite, PLUGINS, until } from "./harness.js";
import {
  ancestors,
  countingSocket,
  daemonIn,
  filesState,
  killed,
  psJson,
  scratchEnv,
  shippedPs,
  socketOf,
  startDaemon,
  storeFiles,
  whileStopped,
} from "./ps-support.js";
import { SLOW_TUNING } from "./slow-shape.js";

/*
 * Spec 014 Testing, Integration, No side effects and Proof (task 014-14):
 * the shipped `squeal ps` beside a real daemon in a scratch repository,
 * which the plugin's SessionStart spawns with HOME and TMPDIR under the
 * fixture and its own XDG_RUNTIME_DIR. The Claude Code plugin alone: `ps`
 * is one CLI in both bundles, and every case starts a daemon. The host's
 * other daemons share /proc, so each case reads its own daemon's entries.
 */

const fixture = e2eSuite();

const CLAUDE_CODE = PLUGINS.find((p) => p.name === "claude-code");
if (CLAUDE_CODE === undefined) throw new Error("no Claude Code plugin");

const VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "plugins/claude-code/package.json"), "utf8")) as {
    version: string;
  }
).version;

/** How long the slow file sleeps: far past one snapshot's 2 s window. */
const SLOW_SLEEP_MS = 30_000;

/** `test/slow.test.ts` declared slow, so the baseline runs it in the slow lane on idle (004 D2). */
const SLOW_FIXTURE = {
  slow: true,
  files: {
    "src/slow.ts": `export const SLOW_MS = ${SLOW_SLEEP_MS};\nexport const double = (n: number) => n * 2;\n`,
  },
  policy: { slow: { include: ["test/slow.test.ts"], ...SLOW_TUNING } },
};

/** Past D7's `leftover-temp` age, an hour unchanged. */
const TWO_HOURS_MS = 2 * 3_600_000;

describe("squeal ps beside a real daemon (spec 014 Testing)", () => {
  it("lists the fixture daemon serving, its socket tied to it", async (ctx) => {
    const e = fixture(ctx, CLAUDE_CODE);
    const env = scratchEnv(e);
    const pid = await startDaemon(e, env);
    const socket = socketOf(e);
    expect(existsSync(socket)).toBe(true);

    const { shape } = await psJson(e, env);
    const repository = shape.repositories.find((r) => r.commonDir === join(e.main, ".git"));
    expect(repository?.daemons.map((d) => d.pid)).toEqual([pid]);
    expect(daemonIn(shape, pid)).toMatchObject({
      phase: "serving",
      state: "serving",
      worktreeId: worktreeIdFor(e.main),
      root: e.main,
      version: VERSION,
      flags: [],
    });
    // Tied (D2 step 4): a socket of no daemon is a stale-socket file, or with a listener an unknown entry.
    expect(shape.files.map((f) => f.path)).not.toContain(socket);
    expect(shape.unknown.map((u) => u.what)).not.toContain(`socket ${socket}`);
  }, 120_000);

  it("lists its test processes under it during a slow tier", async (ctx) => {
    const e = fixture(ctx, CLAUDE_CODE, SLOW_FIXTURE);
    const env = scratchEnv(e);
    const pid = await startDaemon(e, env);

    const seen = await until(
      "a snapshot of the slow tier with a test process",
      60_000,
      async () => {
        const daemon = daemonIn((await psJson(e, env, ["--repo"])).shape, pid);
        const tier = daemon?.work.tiers.find((t) => t.lane === "slow");
        return daemon !== null && tier !== undefined && daemon.processes.length > 0
          ? { daemon, tier }
          : null;
      },
    );
    expect(seen.tier.files).toBe(1);
    const served = seen.daemon.processes.filter((p) => p.runId === seen.tier.runId);
    expect(served.length).toBeGreaterThan(0);
    for (const p of seen.daemon.processes) {
      // Its own child or below, as the ppid tree says (D5's owner rule).
      expect(ancestors(p.pid)).toContain(pid);
      expect(p).toMatchObject({ escaped: false, flags: [] });
    }
    for (const p of served) expect(p).toMatchObject({ lane: "slow:vitest", runner: "vitest" });
  }, 180_000);

  it("flags its socket stale-socket after a SIGKILL", async (ctx) => {
    const e = fixture(ctx, CLAUDE_CODE);
    const env = scratchEnv(e);
    const pid = await startDaemon(e, env);
    await e.settle(e.main, "the baseline");
    const socket = socketOf(e);
    await killed(pid);
    expect(existsSync(socket)).toBe(true);

    // `--repo` keeps the stale socket of its own worktree id and nothing of the host (D1).
    const { code, shape } = await psJson(e, env, ["--repo"]);
    expect(daemonIn(shape, pid)).toBeNull();
    expect(shape.files).toEqual([
      {
        flag: "stale-socket",
        reason: expect.stringContaining(
          `no live daemon of worktree ${worktreeIdFor(e.main)} holds its lock`,
        ),
        path: socket,
        count: 1,
        bytes: expect.any(Number),
        command: `rm ${socket}`,
      },
    ]);
    expect(code).toBe(1);
  }, 180_000);

  it("flags root-gone when its root is removed under it while it is stopped", async (ctx) => {
    const e = fixture(ctx, CLAUDE_CODE);
    const env = scratchEnv(e);
    const pid = await startDaemon(e, env);
    await e.settle(e.main, "the baseline");

    // Stopped, it cannot see its root go and exit on it (011 C9).
    const daemon = await whileStopped(pid, async () => {
      rmSync(e.main, { recursive: true, force: true });
      return daemonIn((await psJson(e, env, [], e.base)).shape, pid);
    });
    expect(daemon?.flags).toEqual([
      { flag: "root-gone", reason: `its root ${e.main} is missing`, command: `kill ${pid}` },
    ]);
  }, 180_000);

  it("writes no store byte and connects to no socket", async (ctx) => {
    const e = fixture(ctx, CLAUDE_CODE);
    const env = scratchEnv(e);
    const pid = await startDaemon(e, env);
    await e.settle(e.main, "the baseline");
    // A listener of no daemon's id: `ps` names it unknown, and must not knock.
    const other = await countingSocket(join(e.runtime, "squeal-0123456789abcdef.sock"));
    try {
      // Stopped, the daemon writes nothing, so every byte that moves would be `ps`'s.
      await whileStopped(pid, async () => {
        const files = storeFiles(e);
        const before = { store: filesState(files), runtime: readdirSync(e.runtime).sort() };
        const text = await shippedPs(e, env, ["--full"]);
        const { shape } = await psJson(e, env, ["--full"]);
        expect(text.stdout.split("\n")[0]).toMatch(/^squeal ps · /);
        // It read the live store: the phase needs the daemon's own record (D2).
        expect(daemonIn(shape, pid)?.phase).toBe("serving");
        expect(shape.unknown).toContainEqual({
          what: `socket ${other.path}`,
          why: expect.stringContaining("a process listens at it"),
        });
        expect({ store: filesState(files), runtime: readdirSync(e.runtime).sort() }).toEqual(
          before,
        );
        expect(storeFiles(e)).toEqual(files);
        expect(other.connections()).toBe(0);
      });
    } finally {
      await other.close();
    }
  }, 180_000);
});

describe("squeal ps --leftovers on real processes (spec 014 D7)", () => {
  /**
   * `ps` from the source, since the shipped CLI reads `/tmp`, which this host
   * shares: its leftovers would be listed too. The scratch temp directory
   * stands in for `/tmp` (`PsCommandOptions.tempDir`); the processes are the
   * host's own.
   */
  async function sourcePs(args: readonly string[], scratch: string) {
    let stdout = "";
    let stderr = "";
    const io = {
      stdout: (t: string) => {
        stdout += t;
      },
      stderr: (t: string) => {
        stderr += t;
      },
      cwd: scratch,
      env: {
        HOME: join(scratch, "home"),
        XDG_RUNTIME_DIR: join(scratch, "run"),
        TMPDIR: join(scratch, "tmp"),
      },
    };
    const code = await psCommand(args, io, { tempDir: join(scratch, "tmp") });
    return { code, stdout, stderr };
  }

  it("lists an old unused temp directory alone, never one a child works in", async () => {
    const scratch = runtimeDir();
    const keys = join(scratch, "tmp", `squeal-${currentUid()}`, "tmp");
    const held = join(keys, "held by a child");
    const unused = join(keys, "0123456789abcdef");
    for (const dir of [held, unused, join(scratch, "home"), join(scratch, "run")]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const dir of [held, unused]) writeFileSync(join(dir, "file"), "x");
    const child = spawn("sleep", ["300"], { cwd: held, stdio: "ignore" });
    try {
      await once(child, "spawn");
      const then = (Date.now() - TWO_HOURS_MS) / 1000;
      for (const dir of [held, unused]) utimesSync(dir, then, then);

      expect(await sourcePs(["--leftovers"], scratch)).toEqual({
        code: 0,
        stdout: `${unused}\n`,
        stderr: "",
      });
      const json = await sourcePs(["--json"], scratch);
      const shape = JSON.parse(json.stdout) as PsSnapshot;
      expect(shape.files.filter((f) => f.flag === "leftover-temp")).toMatchObject([{ count: 1 }]);
    } finally {
      child.kill();
    }
  }, 60_000);
});
