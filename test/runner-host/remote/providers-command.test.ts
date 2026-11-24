import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { MachineRequest } from "../../../src/core/runner-host/remote/provider.js";
import { commandProvider } from "../../../src/core/runner-host/remote/providers/command.js";
import { providerOf } from "../../../src/core/runner-host/remote/providers/index.js";

/*
 * Spec 026 D7.2 (row 026-10): the `command` provider runs the user's own
 * scripts as argument lists. Every hook here is a real Node script in a
 * scratch directory; none reaches the real home or `~/.ssh`.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-command-provider-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HOME = join(scratch, "no-home");
const ENV = { PATH: process.env.PATH, HOME };

/** The variables a hook records: those D7.2 names, and `HOME`. */
const SEEN = [
  "HOME",
  "SQUEAL_WORKTREE_ID",
  "SQUEAL_WORKTREE_ROOT",
  "SQUEAL_REPO_KEY",
  "SQUEAL_NODE_VERSION",
  "SQUEAL_MACHINE_ID",
  "SQUEAL_MACHINE_STATE",
  "SQUEAL_RELEASE_REASON",
];

let n = 0;
/** A hook: a Node script that appends its argv and the `SEEN` env to `calls`, then runs `body`. */
function hook(body: string): { argv: string[]; calls: () => Record<string, unknown>[] } {
  const log = join(scratch, `calls${++n}.jsonl`);
  const script = join(scratch, `hook${n}.mjs`);
  writeFileSync(
    script,
    `import { appendFileSync } from "node:fs";
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ${JSON.stringify(SEEN)}.includes(k)));
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env }) + "\\n");
${body}
`,
  );
  return {
    argv: [process.execPath, script, "--flag", "two words"],
    calls: () => {
      try {
        return readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

const ANSWER = {
  v: 1,
  id: "lan-ryzen",
  destination: "dev@192.168.1.50",
  sshArgs: ["-p", "2222"],
  sleepOnIdle: true,
  state: { mac: "aa:bb:cc:dd:ee:ff" },
};

const printing = (answer: unknown) =>
  `console.log("booting"); console.log(${JSON.stringify(JSON.stringify(answer))});`;

const logs: string[] = [];
const REQUEST: MachineRequest = {
  repositoryKey: "/repo",
  worktreeId: "abcd1234abcd1234",
  worktreeRoot: "/repo",
  commonDir: "/repo/.git",
  remoteUrls: [],
  nodeVersion: "v26.13.0",
  log: (line) => logs.push(line),
  env: ENV,
};

const config = (hooks: Record<string, unknown>) => ({
  node: "node",
  cache: ".squeal-remote",
  ...hooks,
});

describe("the command provider (row 026-10)", () => {
  it("is in the registry beside ssh", () => {
    expect(providerOf("command")).toBe(commandProvider);
    expect(providerOf("ssh")?.kind).toBe("ssh");
    expect(providerOf("agent37")).toBeNull();
    expect(providerOf("toString")).toBeNull();
  });

  it("acquires from the hook's last JSON line, with the worktree in its env", async () => {
    const acquire = hook(printing(ANSWER));
    const machine = await commandProvider.acquire(REQUEST, config({ acquire: acquire.argv }));
    expect(machine).toMatchObject({
      id: "cmd:lan-ryzen",
      provider: "command",
      ssh: { destination: "dev@192.168.1.50", args: ["-p", "2222"] },
      places: { node: "node", cache: ".squeal-remote" },
      capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
      state: { mac: "aa:bb:cc:dd:ee:ff" },
    });
    const [call] = acquire.calls();
    expect(call).toEqual({
      argv: ["--flag", "two words"],
      env: {
        HOME,
        SQUEAL_WORKTREE_ID: "abcd1234abcd1234",
        SQUEAL_WORKTREE_ROOT: "/repo",
        SQUEAL_REPO_KEY: "/repo",
        SQUEAL_NODE_VERSION: "v26.13.0",
      },
    });
    expect(logs.at(-1)).toBe("remote machine cmd:lan-ryzen acquired at dev@192.168.1.50");
  });

  it("takes node and cache from the answer over the config's", async () => {
    const acquire = hook(printing({ ...ANSWER, node: "/opt/node", cache: "/srv/c" }));
    const machine = await commandProvider.acquire(REQUEST, config({ acquire: acquire.argv }));
    expect(machine.places).toEqual({ node: "/opt/node", cache: "/srv/c" });
  });

  it("runs wake, sleep and release(reason) with the machine's id and state", async () => {
    const acquire = hook(printing(ANSWER));
    const wake = hook("");
    const sleep = hook("");
    const release = hook("");
    const machine = await commandProvider.acquire(
      REQUEST,
      config({ acquire: acquire.argv, wake: wake.argv, sleep: sleep.argv, release: release.argv }),
    );
    await machine.wake();
    await machine.sleep();
    await machine.release("worktree-removed");
    const machineEnv = {
      SQUEAL_MACHINE_ID: "lan-ryzen",
      SQUEAL_MACHINE_STATE: JSON.stringify(ANSWER.state),
    };
    expect(wake.calls()[0]?.env).toMatchObject(machineEnv);
    expect(sleep.calls()[0]?.env).toMatchObject(machineEnv);
    expect(release.calls()[0]?.env).toMatchObject({
      ...machineEnv,
      SQUEAL_RELEASE_REASON: "worktree-removed",
      SQUEAL_WORKTREE_ID: "abcd1234abcd1234",
    });
    expect(wake.calls()[0]?.env).not.toHaveProperty("SQUEAL_RELEASE_REASON");
  });

  it("does nothing for a hook the config leaves out", async () => {
    const acquire = hook(printing(ANSWER));
    const machine = await commandProvider.acquire(REQUEST, config({ acquire: acquire.argv }));
    await expect(machine.wake()).resolves.toBeUndefined();
    await expect(machine.release("daemon-exit")).resolves.toBeUndefined();
  });

  it("fails acquire on a non-zero exit, naming the code and stderr's last line", async () => {
    const acquire = hook(
      `console.error("first"); console.error("no route to host"); process.exit(3);`,
    );
    await expect(
      commandProvider.acquire(REQUEST, config({ acquire: acquire.argv })),
    ).rejects.toThrow(/the acquire hook \(.*\) exited with code 3: no route to host$/);
  });

  it("fails acquire on output that is not its JSON answer", async () => {
    const notJson = hook(`console.log("ready!");`);
    await expect(
      commandProvider.acquire(REQUEST, config({ acquire: notJson.argv })),
    ).rejects.toThrow(/the acquire hook printed no JSON line: "ready!"/);
    const noDestination = hook(printing({ v: 1, id: "x" }));
    await expect(
      commandProvider.acquire(REQUEST, config({ acquire: noDestination.argv })),
    ).rejects.toThrow(/needs "destination"/);
    const optionDestination = hook(printing({ v: 1, id: "x", destination: "-oProxyCommand=x" }));
    await expect(
      commandProvider.acquire(REQUEST, config({ acquire: optionDestination.argv })),
    ).rejects.toThrow(/needs "destination"/);
    const wrongVersion = hook(printing({ ...ANSWER, v: 2 }));
    await expect(
      commandProvider.acquire(REQUEST, config({ acquire: wrongVersion.argv })),
    ).rejects.toThrow(/"v": 1/);
  });

  it("kills a hook past its deadline, with what it started", async () => {
    const pidFile = join(scratch, "child.pid");
    const slow = hook(
      `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "inherit" });
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
setTimeout(() => {}, 60000);`,
    );
    const started = Date.now();
    await expect(
      commandProvider.acquire(REQUEST, config({ acquire: slow.argv, timeoutMs: 500 })),
    ).rejects.toThrow(/did not finish within 500 ms/);
    expect(Date.now() - started).toBeLessThan(5_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 20));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  });

  it("fails wake on a non-zero exit, so the lane falls back", async () => {
    const acquire = hook(printing(ANSWER));
    const wake = hook(`console.error("no WoL reply"); process.exit(1);`);
    const machine = await commandProvider.acquire(
      REQUEST,
      config({ acquire: acquire.argv, wake: wake.argv }),
    );
    await expect(machine.wake()).rejects.toThrow(
      /the wake hook .* exited with code 1: no WoL reply/,
    );
  });

  it("reattaches a recorded machine and releases it with its state", async () => {
    const release = hook("");
    const machine = commandProvider.reattach(
      {
        provider: "command",
        id: "cmd:lan-ryzen",
        worktreeId: "w1",
        worktreeRoot: "/gone",
        repositoryKey: "/repo",
        destination: "dev@host",
        sshArgs: [],
        places: { node: "node", cache: "c" },
        capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
        state: { mac: "x" },
        status: "awake",
        createdAt: 1,
        lastUsedAt: 2,
      },
      config({ acquire: ["unused"], release: release.argv }),
      ENV,
    );
    await machine.release("worktree-removed");
    expect(release.calls()[0]?.env).toMatchObject({
      SQUEAL_MACHINE_ID: "lan-ryzen",
      SQUEAL_MACHINE_STATE: '{"mac":"x"}',
      SQUEAL_WORKTREE_ROOT: "/gone",
      SQUEAL_RELEASE_REASON: "worktree-removed",
    });
  });

  it("validates hooks as argument lists, never shell strings", () => {
    const v = commandProvider.validate;
    expect(v(config({ acquire: ["/bin/up"] }))).toBeNull();
    expect(v(config({ acquire: "/bin/up --now" }))).toMatch(/"acquire" must be/);
    expect(v(config({ acquire: [] }))).toMatch(/"acquire" must be/);
    expect(v(config({ acquire: ["x"], wake: "wol aa:bb" }))).toMatch(/"wake" must be/);
    expect(v(config({ acquire: ["x"], timeoutMs: 0 }))).toMatch(/"timeoutMs"/);
    expect(v(config({ acquire: ["x"], shell: "bash" }))).toMatch(/unknown key "shell"/);
  });
});
