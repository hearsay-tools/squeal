import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { RemoteHostOptions } from "../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import type { DiskProbe } from "../../../src/core/runner-host/remote/disk-check.js";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import {
  type RemoteRunner,
  remoteSettingsPath,
} from "../../../src/core/runner-host/remote/settings.js";
import type { SshTarget } from "../../../src/core/runner-host/remote/ssh.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../../src/core/types/runner.js";
import { POLICY, REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fake, PROJECTS, refOf, servedHosts, VERSION } from "./share-fixture.js";

/*
 * Spec 026 D8 (row 026-11): Vitest, a node:test project and a pytest
 * project of one worktree go to one machine: acquired once, woken once
 * after a sleep, released once. `squeal remote sleep` closes every lane's
 * channel before the machine sleeps and is refused while any lane has a
 * remote run. D7.3: an idle machine sleeps by itself and wakes at the next
 * remote run. The machine is a `command` provider's whose hooks log their
 * calls; each runner's host is served in this process over one tree.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-machine-share-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;

/** A disk probe's answer: every write at `ms`. */
const disk = (ms: number): DiskProbe => ({ medianMs: ms, samplesMs: Array(20).fill(ms) });

interface MachineExtra {
  /** What `acquire` prints beside its id and destination. Default: sleeps on idle. */
  readonly answer?: Record<string, unknown>;
  /** Each disk probe's answer in turn, the last repeating. Default: a healthy disk. */
  readonly disks?: readonly DiskProbe[];
}

function machine(entry: Record<string, unknown> = {}, extra: MachineExtra = {}) {
  const dir = join(scratch, `m${++n}`);
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
  const hook = (name: string, body = "") => {
    const path = join(dir, `${name}.mjs`);
    writeFileSync(
      path,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, "${name} " + Date.now() + "\\n");
${body}`,
    );
    return [process.execPath, path];
  };
  const answer = {
    v: 1,
    id: "lan",
    destination: "dev@lan-box",
    sleepOnIdle: true,
    ...extra.answer,
  };
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
            acquire: hook("acquire", `console.log(${JSON.stringify(JSON.stringify(answer))});`),
            wake: hook("wake"),
            sleep: hook("sleep"),
            release: hook("release"),
          },
          runners: "all",
          ...entry,
        },
      },
    }),
  );

  const closed: [string, number][] = [];
  const remoteRuns: string[] = [];
  const localRuns: string[] = [];
  let hold: Promise<void> | null = null;
  const started: RemoteHostOptions[] = [];
  const serve = servedHosts(
    real,
    remoteRoot,
    (options) => async (files) => {
      remoteRuns.push(options.runner);
      if (hold !== null) await hold;
      return { ...REPORT, completedFiles: [...files] };
    },
    closed,
  );
  const startHost = async (options: RemoteHostOptions) => {
    started.push(options);
    // As `startRemoteHost` does: the disk check after the Node check, before the host starts.
    await options.diskCheck?.();
    return serve(options);
  };
  const probes: string[] = [];
  const disks = extra.disks ?? [disk(0.5)];
  const probeDisk = async (target: SshTarget) => {
    probes.push(target.destination);
    return disks[Math.min(probes.length, disks.length) - 1] as DiskProbe;
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
    probeDisk,
  }) as DaemonRemote;
  expect(remote).not.toBeNull();
  const local = (runner: RemoteRunner): RunnerAdapter =>
    fake(runner, async (files) => {
      localRuns.push(runner);
      return { ...REPORT, completedFiles: [...files] };
    });
  const lanes = (["vitest", "node-test", "pytest"] as const).map((runner) =>
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
                  ...(runner === "pytest" ? { cacheDir: join(dir, "state/pytest/f00") } : {}),
                },
              }),
        },
        policy: () => POLICY,
      },
    }),
  );
  onTestFinished(async () => {
    await Promise.all(lanes.map((lane) => lane.close()));
    await remote.release();
  });
  const background = (): RunOptions => ({
    runId: `r${++n}`,
    logDir: join(dir, `logs${n}`),
    timeoutMs: 60_000,
    background: true,
  });
  return {
    remote,
    lanes,
    env,
    notes,
    started,
    probes,
    closed,
    remoteRuns,
    localRuns,
    background,
    /** Each lane's run of its one file, at once. */
    runAll: () =>
      Promise.all(
        lanes.map((lane, i) =>
          lane.run(
            [refOf((["vitest", "node-test", "pytest"] as const)[i] ?? "vitest")],
            background(),
          ),
        ),
      ),
    hold: () => {
      let release = () => {};
      hold = new Promise((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
    calls: (): string[] => {
      try {
        return readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split(" ")[0] ?? "");
      } catch {
        return [];
      }
    },
    callAt: (name: string): number =>
      Number(
        readFileSync(calls, "utf8")
          .split("\n")
          .find((line) => line.startsWith(`${name} `))
          ?.split(" ")[1],
      ),
    /** Waits until each of the three lanes says its runs go there. */
    connected: () =>
      until(() => {
        const last = (topic: string) => notes.findLast(([t]) => t === topic)?.[1] ?? "";
        return ["remote-lane", "remote-lane:node-test unit", "remote-lane:pytest py"].every(
          (topic) => / go there/.test(last(topic)),
        );
      }),
  };
}

/** Runs each lane once so every lane connects, then waits for all three to answer. */
async function connectAll(m: ReturnType<typeof machine>): Promise<void> {
  await m.runAll();
  await m.connected();
}

describe("one machine for every runner (row 026-11)", () => {
  it("is acquired once for Vitest, node:test and pytest, and each runner's runs go there", async () => {
    const m = machine();
    await connectAll(m);
    expect(m.calls()).toEqual(["acquire"]);
    expect(m.started.map((o) => o.runner).sort()).toEqual(["node-test", "pytest", "vitest"]);
    // One machine's target for each: a fake command machine does not multiplex.
    expect(new Set(m.started.map((o) => o.target.destination))).toEqual(new Set(["dev@lan-box"]));
    const pytest = m.started.find((o) => o.runner === "pytest");
    expect(pytest?.options.process?.cacheDir).toMatch(/state\/pytest\/f00$/);
    m.remoteRuns.length = 0;
    await m.runAll();
    expect(m.remoteRuns.sort()).toEqual(["node-test", "pytest", "vitest"]);
    expect(readMachines(m.env).machines).toHaveLength(1);
  });

  it("closes every runner's channel before the machine sleeps, then wakes it once", async () => {
    const m = machine();
    await connectAll(m);
    expect(await m.remote.sleepRemote()).toEqual({
      kind: "slept",
      provider: "command",
      machine: "cmd:lan",
    });
    expect(m.calls()).toEqual(["acquire", "sleep"]);
    expect(m.closed.map(([runner]) => runner).sort()).toEqual(["node-test", "pytest", "vitest"]);
    for (const [, at] of m.closed) expect(at).toBeLessThanOrEqual(m.callAt("sleep"));
    expect(readMachines(m.env).machines[0]?.status).toBe("sleeping");
    // The next runs of all three reach the machine again: one wake.
    await m.runAll();
    await m.connected();
    expect(m.calls()).toEqual(["acquire", "sleep", "wake"]);
    expect(readMachines(m.env).machines[0]?.status).toBe("awake");
  });

  it("refuses to sleep while any runner has a remote run, and closes nothing", async () => {
    const m = machine();
    await connectAll(m);
    const release = m.hold();
    m.remoteRuns.length = 0;
    const running = m.lanes[1]?.run([refOf("node-test")], m.background());
    await until(() => m.remoteRuns.length === 1);
    expect(await m.remote.sleepRemote()).toEqual({
      kind: "busy",
      provider: "command",
      machine: "cmd:lan",
      reason: "a run is on remote command",
    });
    expect(m.calls()).toEqual(["acquire"]);
    expect(m.closed).toEqual([]);
    release();
    await running;
    expect((await m.remote.sleepRemote()).kind).toBe("slept");
  });

  it("releases the machine once, at the daemon's exit", async () => {
    const m = machine();
    await connectAll(m);
    await Promise.all(m.lanes.map((lane) => lane.close()));
    await m.remote.release();
    expect(m.calls()).toEqual(["acquire", "release"]);
    expect(readMachines(m.env).machines[0]?.status).toBe("detached");
  });
});

describe("an idle machine's sleep (row 026-11, spec 026 D7.3)", () => {
  it("sleeps after idleSleepMinutes with no remote activity, and wakes at the next run", async () => {
    // 0.005 minutes: 300 ms.
    const m = machine({ idleSleepMinutes: 0.005 });
    await connectAll(m);
    await until(() => readMachines(m.env).machines[0]?.status === "sleeping", 5_000);
    expect(m.calls()).toEqual(["acquire", "sleep"]);
    expect(m.closed.map(([runner]) => runner).sort()).toEqual(["node-test", "pytest", "vitest"]);
    await m.runAll();
    await m.connected();
    expect(m.calls()).toEqual(["acquire", "sleep", "wake"]);
  });

  it("does not sleep while a run is on the machine", async () => {
    const m = machine({ idleSleepMinutes: 0.005 });
    await connectAll(m);
    const release = m.hold();
    const running = m.lanes[0]?.run([refOf("vitest")], m.background());
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(m.calls()).toEqual(["acquire"]);
    release();
    await running;
    await until(() => m.calls().includes("sleep"), 5_000);
  });

  it("keeps a machine with no idle sleep awake", async () => {
    const m = machine({ idleSleepMinutes: 0 });
    await connectAll(m);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(m.calls()).toEqual(["acquire"]);
    expect(m.closed).toEqual([]);
  });
});

describe("the connect-time disk check (row 026-13, spec 026 D11)", () => {
  const diskNote = (m: ReturnType<typeof machine>) =>
    m.notes.findLast(([topic]) => topic === "remote-lane:disk")?.[1];
  const laneNote = (m: ReturnType<typeof machine>) =>
    m.notes.findLast(([topic]) => topic === "remote-lane")?.[1] ?? "";

  it("measures a healthy disk once per incarnation for every lane, and says nothing", async () => {
    const m = machine();
    await connectAll(m);
    expect(m.probes).toEqual(["dev@lan-box"]);
    expect(diskNote(m)).toBeUndefined();
    // A sleep ends the incarnation: the wake measures again, once for the three lanes.
    expect((await m.remote.sleepRemote()).kind).toBe("slept");
    await connectAll(m);
    expect(m.probes).toHaveLength(2);
  });

  it("measures nothing when the check is off", async () => {
    const m = machine({ diskCheck: { enabled: false } }, { disks: [disk(50)] });
    await connectAll(m);
    expect(m.probes).toEqual([]);
    expect(diskNote(m)).toBeUndefined();
  });

  it("warns of a slow disk in status and goes on under onSlowDisk warn", async () => {
    const m = machine({}, { disks: [disk(34.4)] });
    await connectAll(m);
    expect(m.probes).toHaveLength(1);
    expect(diskNote(m)).toBe(
      'remote cmd:lan: degraded disk: 34 ms/sync, limit 10 ms; runs go there anyway (onSlowDisk "warn")',
    );
    m.remoteRuns.length = 0;
    m.localRuns.length = 0;
    await m.runAll();
    expect(m.remoteRuns.sort()).toEqual(["node-test", "pytest", "vitest"]);
    expect(m.localRuns).toEqual([]);
  });

  it("refuses a slow disk under onSlowDisk refuse: whenLost runs here, and no host starts", async () => {
    const m = machine(
      { diskCheck: { onSlowDisk: "refuse", maxWriteMs: 5 } },
      { answer: { sleepOnIdle: false }, disks: [disk(12.26)] },
    );
    m.lanes[0]?.run([refOf("vitest")], m.background());
    await until(() => /refused/.test(laneNote(m)));
    expect(laneNote(m)).toBe(
      "remote command refused: degraded disk: 12 ms/sync, limit 5 ms; running here",
    );
    expect(diskNote(m)).toBe(
      'remote cmd:lan: degraded disk: 12 ms/sync, limit 5 ms; refused (onSlowDisk "refuse")',
    );
    // An always-on machine is not replaced: one acquire, kept.
    expect(m.calls()).toEqual(["acquire"]);
    m.remoteRuns.length = 0;
    await m.lanes[0]?.run([refOf("vitest")], m.background());
    expect(m.remoteRuns).toEqual([]);
    expect(m.localRuns).toContain("vitest");
  });

  it("replaces a fresh machine that sleeps on idle once, and goes there when the new disk is healthy", async () => {
    const m = machine({ diskCheck: { onSlowDisk: "refuse" } }, { disks: [disk(40), disk(0.4)] });
    await connectAll(m);
    expect(m.calls()).toEqual(["acquire", "release", "acquire"]);
    expect(m.probes).toHaveLength(2);
    expect(diskNote(m)).toBe("remote cmd:lan: disk within its limit again");
    m.remoteRuns.length = 0;
    await m.runAll();
    expect(m.remoteRuns.sort()).toEqual(["node-test", "pytest", "vitest"]);
  });

  it("refuses once the fresh machine is slow too, and replaces it no more", async () => {
    const m = machine({ diskCheck: { onSlowDisk: "refuse" } }, { disks: [disk(40)] });
    m.lanes[0]?.run([refOf("vitest")], m.background());
    await until(() => /refused/.test(laneNote(m)));
    expect(laneNote(m)).toMatch(/^remote command refused: degraded disk: 40 ms\/sync, limit 10 ms/);
    expect(m.calls()).toEqual(["acquire", "release", "acquire"]);
    expect(readMachines(m.env).machines).toHaveLength(1);
  });
});
