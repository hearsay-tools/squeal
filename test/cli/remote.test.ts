import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import {
  machinesPath,
  readMachines,
  recordMachine,
} from "../../src/core/runner-host/remote/machines-store.js";
import type { MachineRecord } from "../../src/core/runner-host/remote/provider.js";
import { remoteSettingsPath } from "../../src/core/runner-host/remote/settings.js";

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

async function remote(args: string[], env: NodeJS.ProcessEnv, cwd = scratch) {
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
  const code = await main(["remote", ...args], io);
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

  it("does nothing for a static ssh machine", async () => {
    const u = user();
    track(u.env, {
      provider: "ssh",
      id: "build-box",
      repositoryKey: "/static",
      destination: "build-box",
      worktreeRoot: u.worktree,
    });
    const out = await remote(["sleep", u.worktree], u.env);
    expect(out).toEqual({ code: 0, stdout: "build-box: asked to sleep\n", stderr: "" });
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
      "No tracked remote machine has a removed worktree.\n",
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
