import { execFileSync } from "node:child_process";
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
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import {
  type RemoteHostOptions,
  RemoteRefusal,
} from "../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import type { DiskProbe } from "../../../src/core/runner-host/remote/disk-check.js";
import {
  FreshMachine,
  MachineEnding,
  shareMachine,
} from "../../../src/core/runner-host/remote/machine-share.js";
import {
  readMachines,
  recordMachine,
} from "../../../src/core/runner-host/remote/machines-store.js";
import type { MachineRequest } from "../../../src/core/runner-host/remote/provider.js";
import {
  type RemoteLane,
  type RemoteRunner,
  remoteSettingsPath,
} from "../../../src/core/runner-host/remote/settings.js";
import type { SshTarget } from "../../../src/core/runner-host/remote/ssh.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
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
  /** How many `release` calls fail first, as a provider's HTTP 503 would. Default: none. */
  readonly releaseFails?: number;
  /** How long each `release` call takes. Default: no wait. */
  readonly releaseMs?: number;
}

/** A `command` machine's hooks in `dir`, each logging its call; `release` its reason too. */
function commandHooks(dir: string, extra: MachineExtra) {
  const calls = join(dir, "calls.log");
  const reasons = join(dir, "reasons.log");
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
  const release = `import { readFileSync } from "node:fs";
appendFileSync(${JSON.stringify(reasons)}, process.env.SQUEAL_RELEASE_REASON + "\\n");
const count = readFileSync(${JSON.stringify(reasons)}, "utf8").trim().split("\\n").length;
await new Promise((resolve) => setTimeout(resolve, ${extra.releaseMs ?? 0}));
if (count <= ${extra.releaseFails ?? 0}) {
  console.error("HTTP 503 Service Unavailable");
  process.exit(1);
}`;
  const lines = (file: string): string[] => {
    try {
      return readFileSync(file, "utf8").trim().split("\n");
    } catch {
      return [];
    }
  };
  return {
    providerConfig: {
      acquire: hook("acquire", `console.log(${JSON.stringify(JSON.stringify(answer))});`),
      wake: hook("wake"),
      sleep: hook("sleep"),
      release: hook("release", release),
    },
    calls: (): string[] => lines(calls).map((line) => line.split(" ")[0] ?? ""),
    /** Each `release` call's reason. */
    reasons: (): string[] => lines(reasons),
    callAt: (name: string): number =>
      Number(
        lines(calls)
          .find((line) => line.startsWith(`${name} `))
          ?.split(" ")[1],
      ),
  };
}

function machine(entry: Record<string, unknown> = {}, extra: MachineExtra = {}) {
  const dir = join(scratch, `m${++n}`);
  // One directory deeper, so a test can deny search on the worktree's parent (review 0.1.658 B2).
  const root = join(dir, "outer", "repo");
  const remoteRoot = join(dir, "remote", "root");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const hooks = commandHooks(dir, extra);
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
          providerConfig: hooks.providerConfig,
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
    root: real,
    calls: hooks.calls,
    reasons: hooks.reasons,
    callAt: hooks.callAt,
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
    const before = Date.now();
    await m.remote.release();
    expect(m.calls()).toEqual(["acquire", "release"]);
    const [record] = readMachines(m.env).machines;
    expect(record?.status).toBe("detached");
    // Row 026-43: when it lost its daemon, for the prune of unused machines.
    expect(record?.detachedAt).toBeGreaterThanOrEqual(before);
    expect(record?.detachedAt).toBeLessThanOrEqual(Date.now());
  });

  it("deletes the machine at the exit when its worktree is already gone, and forgets it (row 026-37)", async () => {
    const m = machine();
    await connectAll(m);
    await Promise.all(m.lanes.map((lane) => lane.close()));
    rmSync(m.root, { recursive: true, force: true });
    await m.remote.release();
    expect(m.reasons()).toEqual(["worktree-removed"]);
    expect(readMachines(m.env).machines).toEqual([]);
  });

  it("keeps the machine at the exit when its worktree cannot be checked (review 0.1.658 B2)", async () => {
    const m = machine();
    await connectAll(m);
    await Promise.all(m.lanes.map((lane) => lane.close()));
    const parent = dirname(m.root);
    chmodSync(parent, 0o000);
    onTestFinished(() => chmodSync(parent, 0o700));
    await m.remote.release();
    chmodSync(parent, 0o700);
    expect(m.reasons()).toEqual(["daemon-exit"]);
    expect(readMachines(m.env).machines.map((r) => r.status)).toEqual(["detached"]);
  });

  it("releases a machine a prune is deleting and acquires another, never reusing it (row 026-43)", async () => {
    const m = machine();
    // Review 0.1.667 B2: a prune claimed the worktree's machine and ended before its release.
    recordMachine(
      {
        provider: "command",
        id: "cmd:doomed",
        worktreeId: worktreeIdFor(m.root),
        worktreeRoot: m.root,
        repositoryKey: m.root,
        destination: "dev@old-box",
        sshArgs: [],
        places: { node: "node", cache: ".squeal-remote" },
        capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
        status: "deleting",
        createdAt: 1,
        lastUsedAt: 2,
      },
      m.env,
    );
    await connectAll(m);
    expect(m.calls()).toEqual(["release", "acquire"]);
    expect(m.reasons()).toEqual(["unused"]);
    expect(readMachines(m.env).machines.map((r) => [r.id, r.status])).toEqual([
      ["cmd:lan", "awake"],
    ]);
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

/**
 * Review 0.1.620 B2, S1: a machine share by itself over a `command`
 * machine, its disk check refusing a slow disk; `probe` counts each
 * measurement.
 */
function slowShare(extra: MachineExtra = {}) {
  const dir = join(scratch, `s${++n}`);
  mkdirSync(dir, { recursive: true });
  const hooks = commandHooks(dir, extra);
  const env = {
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  const lane: RemoteLane = {
    provider: "command",
    providerConfig: { ...hooks.providerConfig, node: "node", cache: ".squeal-remote" },
    runners: ["vitest"],
    lanes: ["background"],
    planning: "local",
    coverage: "off",
    environmentMode: "match-local",
    diskCheck: { enabled: true, maxWriteMs: 10, onSlowDisk: "refuse" },
    whenLost: "local",
    node: "node",
    cache: ".squeal-remote",
  };
  const logs: string[] = [];
  const request: MachineRequest = {
    repositoryKey: dir,
    worktreeId: `w${n}`,
    worktreeRoot: dir as AbsolutePath,
    commonDir: join(dir, ".git") as AbsolutePath,
    remoteUrls: [],
    // A command machine's hooks are given it; none of them reads it.
    nodeVersion: "v24.0.0",
    log: (line) => logs.push(line),
    env,
  };
  const share = shareMachine({ lane, request, env });
  onTestFinished(() => share.release());
  let probes = 0;
  const disks = extra.disks ?? [disk(40)];
  const probe = async () => disks[Math.min(++probes, disks.length) - 1] as DiskProbe;
  return {
    ...hooks,
    share,
    logs,
    probes: () => probes,
    tracked: () => readMachines(env).machines,
    /** The machine reached, and its disk check's rejection. */
    check: async () => {
      const { machine } = await share.reach();
      return {
        machine,
        error: await share.checkDisk(machine, probe).then(
          () => null,
          (e) => e,
        ),
      };
    },
  };
}

/** A refusal that keeps the machine: no replacement follows it. */
const keptRefusal = (error: unknown) =>
  error instanceof RemoteRefusal && !(error instanceof FreshMachine);

describe("a slow machine's removal (review 0.1.620 B2)", () => {
  it("keeps a machine whose removal failed, tracked and refused, and removes it at the exit", async () => {
    const s = slowShare({ releaseFails: 1 });
    const { machine, error } = await s.check();
    expect(keptRefusal(error)).toBe(true);
    expect((error as Error).message).toBe("degraded disk: 40 ms/sync, limit 10 ms");
    expect(s.share.current()).toBe(machine);
    expect(s.share.awake()).toBe(true);
    expect(s.tracked()).toHaveLength(1);
    expect(s.calls()).toEqual(["acquire", "release"]);
    expect(s.logs).toContainEqual(expect.stringMatching(/not removed, kept and refused: .*503/));
    // No second machine: the next connect is refused on the cached verdict.
    expect(keptRefusal((await s.check()).error)).toBe(true);
    expect(s.calls()).toEqual(["acquire", "release"]);
    expect(s.probes()).toBe(1);
    await s.share.release();
    expect(s.reasons()).toEqual(["worktree-removed", "worktree-removed"]);
    expect(s.tracked()).toEqual([]);
  });

  it("keeps it tracked when the exit's removal fails too", async () => {
    const s = slowShare({ releaseFails: 2 });
    expect(keptRefusal((await s.check()).error)).toBe(true);
    await s.share.release();
    expect(s.reasons()).toEqual(["worktree-removed", "worktree-removed"]);
    expect(s.tracked()).toMatchObject([{ status: "detached" }]);
  });

  it("lets the daemon's exit wait for a removal in flight, and releases nothing twice", async () => {
    const s = slowShare({ releaseMs: 400 });
    const checked = s.check();
    await until(() => s.reasons().length === 1);
    await s.share.release();
    expect((await checked).error).toBeInstanceOf(MachineEnding);
    expect(s.reasons()).toEqual(["worktree-removed"]);
    expect(s.share.current()).toBeNull();
    expect(s.tracked()).toEqual([]);
  });

  it("removes again at the exit a machine whose removal failed during it", async () => {
    const s = slowShare({ releaseMs: 400, releaseFails: 1 });
    const checked = s.check();
    await until(() => s.reasons().length === 1);
    await s.share.release();
    expect(keptRefusal((await checked).error)).toBe(true);
    expect(s.reasons()).toEqual(["worktree-removed", "worktree-removed"]);
    expect(s.tracked()).toEqual([]);
  });

  it("replaces a removed machine once, and keeps the fresh one when it is slow too", async () => {
    const s = slowShare();
    const first = await s.check();
    expect(first.error).toBeInstanceOf(FreshMachine);
    expect(s.share.current()).toBeNull();
    expect(s.tracked()).toEqual([]);
    const second = await s.check();
    expect(keptRefusal(second.error)).toBe(true);
    expect(s.share.current()).toBe(second.machine);
    expect(s.calls()).toEqual(["acquire", "release", "acquire"]);
    expect(s.tracked()).toHaveLength(1);
    await s.share.release();
    expect(s.reasons()).toEqual(["worktree-removed", "daemon-exit"]);
    expect(s.tracked()).toMatchObject([{ status: "detached" }]);
  });
});

describe("a refused disk's verdict (review 0.1.620 S1)", () => {
  it("is measured once for two lanes, and refuses both", async () => {
    const m = machine(
      { diskCheck: { onSlowDisk: "refuse" } },
      { answer: { sleepOnIdle: false }, disks: [disk(40)] },
    );
    const refused = (topic: string) =>
      /refused: degraded disk/.test(m.notes.findLast(([t]) => t === topic)?.[1] ?? "");
    await Promise.all([
      m.lanes[0]?.run([refOf("vitest")], m.background()),
      m.lanes[1]?.run([refOf("node-test")], m.background()),
    ]);
    await until(() => refused("remote-lane") && refused("remote-lane:node-test unit"));
    expect(m.probes).toHaveLength(1);
    expect(m.started).toHaveLength(2);
    expect(m.remoteRuns).toEqual([]);
    expect(m.calls()).toEqual(["acquire"]);
  });

  it("holds until a loss or a sleep ends the incarnation", async () => {
    const s = slowShare({ answer: { sleepOnIdle: false } });
    expect(keptRefusal((await s.check()).error)).toBe(true);
    expect(keptRefusal((await s.check()).error)).toBe(true);
    expect(s.probes()).toBe(1);
    s.share.lost();
    expect(keptRefusal((await s.check()).error)).toBe(true);
    expect(s.probes()).toBe(2);
    expect(s.calls()).toEqual(["acquire", "wake"]);
  });

  it("is measured again after the machine slept", async () => {
    const s = slowShare({ releaseFails: 1, disks: [disk(40), disk(0.5)] });
    expect(keptRefusal((await s.check()).error)).toBe(true);
    expect((await s.share.sleep()).kind).toBe("slept");
    expect((await s.check()).error).toBeNull();
    expect(s.probes()).toBe(2);
    expect(s.calls()).toEqual(["acquire", "release", "sleep", "wake"]);
  });
});
