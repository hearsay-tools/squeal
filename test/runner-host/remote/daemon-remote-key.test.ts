import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFsHasher } from "../../../src/core/hash/hasher.js";
import { encodeSegment, keyFromSegments } from "../../../src/core/keys/check-key.js";
import { coreEnvironmentInputs } from "../../../src/core/keys/environment.js";
import { environmentHash } from "../../../src/core/keys/environment-hash.js";
import { KEY_FORMAT_VERSION } from "../../../src/core/keys/key-format.js";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
  vitestOver,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import { blobsAt } from "../../../src/core/runner-host/remote/lane-compare.js";
import { executedCoreOf } from "../../../src/core/runner-host/remote/remote-key.js";
import type { RemoteRunOptions } from "../../../src/core/runner-host/remote/tree-wire.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { CheckKey, CoreEnvironmentInputs, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  BESIDE_LANE_PREFIX,
  type RunnerAdapter,
  type RunnerEnvironment,
  type RunOptions,
  type RunReport,
} from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import { claimRepo, FakeRunner, fileName, side } from "../../scheduler/claims-fixture.js";
import { REPORT } from "../fake-channel.js";

/*
 * Spec 026 D10 (row 026-14 integration): `environmentMode: "remote-key"`
 * through `withRemoteLane` and `createDaemonRemote`. Uses a synthetic
 * platform/arch (`freebsd/riscv64`) so the cross-platform assertion runs
 * identically on Linux and macOS hosts.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-daemon-remote-key-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const REF: TestFileRef = { project: "", path: "test/a.test.ts" };
const GIT: TestFileRef = { project: "", path: "test/git.test.ts" };

const ENV: RunnerEnvironment = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: ["vitest.config.ts"],
};

const REMOTE_PLATFORM = "freebsd";
const REMOTE_ARCH = "riscv64";
const LOCAL_NODE = coreEnvironmentInputs({
  squealVersion: "0.1.620",
  installedDependencies: "none",
  allowlist: [],
}).nodeVersion;

let seq = 0;

function fixtureRepo(): AbsolutePath {
  const root = join(scratch, `repo-${++seq}`) as AbsolutePath;
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  writeFileSync(join(root, "test/a.test.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/git.test.ts"), "export const g = 1;\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

function fakeAdapter(
  name: string,
  onRun?: (
    files: readonly TestFileRef[],
    options: RunOptions & RemoteRunOptions,
  ) => Promise<RunReport>,
  environment: RunnerEnvironment = ENV,
): RunnerAdapter {
  return {
    name,
    adapterVersion: "1",
    traits: NO_TRAITS,
    testFiles: async () => [REF, GIT],
    environment: async () => [environment],
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (file) => ({ testFile: file, paths: [file.path] }),
    enumerate: async () => [],
    invalidate: async () => ({ recreatedProjects: [] }),
    run: async (files, options) =>
      onRun?.(files, options as RunOptions & RemoteRunOptions) ?? {
        ...REPORT,
        completedFiles: [...files],
      },
    close: async () => {},
  };
}

function fakeHost(root: AbsolutePath, adapter: RunnerAdapter): RemoteHost {
  const hostAdapter: RunnerAdapter = {
    ...adapter,
    run: async (files, options) => {
      const report = await adapter.run(files, options);
      const expected = (options as RunOptions & RemoteRunOptions).expected ?? {};
      return { ...report, proof: await blobsAt(root, Object.keys(expected)) } as RunReport;
    },
  };
  return {
    adapter: hostAdapter,
    node: LOCAL_NODE,
    coreEnvironment: async () => ({
      nodeVersion: LOCAL_NODE,
      platform: REMOTE_PLATFORM,
      arch: REMOTE_ARCH,
      installedDependencies: "none",
      env: {},
    }),
    blobs: async (paths) => blobsAt(root, paths),
    admit: async (ask) => ({ grant: ask.want }),
    install: async () => ({ ran: false, command: null }),
  };
}

function runOptions(background: boolean): RunOptions {
  return {
    runId: `run-${++seq}`,
    ...(background ? { background: true as const } : {}),
    logDir: join(scratch, `logs-${seq}`) as AbsolutePath,
    workers: 1,
    timeoutMs: 30_000,
  };
}

/** `remote.json` naming a remote for `root` with `entry`, in a config home of its own. */
function remoteConfig(root: string, entry: Record<string, unknown>): NodeJS.ProcessEnv {
  const configHome = join(scratch, `cfg-${++seq}`);
  mkdirSync(join(configHome, "squeal"), { recursive: true });
  writeFileSync(
    join(configHome, "squeal", "remote.json"),
    JSON.stringify({ repositories: { [root]: { target: "box", ...entry } } }),
  );
  return { ...process.env, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: configHome };
}

/** The daemon's remote for `root` under `env`, its host the fake remote over `adapter`. */
function daemonRemote(
  root: AbsolutePath,
  env: NodeJS.ProcessEnv,
  adapter: RunnerAdapter,
  notes: { topic: string; text: string }[] = [],
): DaemonRemote {
  const remote = createDaemonRemote({
    root,
    commonDir: join(root, ".git") as AbsolutePath,
    version: "0.1.620",
    launch: {
      execPath: process.execPath,
      execArgv: [],
      cli: join(scratch, "cli.mjs") as AbsolutePath,
    },
    policy: () => DEFAULT_POLICY,
    note: (text, topic) => notes.push({ topic, text }),
    lastNote: (topic) => notes.findLast((n) => n.topic === topic)?.text,
    log: () => {},
    env,
    startHost: async () => fakeHost(root, adapter),
  });
  if (remote === null) throw new Error("expected daemon remote");
  return remote;
}

const START = {
  options: { childEnv: {} },
  policy: () => ({
    observe: false,
    exclude: [],
    excludeProjects: [],
    coverage: false,
    coverageChildren: false,
  }),
};

describe("withRemoteLane under environmentMode remote-key (026 D10)", () => {
  it("accepts a cross-platform remote, attaches remoteCore to environment(), names it in status, and tags remote vs local runs", async () => {
    const root = fixtureRepo();
    const statuses: string[] = [];
    const remoteRan: string[] = [];
    const localRan: string[] = [];
    const local = fakeAdapter("vitest", async (files) => {
      localRan.push(files.map((f) => f.path).join(","));
      return { ...REPORT, completedFiles: [...files] };
    });
    const remoteAdapter = fakeAdapter("vitest", async (files) => {
      remoteRan.push(files.map((f) => f.path).join(","));
      return { ...REPORT, completedFiles: [...files] };
    });
    const lane = withRemoteLane({
      target: "agent37:eu:vm",
      whenLost: "local",
      lanes: ["background"],
      planning: "remote",
      environmentMode: "remote-key",
      needsRepository: () => ["test/git.*"],
      root,
      version: "0.1.620",
      local,
      connect: async () => fakeHost(root, remoteAdapter),
      allowlist: () => [],
      status: (line) => statuses.push(line),
      log: () => {},
    });
    try {
      // Planning environment() returns the remote machine's core.
      const envs = await lane.environment();
      expect(envs[0]?.core?.platform).toBe(REMOTE_PLATFORM);
      expect(envs[0]?.core?.arch).toBe(REMOTE_ARCH);
      expect(envs[0]?.core?.nodeVersion).toBe(LOCAL_NODE);
      expect(statuses).toContain(
        `remote agent37:eu:vm (${REMOTE_PLATFORM}/${REMOTE_ARCH}, Node ${LOCAL_NODE}); results keyed to remote environment`,
      );

      // Pure remote tier tags executedCore to the remote machine and keeps status naming it.
      const remoteReport = await lane.run([REF], runOptions(true));
      expect(remoteRan).toEqual([REF.path]);
      expect(executedCoreOf(remoteReport, REF)?.platform).toBe(REMOTE_PLATFORM);
      expect(executedCoreOf(remoteReport, REF)?.arch).toBe(REMOTE_ARCH);
      expect(statuses.at(-1)).toContain(
        `remote agent37:eu:vm (${REMOTE_PLATFORM}/${REMOTE_ARCH}, Node ${LOCAL_NODE}); results keyed to remote environment; proven at `,
      );

      // Direct local run (non-remote tier) tags executedCore to this local machine.
      const localReport = await lane.run([REF], runOptions(false));
      expect(localRan).toEqual([REF.path]);
      expect(executedCoreOf(localReport, REF)?.platform).toBe(process.platform);
      expect(executedCoreOf(localReport, REF)?.arch).toBe(process.arch);

      // Split tier (needsRepository local + normal file remote) tags each file to its own machine.
      const splitReport = await lane.run([REF, GIT], runOptions(true));
      expect(executedCoreOf(splitReport, GIT)?.platform).toBe(process.platform);
      expect(executedCoreOf(splitReport, GIT)?.arch).toBe(process.arch);
      expect(executedCoreOf(splitReport, REF)?.platform).toBe(REMOTE_PLATFORM);
      expect(executedCoreOf(splitReport, REF)?.arch).toBe(REMOTE_ARCH);
    } finally {
      await lane.close();
    }
  });

  it("refuses a cross-platform remote under match-local and tags local fallback under remote-key when unreachable", async () => {
    const root = fixtureRepo();
    const statuses: string[] = [];
    const local = fakeAdapter("vitest");
    const remoteAdapter = fakeAdapter("vitest");
    const matchLocal = withRemoteLane({
      target: "box",
      whenLost: "local",
      environmentMode: "match-local",
      root,
      version: "0.1.620",
      local,
      connect: async () => fakeHost(root, remoteAdapter),
      allowlist: () => [],
      status: (line) => statuses.push(line),
      log: () => {},
      awaitConnect: true,
    });
    try {
      await matchLocal.run([REF], runOptions(true));
      expect(statuses.some((line) => line.includes("refused:"))).toBe(true);
    } finally {
      await matchLocal.close();
    }

    const downLane = withRemoteLane({
      target: "box",
      whenLost: "local",
      planning: "remote",
      environmentMode: "remote-key",
      root,
      version: "0.1.620",
      local,
      connect: async () => {
        throw new Error("offline");
      },
      allowlist: () => [],
      status: () => {},
      log: () => {},
      awaitConnect: true,
    });
    try {
      const envs = await downLane.environment();
      expect(envs[0]?.core).toBeUndefined();
      const fallback = await downLane.run([REF], runOptions(true));
      expect(executedCoreOf(fallback, REF)?.platform).toBe(process.platform);
      expect(executedCoreOf(fallback, REF)?.arch).toBe(process.arch);
    } finally {
      await downLane.close();
    }
  });

  it("wires environmentMode from remote.json through createDaemonRemote", async () => {
    const root = fixtureRepo();
    const env = remoteConfig(root, {
      lanes: "all",
      planning: "remote",
      environmentMode: "remote-key",
    });
    const notes: { topic: string; text: string }[] = [];
    const remote = daemonRemote(root, env, fakeAdapter("vitest"), notes);
    const wrapped = remote.wrap({ runner: "vitest", local: fakeAdapter("vitest"), start: START });
    try {
      const envs = await wrapped.environment();
      expect(envs[0]?.core?.platform).toBe(REMOTE_PLATFORM);
      expect(envs[0]?.core?.arch).toBe(REMOTE_ARCH);
      expect(notes.some((n) => n.text.includes("results keyed to remote environment"))).toBe(true);
    } finally {
      await wrapped.close();
      await remote.release();
    }
  });
});

/*
 * Review 0.1.620 B1: with `lanes: ["background"]` the runner's own lane keys
 * the project under the remote's machine, and a slow, group or beside
 * instance the lanes leave out runs here. Through `vitestOver`, the real
 * scheduler and its store, each such run is stored only under this
 * machine's key: no result and no current pass under the remote's.
 */
describe("a local instance the remote's lanes leave out, under remote-key (review 0.1.620 B1)", () => {
  const F0 = fileName(0);
  /** The core the claims fixture's scheduler reads here. */
  const OWN = coreEnvironmentInputs({
    squealVersion: "0.0.0-test",
    installedDependencies: "none",
    allowlist: DEFAULT_POLICY.env.allowlist,
  });
  const REMOTE: CoreEnvironmentInputs = {
    ...OWN,
    nodeVersion: LOCAL_NODE,
    platform: REMOTE_PLATFORM,
    arch: REMOTE_ARCH,
  };

  /** `path`'s key on `machine`, from the fake runner's environment. */
  async function keyOn(
    root: string,
    path: string,
    machine: CoreEnvironmentInputs,
  ): Promise<CheckKey> {
    const [environment] = await new FakeRunner([]).environment();
    if (environment === undefined) throw new Error("the fake runner has an environment");
    const { nodeVersion, platform, arch } = machine;
    const core = { ...OWN, nodeVersion, platform, arch };
    const envHash = environmentHash(core, environment, () => null, KEY_FORMAT_VERSION);
    const hash = await createFsHasher(root, "sha1").hash(path);
    return keyFromSegments(envHash, { project: "", path }, [encodeSegment(path, hash)]);
  }

  it.each([
    ["a slow instance", "slow:vitest"],
    ["a group's instance", "group:db:vitest"],
    ["a beside instance", `${BESIDE_LANE_PREFIX}vitest`],
  ])("stores %s's run only under this machine's key", { timeout: 60_000 }, async (_, at) => {
    const { main } = claimRepo(1);
    const root = main as AbsolutePath;
    const local = side(main, { count: 1, policy: RUN_MISSING });
    const [environment] = await local.runner.environment();
    if (environment === undefined) throw new Error("the fake runner has an environment");
    const runHere = local.runner.run.bind(local.runner);
    const instance = (name: string) =>
      fakeAdapter(name, async (files) => runHere(files), environment);
    const remoteRan: string[] = [];
    const there = fakeAdapter(
      "vitest",
      async (files) => {
        remoteRan.push(...files.map((f) => f.path));
        return runHere(files);
      },
      environment,
    );
    const env = remoteConfig(root, {
      lanes: ["background"],
      planning: "remote",
      environmentMode: "remote-key",
    });
    const remote = daemonRemote(root, env, there);
    const over = vitestOver(remote, {
      fast: instance("vitest"),
      lane: () => instance("vitest"),
      beside: () => instance("vitest"),
      start: () => START,
    });
    // The scheduler's tier, dispatched to the excluded instance at the adapter seam.
    Object.assign(local.runner, {
      environment: () => over.environment(),
      run: (files: readonly TestFileRef[], options: RunOptions) =>
        over.run(files, { ...options, lane: at }),
    });
    try {
      await local.scheduler.start();
      await local.quiet();
      const [remoteKey, hereKey] = await Promise.all([
        keyOn(root, F0, REMOTE),
        keyOn(root, F0, OWN),
      ]);
      expect(remoteKey).not.toBe(hereKey);
      // Keyed under the remote's machine, which ran nothing.
      expect(local.keyOf(F0)).toBe(remoteKey);
      expect(remoteRan).toEqual([]);
      expect(local.runner.ran(F0)).toBe(1);
      expect(local.store.results.byKey(remoteKey, 0)).toEqual([]);
      expect(local.passing()).toBe(0);
      expect(local.phase(F0)).not.toBe("current");
      const here = local.store.results.byKey(hereKey, 0);
      expect(here.map((r) => [r.check.kind, r.check.testPath, r.outcome]).sort()).toEqual([
        ["file", F0, "pass"],
        ["test", F0, "pass"],
      ]);
      // The lane itself names this machine for the excluded instance's run.
      const report = await over.run([{ project: "", path: F0 }], {
        ...runOptions(false),
        lane: at,
      });
      expect(executedCoreOf(report, { project: "", path: F0 })?.platform).toBe(process.platform);
      expect(executedCoreOf(report, { project: "", path: F0 })?.arch).toBe(process.arch);
    } finally {
      await over.close();
      await remote.release();
    }
  });
});
