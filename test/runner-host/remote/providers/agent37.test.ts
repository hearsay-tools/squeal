import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { treeDir } from "../../../../src/core/runner-host/remote/connect.js";
import {
  readMachines,
  recordMachine,
} from "../../../../src/core/runner-host/remote/machines-store.js";
import {
  type MachineRequest,
  type RemoteMachine,
  recordOf,
} from "../../../../src/core/runner-host/remote/provider.js";
import { defaultSshUser } from "../../../../src/core/runner-host/remote/providers/agent37/config.js";
import {
  AcquireAborted,
  createAgent37Provider,
} from "../../../../src/core/runner-host/remote/providers/agent37/index.js";
import { providerOf } from "../../../../src/core/runner-host/remote/providers/index.js";
import type { AbsolutePath, WorktreeId } from "../../../../src/core/types/common.js";
import { fakeSshAt, type MockApi, mockAgent37Api } from "./agent37-api-mock.js";

/*
 * Spec 026 D7.3 (row 026-15): the `agent37` provider against a local
 * Agent37 API and a fake `ssh` whose "instance" is a directory here. The
 * git bundle is real: made from a real repository, unpacked by real Git.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk_test_provider_key_91c2";
const NODE_VERSION = "v99.1.2";
const provider = createAgent37Provider({
  pollMs: 5,
  readyMs: 5_000,
  cli: ["/opt/node", "/opt/squeal dist/cli/squeal.mjs"],
});

let n = 0;

/** A Git worktree with one commit and a tag. */
function repository(dir: string): AbsolutePath {
  const root = join(dir, "worktree");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      stdio: "pipe",
    });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  git("tag", "v1");
  return root as AbsolutePath;
}

interface Setup {
  readonly api: MockApi;
  readonly env: NodeJS.ProcessEnv;
  readonly ssh: ReturnType<typeof fakeSshAt>;
  readonly request: MachineRequest;
  readonly config: Record<string, unknown>;
  readonly log: string[];
}

async function setup(config: Record<string, unknown> = {}): Promise<Setup> {
  const dir = join(scratch, `s${++n}`);
  mkdirSync(dir);
  const api = await mockAgent37Api();
  onTestFinished(() => api.close());
  const ssh = fakeSshAt(dir);
  const env = {
    PATH: `${ssh.bin}:${process.env.PATH}`,
    HOME: join(dir, "no-home"),
    XDG_STATE_HOME: join(dir, "state"),
    AGENT37_API_KEY: KEY,
  };
  const log: string[] = [];
  const root = repository(dir);
  // The instance's Node: a fake at a fixed version, so no test reads this process's own.
  const node = join(ssh.bin, "remote-node");
  writeFileSync(node, `#!/bin/sh\necho ${NODE_VERSION}\n`, { mode: 0o755 });
  return {
    api,
    env,
    ssh,
    log,
    config: { node, cache: ".squeal-remote", apiBaseUrl: api.url, ...config },
    request: {
      repositoryKey: root,
      worktreeId: `wt-${n}` as WorktreeId,
      worktreeRoot: root,
      commonDir: join(root, ".git") as AbsolutePath,
      remoteUrls: [],
      nodeVersion: NODE_VERSION,
      log: (line) => log.push(line),
      env,
    },
  };
}

function remoteRoot(s: Setup, machine: RemoteMachine): string {
  return join(s.ssh.home, treeDir(machine.places, s.request.worktreeRoot), "root");
}

const calls = (api: MockApi) => api.calls.map((c) => `${c.method} ${c.path}`);

describe("agent37 config (row 026-15)", () => {
  const validate = (config: Record<string, unknown>) =>
    providerOf("agent37")?.validate({ node: "node", cache: "c", ...config });

  it("is a built-in provider whose every key has a default", () => {
    expect(validate({})).toBeNull();
    expect(validate({ region: "us", type: "default", vcpu: 2, autoSleepMinutes: 5 })).toBeNull();
  });

  it.each([
    [
      { region: "eu", type: "default" },
      'Agent37 eu does not support "default" (gVisor); use "vm" or "performance"',
    ],
    [{ type: "default" }, 'Agent37 eu does not support "default" (gVisor)'],
    [{ region: "ap-south", type: "default" }, 'Agent37 ap-south does not support "default"'],
    [{ region: "mars" }, '"region" must be one of "eu", "us", "ap-south"'],
    [{ vcpu: 0 }, '"vcpu" must be a positive integer'],
    [{ memoryGb: 1.5 }, '"memoryGb" must be a positive integer'],
    [
      { autoSleepMinutes: 2 },
      '"autoSleepMinutes" must be a whole number of minutes from 5 to 1440',
    ],
    [{ apiKeyEnv: "sk_live_abc123" }, '"apiKeyEnv" must name an environment variable'],
    [{ apiKeyEnv: "has space" }, '"apiKeyEnv" must name an environment variable'],
    [{ bootstrap: "fork" }, '"bootstrap" must be one of "git-bundle", "tree-sync"'],
    [{ apiBaseUrl: "ftp://x" }, '"apiBaseUrl" must be an http: or https: URL'],
    [{ apiBaseUrl: "https://u:p@x" }, "with no credential"],
    [
      { tunnelHostTemplate: "fixed.example" },
      '"tunnelHostTemplate" must be a host name with "{id}"',
    ],
    [{ sshKeyPath: "" }, '"sshKeyPath" must be a non-empty path'],
    [{ apiKey: KEY }, 'has unknown key "apiKey"'],
  ])("rejects %j", (config, problem) => {
    expect(validate(config)).toContain(problem);
  });
});

describe("agent37 template and sshUser config (row 026-29)", () => {
  const validate = (config: Record<string, unknown>) =>
    providerOf("agent37")?.validate({ node: "node", cache: "c", ...config });

  it.each([
    { template: "agent37-base" },
    { template: "agent37-ubuntu" },
    { template: "my-squeal-vm" },
    { template: "agent37-ubuntu@2026.11.17a" },
    { template: "my-squeal-vm@2" },
    { sshUser: "root" },
    { sshUser: "ubuntu" },
    { sshUser: "_svc.user-1" },
    { template: "my-squeal-vm", sshUser: "dev" },
  ])("accepts %j", (config) => {
    expect(validate(config)).toBeNull();
  });

  it.each([
    [{ template: "" }, '"template" must be a template name'],
    [{ template: "has space" }, '"template" must be a template name'],
    [{ template: "a/b" }, '"template" must be a template name'],
    [{ template: "@" }, '"template" must be a template name'],
    [{ template: "vm@" }, '"template" must be a template name'],
    [{ template: "@2" }, '"template" must be a template name'],
    [{ template: "vm@1@2" }, '"template" must be a template name'],
    [{ template: "vm;rm -rf x" }, '"template" must be a template name'],
    [{ template: "$(id)" }, '"template" must be a template name'],
    [{ template: "-vm" }, '"template" must be a template name'],
    [{ template: "vm\n" }, '"template" must be a template name'],
    [{ template: 7 }, '"template" must be a template name'],
    [{ sshUser: "" }, '"sshUser" must be a login name'],
    [{ sshUser: "a b" }, '"sshUser" must be a login name'],
    [{ sshUser: "root@host" }, '"sshUser" must be a login name'],
    [{ sshUser: "a/b" }, '"sshUser" must be a login name'],
    [{ sshUser: "a;b" }, '"sshUser" must be a login name'],
    [{ sshUser: "1root" }, '"sshUser" must be a login name'],
    [{ sshUser: "-oProxyCommand=x" }, '"sshUser" must be a login name'],
    [{ sshUser: "u".repeat(65) }, '"sshUser" must be a login name'],
  ])("rejects %j", (config, problem) => {
    expect(validate(config)).toContain(problem);
  });

  it.each([
    ["agent37-base", undefined, "node"],
    ["agent37-base", null, "node"],
    ["agent37-ubuntu", undefined, "root"],
    ["agent37-ubuntu@2026.11.17a", undefined, "root"],
    ["agent37-ubuntu-custom", undefined, "node"],
    ["my-custom", "/root", "root"],
    ["my-custom", "/workspace", "node"],
  ])("defaultSshUser(%j, %j) is %j", (template, mountPath, user) => {
    expect(defaultSshUser(template, mountPath)).toBe(user);
  });
});

describe("agent37 acquire (row 026-15)", () => {
  it("creates an EU vm, sends the git history over SSH, and tunnels SSH through squeal", async () => {
    const s = await setup({ sshKeyPath: "~/.ssh/agent37" });
    const machine = await provider.acquire(s.request, s.config);
    const [create] = s.api.calls;
    expect(create).toMatchObject({
      method: "POST",
      path: "/v1/instances",
      authorization: `Bearer ${KEY}`,
    });
    expect(create?.body).toEqual({
      template: "agent37-base",
      region: "eu",
      type: "vm",
      resources: { cpu: 4, memory: 8, disk: 10 },
      auto_sleep: true,
      idle_timeout_seconds: 600,
      name: expect.stringMatching(/^squeal-wt-/),
    });
    const id = [...s.api.instances.keys()][0] as string;
    expect(machine.id).toBe(`agent37:eu:vm:${id}`);
    expect(machine.capabilities).toEqual({
      hasGitRepository: true,
      sleepOnIdle: true,
      ephemeralHostKey: true,
    });
    expect(machine.state).toEqual({
      instanceId: id,
      region: "eu",
      type: "vm",
      bootstrap: "git-bundle",
      template: "agent37-base",
      sshUser: "node",
    });
    expect(machine.places).toEqual({
      node: join(s.ssh.bin, "remote-node"),
      cache: ".squeal-remote",
    });
    expect(machine.ssh.destination).toBe(`node@${id}.agent37.app`);
    expect(machine.ssh.args).toEqual([
      "-o",
      `ProxyCommand=/opt/node '/opt/squeal dist/cli/squeal.mjs' remote-tunnel agent37 ${id}`,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      "-i",
      "~/.ssh/agent37",
      "-o",
      "IdentitiesOnly=yes",
    ]);
    // The real bundle, unpacked by real Git: the local HEAD, its branch, its tag and its index.
    const remote = remoteRoot(s, machine);
    const git = (root: string, ...args: string[]) =>
      execFileSync("git", ["-C", root, ...args])
        .toString()
        .trim();
    expect(git(remote, "rev-parse", "HEAD")).toBe(git(s.request.worktreeRoot, "rev-parse", "HEAD"));
    expect(git(remote, "symbolic-ref", "HEAD")).toBe(
      git(s.request.worktreeRoot, "symbolic-ref", "HEAD"),
    );
    expect(git(remote, "tag")).toBe("v1");
    expect(git(remote, "ls-files")).toBe("src/a.ts");
    // Review 0.1.619 B2: no working-tree file; the tree host writes every one at the first connect.
    expect(existsSync(join(remote, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(remote, "..", "git.bundle"))).toBe(false);
    expect(machine.gitCurrent?.()).toBe(true);
    expect(s.log).toEqual([
      `Agent37 instance ${id} created (eu vm, agent37-base)`,
      expect.stringMatching(
        new RegExp(`^Agent37 instance ${id}: git history sent at [0-9a-f]{40}$`),
      ),
    ]);
    for (const argv of s.ssh.argv()) expect(argv.join(" ")).not.toContain(KEY);
  });

  it("reuses the tracked instance of the worktree, waking it, without a second bundle", async () => {
    const s = await setup();
    const first = await provider.acquire(s.request, s.config);
    recordMachine(recordOf(first, s.request, Date.now()), s.env);
    const id = (first.state as { instanceId: string }).instanceId;
    s.api.instances.set(id, "sleeping");
    s.api.tryAgain = 1;
    s.api.calls.length = 0;
    const sshBefore = s.ssh.argv().length;
    const again = await provider.acquire(s.request, s.config);
    expect(again.id).toBe(first.id);
    expect(calls(s.api)).toEqual([
      `GET /v1/instances/${id}`,
      `POST /v1/instances/${id}/start`,
      `POST /v1/instances/${id}/start`,
    ]);
    expect(s.api.instances.get(id)).toBe("running");
    // Node checked, `.git` found at the worktree's Git state: two ssh commands, none an unpack.
    const after = s.ssh.argv().slice(sshBefore);
    expect(after).toHaveLength(2);
    expect(after[1]?.at(-1)).toContain("git show-ref --head --tags");
    expect(after[1]?.at(-1)).not.toContain("bundle unbundle");
    expect(again.gitCurrent?.()).toBe(true);
    expect(s.log.at(-1)).toBe(`Agent37 instance ${id} reused (sleeping before)`);
  });

  it("creates another instance when the tracked one is gone", async () => {
    const s = await setup();
    const first = await provider.acquire(s.request, s.config);
    recordMachine(recordOf(first, s.request, Date.now()), s.env);
    const id = (first.state as { instanceId: string }).instanceId;
    s.api.instances.delete(id);
    const again = await provider.acquire(s.request, s.config);
    expect(again.id).not.toBe(first.id);
    expect(s.log).toContain(`Agent37 instance ${id} is gone; creating another`);
  });

  it("with tree-sync sends no history and claims no repository", async () => {
    const s = await setup({ bootstrap: "tree-sync", region: "us", type: "default" });
    const machine = await provider.acquire(s.request, s.config);
    expect(machine.capabilities.hasGitRepository).toBe(false);
    expect(s.ssh.argv()).toHaveLength(1);
    expect(s.log[0]).toMatch(/"default" \(gVisor\) runs tests 3 to 4 times slower/);
  });

  it("deletes a fresh instance whose bootstrap failed, so no disk bills untracked", async () => {
    const s = await setup({ node: "/no/such/node" });
    // Node differs and cannot be fetched here: a `curl` that fails, first on the PATH.
    writeFileSync(join(s.ssh.bin, "curl"), "#!/bin/sh\nexit 7\n", { mode: 0o755 });
    await expect(provider.acquire(s.request, s.config)).rejects.toThrow(
      `could not provide Node ${NODE_VERSION}`,
    );
    expect(s.api.instances.size).toBe(0);
    expect(calls(s.api).at(-1)).toMatch(/^DELETE \/v1\/instances\/mock/);
  });

  it("fails before any network call when no key and no proxy are set", async () => {
    const s = await setup();
    const { AGENT37_API_KEY: _key, ...env } = s.env;
    await expect(provider.acquire({ ...s.request, env }, s.config)).rejects.toThrow(
      "no Agent37 API key: set AGENT37_API_KEY",
    );
    expect(s.api.calls).toEqual([]);
  });
});

/**
 * The mock behind a forwarder that adds `extra` to every instance it
 * answers, as an Agent37 that sends `mount_path` and `template` would.
 */
async function withFields(target: string, extra: Record<string, unknown>): Promise<string> {
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const sent = httpRequest(
        `${target}${incoming.url ?? ""}`,
        { method: incoming.method, headers: incoming.headers },
        (answer) => {
          const back: Buffer[] = [];
          answer.on("data", (chunk: Buffer) => back.push(chunk));
          answer.on("end", () => {
            const body = JSON.parse(Buffer.concat(back).toString("utf8")) as Record<
              string,
              unknown
            >;
            const instance = typeof body.id === "string" && typeof body.status === "string";
            outgoing
              .writeHead(answer.statusCode ?? 500, { "Content-Type": "application/json" })
              .end(JSON.stringify(instance ? { ...body, ...extra } : body));
          });
        },
      );
      sent.end(Buffer.concat(chunks));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Acquires with `config`, records the machine as the daemon would, and names its instance. */
async function acquiredAs(s: Setup, config: Record<string, unknown>) {
  const machine = await provider.acquire(s.request, { ...s.config, ...config });
  recordMachine(recordOf(machine, s.request, Date.now()), s.env);
  return { machine, id: (machine.state as { instanceId: string }).instanceId };
}

describe("agent37 template and SSH user at acquire (row 026-29)", () => {
  it("creates from agent37-ubuntu and logs in as root", async () => {
    const s = await setup({ template: "agent37-ubuntu", bootstrap: "tree-sync" });
    const machine = await provider.acquire(s.request, s.config);
    const id = [...s.api.instances.keys()][0] as string;
    expect(s.api.calls[0]?.body).toMatchObject({ template: "agent37-ubuntu" });
    expect(machine.ssh.destination).toBe(`root@${id}.agent37.app`);
    expect(machine.state).toEqual({
      instanceId: id,
      region: "eu",
      type: "vm",
      bootstrap: "tree-sync",
      template: "agent37-ubuntu",
      sshUser: "root",
    });
    // The bootstrap ran as that login.
    expect(s.ssh.argv()[0]).toContain(`root@${id}.agent37.app`);
    expect(s.log[0]).toBe(`Agent37 instance ${id} created (eu vm, agent37-ubuntu)`);
  });

  it("logs in as root on a custom template whose disk is /root; sshUser overrides it", async () => {
    const s = await setup({ template: "my-custom", bootstrap: "tree-sync" });
    const apiBaseUrl = await withFields(s.api.url, { mount_path: "/root", template: "my-custom" });
    const found = await provider.acquire(s.request, { ...s.config, apiBaseUrl });
    expect(found.ssh.destination).toMatch(/^root@mock\d{6}\.agent37\.app$/);
    expect(found.state).toMatchObject({ template: "my-custom", sshUser: "root" });
    const t = await setup({ template: "my-custom", bootstrap: "tree-sync", sshUser: "ubuntu" });
    const base = await withFields(t.api.url, { mount_path: "/root" });
    const set = await provider.acquire(t.request, { ...t.config, apiBaseUrl: base });
    expect(set.ssh.destination).toMatch(/^ubuntu@mock\d{6}\.agent37\.app$/);
    expect(set.state).toMatchObject({ template: "my-custom", sshUser: "ubuntu" });
  });

  it("deletes the tracked instance and creates another when the template changed", async () => {
    const s = await setup({ bootstrap: "tree-sync" });
    const { id: old } = await acquiredAs(s, {});
    s.api.calls.length = 0;
    const { machine, id } = await acquiredAs(s, { template: "agent37-ubuntu@2026.11.17a" });
    expect(id).not.toBe(old);
    expect(s.api.instances.has(old)).toBe(false);
    expect(calls(s.api)).toEqual([`DELETE /v1/instances/${old}`, "POST /v1/instances"]);
    expect(s.api.calls[1]?.body).toMatchObject({ template: "agent37-ubuntu@2026.11.17a" });
    expect(s.log).toContain(
      `Agent37 instance ${old} uses template agent37-base, not agent37-ubuntu@2026.11.17a; replacing`,
    );
    expect(machine.ssh.destination).toBe(`root@${id}.agent37.app`);
    // The record now names the new instance and its template.
    const [record] = readMachines(s.env).machines;
    expect(record?.state).toMatchObject({ instanceId: id, template: "agent37-ubuntu@2026.11.17a" });
  });

  it("reuses a record older than row 026-29 under the default template, as node", async () => {
    const s = await setup({ bootstrap: "tree-sync" });
    const { machine: first, id } = await acquiredAs(s, {});
    // An older record: no template and no sshUser in its state.
    const record = recordOf(first, s.request, Date.now());
    const { template: _t, sshUser: _u, ...legacy } = record.state as Record<string, unknown>;
    expect(legacy).toEqual({ instanceId: id, region: "eu", type: "vm", bootstrap: "tree-sync" });
    recordMachine({ ...record, state: legacy }, s.env);
    s.api.calls.length = 0;
    const again = await provider.acquire(s.request, s.config);
    expect(again.id).toBe(first.id);
    expect(calls(s.api)).toEqual([`GET /v1/instances/${id}`]);
    expect(again.ssh.destination).toBe(`node@${id}.agent37.app`);
    expect(again.state).toEqual({ ...legacy, template: "agent37-base", sshUser: "node" });
  });

  it("keeps a reused instance's login, unless sshUser is set now", async () => {
    const s = await setup({ template: "agent37-ubuntu", bootstrap: "tree-sync" });
    const { machine: first, id } = await acquiredAs(s, {});
    const kept = await provider.acquire(s.request, s.config);
    expect(kept.state).toEqual(first.state);
    expect(kept.ssh.destination).toBe(`root@${id}.agent37.app`);
    const changed = await provider.acquire(s.request, { ...s.config, sshUser: "ubuntu" });
    expect(changed.ssh.destination).toBe(`ubuntu@${id}.agent37.app`);
    expect(changed.state).toMatchObject({ instanceId: id, sshUser: "ubuntu" });
  });
});

// Row 026-20 (lessons O1): the daemon's exit during `acquire` leaves no instance billing untracked.
describe("agent37 acquire at the daemon's exit (row 026-20)", () => {
  it("creates no instance when the exit began before the create", async () => {
    const s = await setup();
    const exit = new AbortController();
    exit.abort();
    await expect(provider.acquire({ ...s.request, signal: exit.signal }, s.config)).rejects.toThrow(
      AcquireAborted,
    );
    expect(calls(s.api).filter((c) => c === "POST /v1/instances")).toEqual([]);
    expect(s.api.instances.size).toBe(0);
  });

  it("deletes the instance whose create was in flight when the exit began", async () => {
    const s = await setup();
    const exit = new AbortController();
    s.api.beforeCreate = async () => exit.abort();
    await expect(provider.acquire({ ...s.request, signal: exit.signal }, s.config)).rejects.toThrow(
      AcquireAborted,
    );
    expect(calls(s.api)).toHaveLength(2);
    expect(calls(s.api)[0]).toBe("POST /v1/instances");
    expect(calls(s.api)[1]).toMatch(/^DELETE \/v1\/instances\/mock\d{6}$/);
    expect(s.api.instances.size).toBe(0);
    expect(s.ssh.argv()).toEqual([]);
    expect(s.log.at(-1)).toMatch(
      /^Agent37 instance mock\d{6} created after the daemon's exit began; deleted$/,
    );
  });

  it("deletes a fresh instance when the exit began after its create, before its bootstrap", async () => {
    const s = await setup({ bootstrap: "tree-sync" });
    const exit = new AbortController();
    const log = (line: string) => {
      s.log.push(line);
      if (/^Agent37 instance mock\d{6} created /.test(line)) exit.abort();
    };
    await expect(
      provider.acquire({ ...s.request, log, signal: exit.signal }, s.config),
    ).rejects.toThrow(AcquireAborted);
    expect(s.api.instances.size).toBe(0);
    expect(calls(s.api).at(-1)).toMatch(/^DELETE \/v1\/instances\/mock\d{6}$/);
    expect(s.ssh.argv()).toEqual([]);
  });
});

describe("agent37 machine lifecycle (row 026-15)", () => {
  async function acquired() {
    const s = await setup({ bootstrap: "tree-sync" });
    const machine = await provider.acquire(s.request, s.config);
    const id = (machine.state as { instanceId: string }).instanceId;
    s.api.calls.length = 0;
    return { s, machine, id };
  }

  it("sleeps through POST /sleep and wakes through POST /start", async () => {
    const { s, machine, id } = await acquired();
    await machine.sleep();
    expect(s.api.instances.get(id)).toBe("sleeping");
    await machine.wake();
    expect(s.api.instances.get(id)).toBe("running");
    expect(calls(s.api)).toEqual([
      `GET /v1/instances/${id}`,
      `POST /v1/instances/${id}/sleep`,
      `GET /v1/instances/${id}`,
      `POST /v1/instances/${id}/start`,
    ]);
  });

  it("names the lost instance when it was deleted or rebuilt elsewhere", async () => {
    const { s, machine, id } = await acquired();
    s.api.instances.delete(id);
    await expect(machine.wake()).rejects.toThrow(`Agent37 instance ${id} is gone`);
    await expect(machine.sleep()).rejects.toThrow(`Agent37 instance ${id} is gone`);
    // The daemon's exit of a lost instance has nothing to do.
    await expect(machine.release("daemon-exit")).resolves.toBeUndefined();
  });

  it("sleeps on idle and on the daemon's exit; deletes when the worktree is removed, once", async () => {
    const { s, machine, id } = await acquired();
    await machine.release("daemon-exit");
    expect(s.api.instances.get(id)).toBe("sleeping");
    s.api.instances.set(id, "running");
    await machine.release("idle");
    expect(s.api.instances.get(id)).toBe("sleeping");
    await machine.release("worktree-removed");
    expect(s.api.instances.has(id)).toBe(false);
    await expect(machine.release("worktree-removed")).resolves.toBeUndefined();
    expect(calls(s.api).filter((c) => c.startsWith("DELETE"))).toEqual([
      `DELETE /v1/instances/${id}`,
      `DELETE /v1/instances/${id}`,
    ]);
  });

  it("reattaches from its record with no daemon, by the record's state", async () => {
    const { s, machine, id } = await acquired();
    recordMachine(recordOf(machine, s.request, Date.now()), s.env);
    const [record] = readMachines(s.env).machines;
    if (record === undefined) throw new Error("not recorded");
    const again = provider.reattach(record, s.config, s.env);
    expect(again.id).toBe(machine.id);
    expect(again.ssh.args).toEqual(machine.ssh.args);
    await again.sleep();
    expect(s.api.instances.get(id)).toBe("sleeping");
    const broken = provider.reattach({ ...record, state: { other: 1 } }, s.config, s.env);
    await expect(broken.sleep()).rejects.toThrow("its record names no Agent37 instance");
  });
});
