import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { endCommandHolds, holdCommand } from "../../src/cli/hold.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { readCommandHolds } from "../../src/core/scheduler/hold-rows.js";
import type {
  AbsolutePath,
  DaemonRequest,
  DaemonResponse,
  Store,
} from "../../src/core/types/index.js";
import { hold, liveProcess } from "../scheduler/command-hold-fixture.js";
import { fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 011-74 (011 C9 as amended 2026-10-21, *Hold command*;
 * `tasks/011-61/design.md` R3, test 1's exit codes): `squeal hold` adds its
 * entry, asks the daemon to hold and waits for its cancel, runs the command
 * with the inherited stdio, removes its entry and asks the daemon to resume,
 * and exits with the command's code. Without a store it only runs the
 * command. The daemon here is a stand-in that records the requests.
 */

function capture(cwd: string): { io: CliIo; err: () => string } {
  let err = "";
  return {
    io: {
      stdout: () => {},
      stderr: (text) => {
        err += text;
      },
      cwd,
      env: {},
    },
    err: () => err,
  };
}

/** A stand-in daemon: `hold` settles after `pending` status asks; it records each request. */
function daemon(pending = 0) {
  const asked: DaemonRequest[] = [];
  let left = pending;
  const answer = (settled: boolean): DaemonResponse => ({
    schemaVersion: 1,
    ok: true,
    type: "hold",
    requestId: "r1",
    settled,
    holding: settled ? true : null,
    error: null,
  });
  const ask = async (_root: AbsolutePath, request: DaemonRequest) => {
    asked.push(request);
    if (request.type === "hold") return answer(left === 0);
    if (request.type === "hold-status") return answer(--left <= 0);
    return { schemaVersion: 1, ok: true, type: "resume" } as DaemonResponse;
  };
  return { asked, ask };
}

function withRepo() {
  const repo = fakeRepo();
  const store: Store = seedStore(repo);
  return { repo, store, holds: () => readCommandHolds(store, repo.mainId) };
}

describe("squeal hold (row 011-74)", { timeout: 30_000 }, () => {
  it.each([
    ["exit 0", 0],
    ["exit 7", 7],
    ["kill -TERM $$", 143],
  ])("exits with the command's code: `sh -c '%s'` exits %i", async (script, code) => {
    const { repo, holds } = withRepo();
    const fake = daemon();
    const { io } = capture(repo.main);

    expect(await holdCommand(["--", "sh", "-c", script], io, { ask: fake.ask })).toBe(code);
    expect(fake.asked.map((r) => r.type)).toEqual(["hold", "resume"]);
    expect(holds()).toEqual([]);
  });

  it("holds while the command runs: its entry names the command, both processes and `--max`", async () => {
    const { repo, holds } = withRepo();
    const fake = daemon();
    const { io, err } = capture(repo.main);
    const started = Date.now();

    const exit = holdCommand(["--max", "2s", "--", "sleep", "1"], io, { ask: fake.ask });
    await expect.poll(() => holds()[0]?.child ?? null).not.toBeNull();
    const [entry] = holds();
    expect(entry?.command).toBe("sleep 1");
    expect(entry?.wrapper?.pid).toBe(process.pid);
    expect(entry?.child?.pid).not.toBe(process.pid);
    expect((entry?.until ?? 0) - (entry?.since ?? 0)).toBe(2_000);
    expect(entry?.since).toBeGreaterThanOrEqual(started);
    expect(err()).toMatch(
      /^squeal: validation of .* is on hold until `sleep 1` exits, at most until \d\d:\d\d:\d\d \(2 s\); edits are recorded and not run\n$/,
    );

    expect(await exit).toBe(0);
    expect(holds()).toEqual([]);
  });

  it("starts the command once the daemon's cancel ended, and waits for it at most its bound", async () => {
    const { repo } = withRepo();
    const settles = daemon(3);
    const { io } = capture(repo.main);
    expect(await holdCommand(["--", "true"], io, { ask: settles.ask })).toBe(0);
    expect(settles.asked.map((r) => r.type)).toEqual([
      "hold",
      "hold-status",
      "hold-status",
      "hold-status",
      "resume",
    ]);

    const never = daemon(1_000);
    const began = performance.now();
    expect(await holdCommand(["--", "true"], io, { ask: never.ask, holdWaitMs: 300 })).toBe(0);
    expect(performance.now() - began).toBeLessThan(2_000);
  });

  it("passes SIGTERM on to the command and exits 143", async () => {
    const { repo } = withRepo();
    const { io } = capture(repo.main);
    const exit = holdCommand(["--", "sleep", "30"], io, { ask: daemon().ask });
    await expect.poll(() => process.listenerCount("SIGTERM")).toBeGreaterThan(0);
    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(143);
  });

  it("removes its entry when the command cannot start, and exits 127", async () => {
    const { repo, holds } = withRepo();
    const fake = daemon();
    const { io, err } = capture(repo.main);
    expect(await holdCommand(["--", "squeal-no-such-command"], io, { ask: fake.ask })).toBe(127);
    expect(err()).toContain("squeal hold: could not run squeal-no-such-command");
    expect(holds()).toEqual([]);
  });

  it("without a store runs the command, says nothing is on hold and creates no store", async () => {
    const repo = fakeRepo();
    const fake = daemon();
    const { io, err } = capture(repo.main);
    expect(await holdCommand(["--", "sh", "-c", "exit 3"], io, { ask: fake.ask })).toBe(3);
    expect(err()).toBe("squeal: nothing is on hold: no Squeal daemon has run in this worktree\n");
    expect(fake.asked).toEqual([]);
    expect(existsSync(join(repo.commonDir, "squeal"))).toBe(false);
  });

  it("names a daemon that cannot hold, and runs the command", async () => {
    const { repo, holds } = withRepo();
    const { io, err } = capture(repo.main);
    const older = async () =>
      ({ schemaVersion: 1, ok: false, error: 'unknown request type "hold"' }) as DaemonResponse;
    expect(await holdCommand(["--", "true"], io, { ask: older })).toBe(0);
    expect(err()).toContain(
      '; the running daemon did not take the hold (unknown request type "hold"), so its tiers run on\n',
    );
    expect(holds()).toEqual([]);
  });

  it("refuses a usage without a command or with a bad `--max`", async () => {
    const { repo } = withRepo();
    const { io, err } = capture(repo.main);
    expect(await holdCommand([], io)).toBe(2);
    expect(await holdCommand(["--max", "soon", "--", "true"], io)).toBe(2);
    expect(err()).toContain('--max takes a duration such as 90s, 30m, 2h or 1d, not "soon"');
  });

  it("leaves `--help` after `--` to the command", async () => {
    const repo = fakeRepo();
    const { io } = capture(repo.main);
    let out = "";
    const code = await main(["hold", "--", "sh", "-c", "exit 5", "--help"], {
      ...io,
      stdout: (text) => {
        out += text;
      },
    });
    expect(code).toBe(5);
    expect(out).toBe("");
  });

  it("`squeal start` removes every entry and names those whose command still runs", async () => {
    const { repo, store, holds } = withRepo();
    const side = { store, worktreeId: repo.mainId };
    const live = await liveProcess();
    hold(side, live.identity, { command: "npm run gate", wrapper: null });
    const gone = { ...live.identity, startTime: live.identity.startTime + 1 };
    hold(side, gone, { command: "npm test", wrapper: gone });

    expect(endCommandHolds(repo.main as AbsolutePath)).toEqual([
      `Ended the hold for \`npm run gate\` (pid ${live.identity.pid}); the command still runs\n`,
    ]);
    expect(holds()).toEqual([]);
    expect(live.child.exitCode).toBeNull();
  });
});
