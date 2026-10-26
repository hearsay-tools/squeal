import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { clearStartMark } from "../../src/core/daemon/start-mark.js";
import { headerLines } from "../../src/core/delivery/header.js";
import { DAEMON_START_GRACE_MS, readLiveHeader } from "../../src/core/delivery/liveness.js";
import { markStopped } from "../../src/core/delivery/stopped.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Review 0.1.357 B1 (row 011-254, 011 C9): `squeal stop --until-start` whose
 * mark lands while a SessionStart spawns a daemon, after the hook found no
 * mark (the window of row 011-20). While that start is current every reader
 * says a daemon is starting; after its first heartbeat it is alive; once it
 * exits, the same mark reads as stopped until `squeal start`, and no
 * boundary spawns another.
 */

const T = Date.UTC(2026, 0, 2, 14, 2);
const STARTING = "A daemon is starting; results are as of revision 1.";
const MODE =
  "The daemon is stopped until `squeal start` (`squeal stop --until-start`); no edit or Git operation starts one; results are as of revision 1.";
const context = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** Hook deps at clock `now` whose `ensureDaemon` runs `onEnsure`, counts the call and spawns. */
function deps(now: number, spawns: number[], onEnsure?: () => void): HookDeps {
  return {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    now: () => now as EpochMs,
    ensureDaemon: async () => {
      onEnsure?.();
      spawns.push(now);
      return "spawned";
    },
  };
}

/** What every reader says at `now`: status's JSON, plain and `--full` text, a header, the wait. */
async function readers(r: SquealRepo, now: number) {
  const id = r.worktreeId as WorktreeId;
  const cli = async (argv: string[]) => {
    let stdout = "";
    const io: CliIo = {
      stdout: (out) => {
        stdout += out;
      },
      stderr: () => {},
      cwd: r.root,
      now: () => now as EpochMs,
      env: {},
    };
    await main(argv, io);
    return stdout;
  };
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, id);
  const watch = watchDaemon(id, { lockFile, commonDir: r.repo.commonDir as AbsolutePath });
  return {
    json: JSON.parse(await cli(["status", "--json"])).daemon,
    plain: await cli(["status"]),
    full: await cli(["status", "--full"]),
    header: headerLines(readLiveHeader(r.store, id, now as EpochMs), "squeal").join("\n"),
    wait: watch.judge(r.store.worktrees.get(id)?.daemon ?? null, now as EpochMs),
  };
}

describe("a stop `--until-start` that lands while a SessionStart spawns (review 0.1.357 B1)", () => {
  it("reads as starting, then alive, then stopped until `squeal start` with no further spawn", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const id = r.worktreeId as WorktreeId;
    const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, id);
    const spawns: number[] = [];
    // `squeal stop --until-start` leaves its mark after this hook found none.
    const stop = () =>
      r.store.transaction(() => markStopped(r.store, id, (T + 1) as EpochMs, null, true));
    const batch = (now: number) =>
      runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps(now, spawns));

    const start = await runHook("session-start", recorded("session-start", r.root), {
      ...deps(T, spawns, stop),
    });
    expect(context(start)).toContain(` ${STARTING}`);
    expect(context(start)).not.toContain("stopped until");
    const starting = await readers(r, T + 1_000);
    expect(starting.json).toMatchObject({ state: "down", startMark: "spawn" });
    expect(starting.json).not.toHaveProperty("stopped");
    expect(starting.json).not.toHaveProperty("untilStart");
    expect(starting.plain).toContain("a hook started a daemon that does not serve yet");
    expect(starting.plain).not.toContain("stopped until");
    expect(starting.full).toMatch(/^Daemon: no daemon running; a daemon is starting$/m);
    expect(starting.header).toContain(STARTING);
    expect(starting.wait).toEqual({ state: "lapsed", locked: true });
    expect(context(await batch(T + 1_000))).toBe("");

    // Its registration removes the spawn mark; its heartbeat says it serves.
    clearStartMark(lockFile);
    r.store.worktrees.setDaemon(id, {
      socketPath: `/tmp/squeal-test-${id}.sock`,
      startedAt: T + 1_500,
      heartbeatAt: T + 2_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    });
    const alive = await readers(r, T + 2_500);
    expect(alive.json).toMatchObject({ state: "alive" });
    expect(alive.json).not.toHaveProperty("untilStart");
    expect(alive.header).not.toContain("stopped");
    expect(alive.wait).toEqual({ state: "alive" });
    expect(context(await batch(T + 2_500))).toBe("");

    // It exits: its record cleared, its last heartbeat kept.
    r.store.worktrees.setDaemon(id, null);
    const exited = await batch(T + 3_000);
    expect(context(exited)).toMatch(
      /^SQUEAL · the daemon is stopped until `squeal start` at revision 1\n/,
    );
    expect(context(exited)).toContain(MODE);
    const stopped = await readers(r, T + 3_000);
    expect(stopped.json).toMatchObject({ state: "down", stopped: true, untilStart: true });
    expect(stopped.json).not.toHaveProperty("startingSince");
    expect(stopped.plain).toContain("stopped until `squeal start` (`squeal stop --until-start`)");
    expect(stopped.full).toMatch(/^Daemon: stopped until `squeal start` /m);
    expect(stopped.header).toContain(MODE);
    expect(stopped.wait).toEqual({ state: "down", reason: "stopped" });
    expect(context(await batch(T + 3_000 + DAEMON_START_GRACE_MS))).toBe("");

    expect(spawns).toEqual([T]);
  });
});
