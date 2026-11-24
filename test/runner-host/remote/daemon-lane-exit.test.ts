import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import {
  createDaemonRemote,
  type DaemonRemote,
  withRemoteRelease,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import { POLICY, REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fakeSshAt, type MockApi, mockAgent37Api } from "./providers/agent37-api-mock.js";
import { fake, servedHosts, VERSION } from "./share-fixture.js";

/*
 * Review 0.1.623 B1 (row 026-20, lessons O1): the daemon's exit, through
 * the runner's close (`withRemoteRelease`), aborts an Agent37 acquire in
 * flight before it waits for the lane to close. A create in flight still
 * answers its id, and that instance is deleted; a bootstrap in flight
 * stops, and its fresh instance is deleted. Neither leaves an instance or
 * a tracked record. A machine acquired already sleeps at the exit as before.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-daemon-lane-exit-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;

interface Setup {
  readonly api: MockApi;
  readonly env: NodeJS.ProcessEnv;
  readonly remote: DaemonRemote;
  readonly started: string[];
  readonly log: string[];
  /** Lets a held bootstrap (the instance's Node) answer. */
  readonly go: () => void;
  /** Whether the bootstrap asked the instance's Node. */
  readonly bootstrapping: () => boolean;
  /** The runner's own Vitest lane, eager, closed as the daemon's runner closes. */
  readonly runner: () => ReturnType<typeof withRemoteRelease>;
}

/** An eager Agent37 lane (`tree-sync`) over the mock API and a fake `ssh`; `holdNode` holds the bootstrap. */
async function setup(holdNode = false): Promise<Setup> {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const api = await mockAgent37Api();
  onTestFinished(() => api.close());
  const ssh = fakeSshAt(dir);
  const go = join(dir, "go");
  const asked = join(dir, "node-asked");
  // The instance's Node is this process's version, so the bootstrap installs none.
  const node = join(ssh.bin, "remote-node");
  const hold = holdNode
    ? `touch '${asked}'; i=0; while [ ! -e '${go}' ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i+1)); done\n`
    : "";
  writeFileSync(node, `#!/bin/sh\n${hold}echo ${process.version}\n`, { mode: 0o755 });
  onTestFinished(() => writeFileSync(go, ""));
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: `${ssh.bin}:${process.env.PATH}`,
    AGENT37_API_KEY: "sk_test_exit_key_5d1e",
  };
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        [real]: {
          provider: "agent37",
          providerConfig: {
            apiBaseUrl: api.url,
            node,
            cache: ".squeal-remote",
            bootstrap: "tree-sync",
          },
          runners: ["vitest"],
        },
      },
    }),
  );
  const remoteRoot = join(dir, "remote", "root");
  mkdirSync(remoteRoot, { recursive: true });
  const started: string[] = [];
  const serve = servedHosts(real, remoteRoot, () => async (files) => ({
    ...REPORT,
    completedFiles: [...files],
  }));
  const log: string[] = [];
  const remote = createDaemonRemote({
    root: real,
    commonDir: join(real, ".git"),
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => DEFAULT_POLICY,
    note: () => {},
    lastNote: () => undefined,
    log: (line) => log.push(line),
    env,
    startHost: async (options) => {
      started.push(options.runner);
      return serve(options);
    },
  }) as DaemonRemote;
  expect(remote).not.toBeNull();
  return {
    api,
    env,
    remote,
    started,
    log,
    go: () => writeFileSync(go, ""),
    bootstrapping: () => existsSync(asked),
    runner: () =>
      withRemoteRelease(
        remote.wrap({
          runner: "vitest",
          local: fake("vitest", async (files) => ({ ...REPORT, completedFiles: [...files] })),
          start: { options: { childEnv: {} }, policy: () => POLICY },
        }),
        remote,
      ),
  };
}

const calls = (api: MockApi) => api.calls.map((c) => `${c.method} ${c.path}`);

describe("the daemon's exit during an Agent37 acquire (review 0.1.623 B1)", () => {
  it("deletes the instance whose create was in flight when the runner's close began", async () => {
    const s = await setup();
    let answer = () => {};
    s.api.beforeCreate = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const runner = s.runner();
    await until(() => calls(s.api).includes("POST /v1/instances"));
    const closing = runner.close();
    // The create answers only after the exit began: its id is still deleted.
    answer();
    await closing;
    expect(calls(s.api)).toHaveLength(2);
    expect(calls(s.api)[0]).toBe("POST /v1/instances");
    expect(calls(s.api)[1]).toMatch(/^DELETE \/v1\/instances\/mock\d{6}$/);
    expect(s.api.instances.size).toBe(0);
    expect(readMachines(s.env).machines).toEqual([]);
    expect(s.started).toEqual([]);
  });

  it("stops a bootstrap in flight and deletes its fresh instance", async () => {
    const s = await setup(true);
    const runner = s.runner();
    await until(() => s.bootstrapping());
    const before = Date.now();
    await runner.close();
    // The bootstrap's deadline is minutes away: the abort, not the deadline, ended it.
    expect(Date.now() - before).toBeLessThan(5_000);
    expect(calls(s.api)[0]).toBe("POST /v1/instances");
    expect(calls(s.api).at(-1)).toMatch(/^DELETE \/v1\/instances\/mock\d{6}$/);
    expect(calls(s.api).filter((c) => c.endsWith("/sleep"))).toEqual([]);
    expect(s.api.instances.size).toBe(0);
    expect(readMachines(s.env).machines).toEqual([]);
    expect(s.started).toEqual([]);
    expect(s.log).toContainEqual(
      expect.stringMatching(/^Agent37 instance mock\d{6}: the daemon's exit began; deleted$/),
    );
  });

  it("puts a machine acquired already to sleep at the exit, as before", async () => {
    const s = await setup();
    const runner = s.runner();
    await until(() => s.started.length === 1);
    const [id] = [...s.api.instances.keys()];
    await runner.close();
    expect(s.api.instances.get(id ?? "")).toBe("sleeping");
    expect(calls(s.api).filter((c) => c.startsWith("DELETE"))).toEqual([]);
    expect(calls(s.api)).toContain(`POST /v1/instances/${id}/sleep`);
    expect(readMachines(s.env).machines.map((m) => m.status)).toEqual(["detached"]);
  });
});
