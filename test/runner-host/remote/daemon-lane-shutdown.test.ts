import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import type {
  RemoteHost,
  RemoteHostOptions,
} from "../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import {
  type RemoteRunner,
  remoteSettingsPath,
} from "../../../src/core/runner-host/remote/settings.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { POLICY, REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fake, PROJECTS, refOf, servedHosts, VERSION } from "./share-fixture.js";

/*
 * Review 0.1.617 B1 (spec 026 D8, row 026-11): the daemon's exit releases
 * the shared machine only after every connect on it settled. A host start
 * queued behind another does not run once the exit began; a host that
 * started meanwhile is closed before the machine's release; an acquire in
 * flight is waited for, and its machine released once and recorded
 * detached. Nothing reaches the machine after `release` returns.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-daemon-lane-shutdown-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const RUNNERS = ["vitest", "node-test"] as const;

let n = 0;
/** A `command` machine whose `acquire` waits for `go` when `held`, and two eager lanes on it. */
function setup(held: { readonly acquire?: boolean } = {}) {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "repo");
  const remoteRoot = join(dir, "remote", "root");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const calls = join(dir, "calls.log");
  const go = join(dir, "go");
  const hook = (name: string, body = "") => {
    const path = join(dir, `${name}.mjs`);
    writeFileSync(
      path,
      `import { appendFileSync, existsSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, "${name} " + Date.now() + "\\n");
${body}`,
    );
    return [process.execPath, path];
  };
  const answer = { v: 1, id: "lan", destination: "dev@lan-box", sleepOnIdle: true };
  const wait = held.acquire
    ? `while (!existsSync(${JSON.stringify(go)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);\n`
    : "";
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        [real]: {
          provider: "command",
          providerConfig: {
            acquire: hook(
              "acquire",
              `${wait}console.log(${JSON.stringify(JSON.stringify(answer))});`,
            ),
            wake: hook("wake"),
            sleep: hook("sleep"),
            release: hook("release"),
          },
          runners: "all",
        },
      },
    }),
  );

  const closed: [string, number][] = [];
  const started: string[] = [];
  const serve = servedHosts(
    real,
    remoteRoot,
    () => async (files) => ({ ...REPORT, completedFiles: [...files] }),
    closed,
  );
  /** The first host start waits for `letStart` while it is held. */
  let gate: Promise<void> | null = null;
  let letStart = () => {};
  const holdStart = () => {
    gate = new Promise((resolve) => {
      letStart = resolve;
    });
  };
  const startHost = async (options: RemoteHostOptions): Promise<RemoteHost> => {
    started.push(options.runner);
    const waiting = gate;
    gate = null;
    if (waiting !== null) await waiting;
    return serve(options);
  };
  const notes: [string, string][] = [];
  const remote = createDaemonRemote({
    root: real,
    commonDir: join(real, ".git"),
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => DEFAULT_POLICY,
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: () => {},
    env,
    startHost,
  }) as DaemonRemote;
  expect(remote).not.toBeNull();
  const local = (runner: RemoteRunner): RunnerAdapter =>
    fake(runner, async (files) => ({ ...REPORT, completedFiles: [...files] }));
  /** The two lanes: Vitest's eager connects when made; node:test's (deferred) at its first run. */
  const wrap = () => {
    const lanes = RUNNERS.map((runner) =>
      remote.wrap({
        runner,
        ...(runner === "vitest" ? {} : { name: `${runner} ${PROJECTS[runner]}` }),
        local: local(runner),
        start: {
          options: {
            childEnv: {},
            ...(runner === "vitest"
              ? {}
              : {
                  process: {
                    project: { name: PROJECTS[runner] } as never,
                    tempDir: join(dir, "local-tmp"),
                  },
                }),
          },
          policy: () => POLICY,
        },
      }),
    );
    void lanes[1]?.run([refOf("node-test")], {
      runId: `r${++n}`,
      logDir: join(dir, `logs${n}`),
      timeoutMs: 60_000,
      background: true,
    });
    return lanes;
  };
  return {
    remote,
    wrap,
    env,
    started,
    closed,
    holdStart,
    letStart: () => letStart(),
    go: () => writeFileSync(go, ""),
    calls: (): string[] =>
      existsSync(calls)
        ? readFileSync(calls, "utf8")
            .trim()
            .split("\n")
            .map((line) => line.split(" ")[0] ?? "")
        : [],
    callAt: (name: string): number =>
      Number(
        readFileSync(calls, "utf8")
          .split("\n")
          .find((line) => line.startsWith(`${name} `))
          ?.split(" ")[1],
      ),
  };
}

/** Whether `promise` settled within `ms`. */
async function settles(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  await sleep(ms);
  return done;
}

describe("the daemon's exit with connects in flight (review 0.1.617 B1)", () => {
  it("starts no queued host after the exit began and closes the started one before release", async () => {
    const s = setup();
    s.holdStart();
    const lanes = s.wrap();
    // Vitest acquired the machine and is held in its host start; node:test waits behind it.
    await until(() => s.started.length === 1);
    expect(s.started).toEqual(["vitest"]);
    const closing = Promise.all(lanes.map((lane) => lane.close())).then(() => s.remote.release());
    // The exit waits for the host start in flight.
    expect(await settles(closing)).toBe(false);
    expect(s.calls()).toEqual(["acquire"]);
    s.letStart();
    await closing;
    expect(s.started).toEqual(["vitest"]);
    expect(s.closed.map(([runner]) => runner)).toEqual(["vitest"]);
    expect(s.calls()).toEqual(["acquire", "release"]);
    for (const [, at] of s.closed) expect(at).toBeLessThanOrEqual(s.callAt("release"));
    expect(readMachines(s.env).machines[0]?.status).toBe("detached");
    // Nothing reaches the machine after the exit returned.
    await sleep(300);
    expect(s.started).toEqual(["vitest"]);
    expect(s.calls()).toEqual(["acquire", "release"]);
  });

  it("waits for an acquire in flight, then releases its machine once and records it detached", async () => {
    const s = setup({ acquire: true });
    s.wrap();
    await until(() => s.calls().includes("acquire"));
    const releasing = s.remote.release();
    expect(await settles(releasing)).toBe(false);
    s.go();
    await releasing;
    expect(s.calls()).toEqual(["acquire", "release"]);
    expect(s.started).toEqual([]);
    expect(readMachines(s.env).machines.map((m) => m.status)).toEqual(["detached"]);
    await sleep(300);
    expect(s.started).toEqual([]);
    expect(s.calls()).toEqual(["acquire", "release"]);
    expect(readMachines(s.env).machines.map((m) => m.status)).toEqual(["detached"]);
  });

  it("releases once when the exit is called twice", async () => {
    const s = setup();
    const lanes = s.wrap();
    await until(() => s.started.length === 2);
    await Promise.all(lanes.map((lane) => lane.close()));
    await Promise.all([s.remote.release(), s.remote.release()]);
    expect(s.calls()).toEqual(["acquire", "release"]);
  });
});
