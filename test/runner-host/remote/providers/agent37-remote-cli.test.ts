import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { CliIo } from "../../../../src/cli/main.js";
import { remoteCommand } from "../../../../src/cli/remote.js";
import {
  readMachines,
  recordMachine,
} from "../../../../src/core/runner-host/remote/machines-store.js";
import { remoteSettingsPath } from "../../../../src/core/runner-host/remote/settings.js";
import type { AbsolutePath, WorktreeId } from "../../../../src/core/types/common.js";
import { mockAgent37Api } from "./agent37-api-mock.js";

/*
 * Spec 026 D12.4, D12.5 (row 026-15): `squeal remote sleep` and `prune`
 * reach an Agent37 machine with no daemon, by `reattach` from its record
 * in `remote-machines.json` and its lane in `remote.json`.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-cli-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk_test_cli_key_0b7e";
let n = 0;

async function user() {
  const dir = join(scratch, `u${++n}`);
  const api = await mockAgent37Api();
  onTestFinished(() => api.close());
  const env = {
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
    AGENT37_API_KEY: KEY,
  };
  mkdirSync(join(dir, "config", "squeal"), { recursive: true });
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: { "/repo": { provider: "agent37", providerConfig: { apiBaseUrl: api.url } } },
    }),
  );
  const worktree = join(dir, "worktree");
  mkdirSync(worktree, { recursive: true });
  const track = (instanceId: string, worktreeRoot: string, worktreeId: string) =>
    recordMachine(
      {
        provider: "agent37",
        id: `agent37:eu:vm:${instanceId}`,
        worktreeId: worktreeId as WorktreeId,
        worktreeRoot: worktreeRoot as AbsolutePath,
        repositoryKey: "/repo",
        destination: `node@${instanceId}.agent37.app`,
        sshArgs: ["-o", `ProxyCommand=node squeal.mjs remote-tunnel agent37 ${instanceId}`],
        places: { node: "node", cache: ".squeal-remote" },
        capabilities: { hasGitRepository: true, sleepOnIdle: true, ephemeralHostKey: true },
        state: { instanceId, region: "eu", type: "vm", bootstrap: "git-bundle" },
        status: "awake",
        createdAt: 1,
        lastUsedAt: 2,
      },
      env,
    );
  return { api, env, worktree, gone: join(dir, "removed"), track };
}

async function remote(args: string[], env: NodeJS.ProcessEnv) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd: scratch,
    env,
  };
  // No daemon holds the machine: the CLI reaches it itself.
  const code = await remoteCommand(args, io, { ask: async () => null });
  return { code, stdout, stderr };
}

describe("squeal remote sleep|prune on agent37 (row 026-15)", () => {
  it("sleep puts the worktree's instance to sleep through the API, and records it", async () => {
    const u = await user();
    u.api.instances.set("inst00001", "running");
    u.track("inst00001", u.worktree, "w1");
    const out = await remote(["sleep", u.worktree], u.env);
    expect(out).toEqual({
      code: 0,
      stdout: "agent37:eu:vm:inst00001: asked to sleep\n",
      stderr: "",
    });
    expect(u.api.instances.get("inst00001")).toBe("sleeping");
    expect(u.api.calls.map((c) => c.authorization)).toEqual([`Bearer ${KEY}`, `Bearer ${KEY}`]);
    expect(readMachines(u.env).machines[0]?.status).toBe("sleeping");
  });

  it("prune deletes the instance of a removed worktree and forgets it; a kept one stays", async () => {
    const u = await user();
    u.api.instances.set("inst00002", "sleeping");
    u.api.instances.set("inst00003", "running");
    u.track("inst00002", u.gone, "w2");
    u.track("inst00003", u.worktree, "w3");
    const out = await remote(["prune"], u.env);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe(
      `released agent37:eu:vm:inst00002 (agent37) of removed worktree ${u.gone}\n`,
    );
    expect(u.api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /v1/instances/inst00002",
    ]);
    expect([...u.api.instances.keys()]).toEqual(["inst00003"]);
    expect(readMachines(u.env).machines.map((m) => m.id)).toEqual(["agent37:eu:vm:inst00003"]);
  });

  it("prune of an instance Agent37 already deleted forgets it too", async () => {
    const u = await user();
    u.track("inst00004", u.gone, "w4");
    const out = await remote(["prune"], u.env);
    expect(out.code).toBe(0);
    expect(readMachines(u.env).machines).toEqual([]);
  });
});
