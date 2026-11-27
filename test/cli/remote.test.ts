import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { askDaemon } from "../../src/cli/daemon-access.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { type RemoteDeps, remoteCommand } from "../../src/cli/remote.js";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import {
  machinesPath,
  readMachines,
  recordMachine,
} from "../../src/core/runner-host/remote/machines-store.js";
import type { MachineRecord } from "../../src/core/runner-host/remote/provider.js";
import { remoteSettingsPath } from "../../src/core/runner-host/remote/settings.js";
import {
  type AbsolutePath,
  PAYLOAD_SCHEMA_VERSION,
  type WorktreeId,
} from "../../src/core/types/common.js";
import type {
  DaemonRequest,
  DaemonResponse,
  RemoteSleepOutcome,
} from "../../src/core/types/daemon.js";

/*
 * Spec 026 D12.3 to D12.5 (row 026-10): `squeal remote list|sleep|prune`
 * over a temp `XDG_STATE_HOME` and `XDG_CONFIG_HOME`; the hooks are Node
 * scripts in the scratch directory. None reads the real home or `~/.ssh`.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-remote-cli-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;

/** A user with `remote.json` naming a command lane for `/repo`, whose hooks log to `calls`. */
function user(hooks: { sleepExit?: number; releaseExit?: number } = {}) {
  const dir = join(scratch, `u${++n}`);
  const calls = join(dir, "calls.log");
  mkdirSync(join(dir, "config", "squeal"), { recursive: true });
  const hook = (name: string, exit: number) => {
    const script = join(dir, `${name}.mjs`);
    writeFileSync(
      script,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, "${name} " + process.env.SQUEAL_MACHINE_ID + " " + (process.env.SQUEAL_RELEASE_REASON ?? "-") + "\\n");
if (${exit}) { console.error("${name} failed"); process.exit(${exit}); }`,
    );
    return [process.execPath, script];
  };
  const env = {
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        "/repo": {
          provider: "command",
          providerConfig: {
            acquire: ["unused"],
            sleep: hook("sleep", hooks.sleepExit ?? 0),
            release: hook("release", hooks.releaseExit ?? 0),
          },
        },
        "/static": { target: "build-box" },
      },
    }),
  );
  const worktree = join(dir, "worktree");
  mkdirSync(join(worktree, "src"), { recursive: true });
  return {
    env,
    worktree,
    gone: join(dir, "removed-worktree"),
    calls: () => {
      try {
        return readFileSync(calls, "utf8").trim().split("\n");
      } catch {
        return [];
      }
    },
  };
}

function track(env: NodeJS.ProcessEnv, over: Partial<MachineRecord>): void {
  recordMachine(
    {
      provider: "command",
      id: "cmd:lan",
      worktreeId: "w",
      worktreeRoot: "/repo",
      repositoryKey: "/repo",
      destination: "dev@host",
      sshArgs: [],
      places: { node: "node", cache: "c" },
      capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
      status: "awake",
      createdAt: Date.UTC(2026, 10, 24, 8),
      lastUsedAt: Date.UTC(2026, 10, 24, 9),
      ...over,
    },
    env,
  );
}

async function remote(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = scratch,
  deps: RemoteDeps | null = null,
) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd,
    env,
  };
  const code =
    deps === null ? await main(["remote", ...args], io) : await remoteCommand(args, io, deps);
  return { code, stdout, stderr };
}

describe("squeal remote list (row 026-10)", () => {
  it("says none are tracked when the file is missing", async () => {
    const { env } = user();
    const out = await remote(["list"], env);
    expect(out).toEqual({
      code: 0,
      stdout: `No remote machines tracked (${machinesPath(env)}).\n`,
      stderr: "",
    });
  });

  it("lists each machine with its status and whether its worktree exists, in text and JSON", async () => {
    const { env, worktree, gone } = user();
    track(env, { worktreeId: "a", worktreeRoot: worktree });
    track(env, { worktreeId: "b", worktreeRoot: gone, id: "cmd:old", status: "sleeping" });
    const text = await remote(["list"], env);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      [
        `Remote machines (${machinesPath(env)}):`,
        `  cmd:lan  command  awake  ${worktree}  last used 2026-11-24T09:00:00.000Z`,
        `  cmd:old  command  sleeping  ${gone} (worktree removed)  last used 2026-11-24T09:00:00.000Z`,
        "1 machine of removed worktrees; `squeal remote prune` releases it.",
        "",
      ].join("\n"),
    );
    const json = JSON.parse((await remote(["list", "--json"], env)).stdout);
    expect(json.path).toBe(machinesPath(env));
    expect(
      json.machines.map((m: { id: string; worktreeExists: boolean }) => [m.id, m.worktreeExists]),
    ).toEqual([
      ["cmd:lan", true],
      ["cmd:old", false],
    ]);
  });

  it("shows how long each detached machine has had no daemon, in text and JSON (row 026-43)", async () => {
    const { env, worktree } = user();
    const detachedAt = Date.now() - (3 * 60 + 10) * 60_000 - 30_000;
    track(env, { worktreeId: "a", worktreeRoot: worktree, status: "detached", detachedAt });
    track(env, { worktreeId: "b", worktreeRoot: worktree, id: "cmd:on" });
    const text = await remote(["list"], env);
    expect(text.stdout.split("\n").slice(1, 3)).toEqual([
      `  cmd:lan  command  detached  ${worktree}  last used 2026-11-24T09:00:00.000Z  no daemon for 3 h 10 min`,
      `  cmd:on  command  awake  ${worktree}  last used 2026-11-24T09:00:00.000Z`,
    ]);
    const json = JSON.parse((await remote(["list", "--json"], env)).stdout);
    const [lan, on] = json.machines;
    expect(lan.noDaemonForMs).toBeGreaterThanOrEqual((3 * 60 + 10) * 60_000 + 30_000);
    expect(lan.noDaemonForMs).toBeLessThan((3 * 60 + 11) * 60_000);
    expect(on).not.toHaveProperty("noDaemonForMs");
  });

  it("times an older detached record without detachedAt by lastUsedAt (row 026-43)", async () => {
    const { env, worktree } = user();
    track(env, {
      worktreeRoot: worktree,
      status: "detached",
      lastUsedAt: Date.now() - 40 * 60_000,
    });
    expect((await remote(["list"], env)).stdout).toContain("  no daemon for 40 min\n");
  });

  it("names no prune when every tracked worktree exists (row 026-37)", async () => {
    const { env, worktree } = user();
    track(env, { worktreeId: "a", worktreeRoot: worktree });
    const text = await remote(["list"], env);
    expect(text.stdout).not.toContain("squeal remote prune");
  });

  it("exits 1 naming a file it cannot read", async () => {
    const { env } = user();
    mkdirSync(join(env.XDG_STATE_HOME, "squeal"), { recursive: true });
    writeFileSync(machinesPath(env), "[]");
    const out = await remote(["list"], env);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("is not a remote machines file");
  });
});

describe("squeal remote sleep (row 026-10)", () => {
  it("runs the sleep hook of the worktree holding the directory, and marks it sleeping", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    track(u.env, { worktreeId: "x", worktreeRoot: u.gone, id: "cmd:other" });
    const out = await remote(["sleep"], u.env, join(u.worktree, "src"));
    expect(out).toEqual({ code: 0, stdout: "cmd:lan: asked to sleep\n", stderr: "" });
    expect(u.calls()).toEqual(["sleep lan -"]);
    expect(readMachines(u.env).machines.map((m) => m.status)).toEqual(["sleeping", "awake"]);
  });

  it("takes the worktree as an argument", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const out = await remote(["sleep", u.worktree], u.env);
    expect(out.code).toBe(0);
    expect(u.calls()).toEqual(["sleep lan -"]);
  });

  it("exits 1 when no machine is tracked for the worktree, or its hook fails", async () => {
    const u = user({ sleepExit: 4 });
    expect((await remote(["sleep", u.worktree], u.env)).code).toBe(1);
    track(u.env, { worktreeRoot: u.worktree });
    const out = await remote(["sleep", u.worktree], u.env);
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(
      /^cmd:lan: not slept: the sleep hook .* exited with code 4: sleep failed\n$/,
    );
    expect(readMachines(u.env).machines[0]?.status).toBe("awake");
  });

  it("does nothing for a static ssh machine, and never marks it sleeping (review 0.1.616 B7)", async () => {
    const u = user();
    track(u.env, {
      provider: "ssh",
      id: "build-box",
      repositoryKey: "/static",
      destination: "build-box",
      worktreeRoot: u.worktree,
      capabilities: { hasGitRepository: false, sleepOnIdle: false, ephemeralHostKey: false },
    });
    const out = await remote(["sleep", u.worktree], u.env);
    expect(out).toEqual({
      code: 0,
      stdout: "build-box: always on; nothing to sleep\n",
      stderr: "",
    });
    expect(u.calls()).toEqual([]);
    expect(readMachines(u.env).machines[0]?.status).toBe("awake");
  });
});

describe("squeal remote sleep through the worktree's daemon (review 0.1.616 B7)", () => {
  /** A daemon whose `remote-sleep` settles with `outcome` at its second status ask. */
  const daemon = (outcome: RemoteSleepOutcome | null, asked: DaemonRequest[] = []): RemoteDeps => {
    let polls = 0;
    const answer = (settled: boolean): DaemonResponse => ({
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "remote-sleep",
      requestId: "s1",
      settled,
      outcome: settled ? outcome : null,
      error: settled && outcome === null ? "the sleep hook failed" : null,
    });
    return {
      ask: async (_root, request) => {
        asked.push(request);
        if (request.type === "remote-sleep") return answer(false);
        return answer(++polls >= 2);
      },
      pollMs: 1,
    };
  };

  it("lets the daemon close its channel and sleep the machine; runs no hook here", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const asked: DaemonRequest[] = [];
    const slept = { kind: "slept", provider: "command", machine: "cmd:lan" } as const;
    const out = await remote(["sleep", u.worktree], u.env, scratch, daemon(slept, asked));
    expect(out).toEqual({ code: 0, stdout: "cmd:lan: asked to sleep\n", stderr: "" });
    expect(asked.map((r) => r.type)).toEqual([
      "remote-sleep",
      "remote-sleep-status",
      "remote-sleep-status",
    ]);
    expect(u.calls()).toEqual([]);
  });

  it("refuses while a run is on the machine, and marks nothing sleeping", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const busy = {
      kind: "busy",
      provider: "command",
      machine: "cmd:lan",
      reason: "a run is on remote command",
    } as const;
    const out = await remote(["sleep", u.worktree], u.env, scratch, daemon(busy));
    expect(out).toEqual({
      code: 1,
      stdout: "",
      stderr: "cmd:lan: not slept: a run is on remote command\n",
    });
    expect(u.calls()).toEqual([]);
    expect(readMachines(u.env).machines[0]?.status).toBe("awake");
  });

  it("names the daemon's failure, and runs no hook here", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const out = await remote(["sleep", u.worktree], u.env, scratch, daemon(null));
    expect(out.code).toBe(1);
    expect(out.stderr).toBe("cmd:lan: not slept: the sleep hook failed\n");
    expect(u.calls()).toEqual([]);
  });

  it("refuses beside an older daemon, which cannot close its channel", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const older: RemoteDeps = {
      ask: async () => ({
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        ok: false,
        error: "unknown request type",
      }),
    };
    const out = await remote(["sleep", u.worktree], u.env, scratch, older);
    expect(out.code).toBe(1);
    expect(out.stderr).toBe(
      `cmd:lan: not slept: the daemon of ${u.worktree} cannot close its remote channel (unknown request type); run \`squeal stop\` there first\n`,
    );
    expect(u.calls()).toEqual([]);
  });

  it("runs the hook here when the daemon holds no machine", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const none = { kind: "none", reason: "remote command reached no machine yet" } as const;
    const out = await remote(["sleep", u.worktree], u.env, scratch, daemon(none));
    expect(out).toEqual({ code: 0, stdout: "cmd:lan: asked to sleep\n", stderr: "" });
    expect(u.calls()).toEqual(["sleep lan -"]);
    expect(readMachines(u.env).machines[0]?.status).toBe("sleeping");
  });

  it("asks a real daemon socket, and waits for its sleep to settle", async () => {
    const u = user();
    track(u.env, { worktreeRoot: u.worktree });
    const socketPath = join(u.worktree, "d.sock") as AbsolutePath;
    let settle = (_: RemoteSleepOutcome) => {};
    const handlers = createHandlers({
      worktreeId: "w" as WorktreeId,
      root: u.worktree as AbsolutePath,
      squealVersion: "0.0.0-test",
      startedAt: 1,
      token: "t",
      phase: () => "ready",
      requestFullSuite: () => new Promise(() => {}),
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
      requestRemoteSleep: () => new Promise((resolve) => (settle = resolve)),
    });
    const server = await createDaemonServer(socketPath, handlers);
    onTestFinished(() => server.close());
    setTimeout(() => settle({ kind: "slept", provider: "command", machine: "cmd:lan" }), 50);
    const deps: RemoteDeps = { ask: (_root, request) => askDaemon(socketPath, request), pollMs: 5 };
    const out = await remote(["sleep", u.worktree], u.env, scratch, deps);
    expect(out).toEqual({ code: 0, stdout: "cmd:lan: asked to sleep\n", stderr: "" });
    expect(u.calls()).toEqual([]);
  });
});

describe("squeal remote prune (row 026-10)", () => {
  it("--dry-run lists the machines of removed worktrees and releases none", async () => {
    const u = user();
    track(u.env, { worktreeId: "a", worktreeRoot: u.worktree });
    track(u.env, { worktreeId: "b", worktreeRoot: u.gone, id: "cmd:old" });
    const out = await remote(["prune", "--dry-run"], u.env);
    expect(out).toEqual({
      code: 0,
      stdout: `would release cmd:old (command) of removed worktree ${u.gone}\n`,
      stderr: "",
    });
    expect(u.calls()).toEqual([]);
    expect(readMachines(u.env).machines).toHaveLength(2);
  });

  it("releases each with worktree-removed and forgets it; keeps live worktrees' machines", async () => {
    const u = user();
    track(u.env, { worktreeId: "a", worktreeRoot: u.worktree });
    track(u.env, { worktreeId: "b", worktreeRoot: u.gone, id: "cmd:old" });
    const out = await remote(["prune"], u.env);
    expect(out).toEqual({
      code: 0,
      stdout: `released cmd:old (command) of removed worktree ${u.gone}\n`,
      stderr: "",
    });
    expect(u.calls()).toEqual(["release old worktree-removed"]);
    expect(readMachines(u.env).machines.map((m) => m.id)).toEqual(["cmd:lan"]);
    expect((await remote(["prune"], u.env)).stdout).toBe(
      "No tracked remote machine has a removed worktree or is unused.\n",
    );
  });

  it("keeps a machine whose release fails or whose remote.json entry is gone, and exits 1", async () => {
    const u = user({ releaseExit: 2 });
    track(u.env, { worktreeId: "b", worktreeRoot: u.gone, id: "cmd:old" });
    track(u.env, { worktreeId: "c", worktreeRoot: u.gone, id: "cmd:lost", repositoryKey: "/nope" });
    const out = await remote(["prune"], u.env);
    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("not released, still tracked: the release hook");
    expect(out.stderr).toContain("remote.json names no command lane for /nope");
    expect(readMachines(u.env).machines).toHaveLength(2);
  });

  it("--dry-run names an unused machine and why; the prune releases it unused (row 026-43)", async () => {
    const u = user();
    const detachedAt = Date.now() - 25 * 3_600_000 - 5 * 60_000;
    track(u.env, { worktreeId: "a", worktreeRoot: u.worktree, status: "detached", detachedAt });
    track(u.env, {
      worktreeId: "b",
      worktreeRoot: u.worktree,
      id: "cmd:fresh",
      status: "detached",
      detachedAt: Date.now() - 60_000,
    });
    const dry = await remote(["prune", "--dry-run"], u.env);
    expect(dry).toEqual({
      code: 0,
      stdout: `would release cmd:lan (command) of worktree ${u.worktree}, no daemon for 25 h 5 min\n`,
      stderr: "",
    });
    expect(u.calls()).toEqual([]);
    const out = await remote(["prune"], u.env);
    expect(out.stdout).toBe(
      `released cmd:lan (command) of worktree ${u.worktree}, no daemon for 25 h 5 min\n`,
    );
    expect(u.calls()).toEqual(["release lan unused"]);
    expect(readMachines(u.env).machines.map((m) => m.id)).toEqual(["cmd:fresh"]);
  });

  it("names the scope of another host's record it releases (review 0.1.658 N1)", async () => {
    const u = user();
    track(u.env, { worktreeId: "b", worktreeRoot: u.gone, id: "cmd:old", scope: "box mnt:[7]" });
    const out = await remote(["prune"], u.env);
    expect(out).toEqual({
      code: 0,
      stdout: `released cmd:old (command) of removed worktree ${u.gone} (recorded in box mnt:[7])\n`,
      stderr: "",
    });
  });

  it("keeps a machine whose worktree cannot be checked, and says so (review 0.1.658 B2)", async () => {
    const u = user();
    const parent = join(u.gone, "locked");
    const live = join(parent, "live");
    mkdirSync(live, { recursive: true });
    track(u.env, { worktreeId: "b", worktreeRoot: live as AbsolutePath, id: "cmd:hid" });
    chmodSync(parent, 0o000);
    onTestFinished(() => chmodSync(parent, 0o700));
    const out = await remote(["prune"], u.env);
    chmodSync(parent, 0o700);
    expect(out).toEqual({
      code: 0,
      stdout: `kept cmd:hid (command) of worktree ${live}: its worktree could not be checked\nNo tracked remote machine has a removed worktree or is unused.\n`,
      stderr: "",
    });
    expect(u.calls()).toEqual([]);
  });
});

describe("squeal remote usage (row 026-10)", () => {
  it("exits 2 on an unknown subcommand or flag", async () => {
    const { env } = user();
    for (const args of [
      [],
      ["start"],
      ["list", "--all"],
      ["prune", "--force"],
      ["sleep", "a", "b"],
    ]) {
      const out = await remote(args, env);
      expect(out.code).toBe(2);
      expect(out.stderr).toContain(
        "usage: squeal remote list [--json] | sleep [<worktree>] | prune [--dry-run]",
      );
    }
  });

  it("has its own help", async () => {
    const { env } = user();
    const out = await remote(["--help"], env);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("squeal remote list [--json]");
    expect(out.stdout).toContain("squeal remote prune [--dry-run]");
    expect(out.stdout).not.toContain("squeal remove");
  });
});
