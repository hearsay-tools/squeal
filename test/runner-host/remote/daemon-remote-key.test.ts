import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import { createDaemonRemote } from "../../../src/core/runner-host/remote/daemon-lane.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import { blobsAt } from "../../../src/core/runner-host/remote/lane-compare.js";
import { executedCoreOf } from "../../../src/core/runner-host/remote/remote-key.js";
import type { RemoteRunOptions } from "../../../src/core/runner-host/remote/tree-wire.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type {
  RunnerAdapter,
  RunnerEnvironment,
  RunOptions,
  RunReport,
} from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
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
): RunnerAdapter {
  return {
    name,
    adapterVersion: "1",
    traits: NO_TRAITS,
    testFiles: async () => [REF, GIT],
    environment: async () => [ENV],
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
    node: process.version,
    coreEnvironment: async () => ({
      nodeVersion: process.version,
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
    background,
    logDir: join(scratch, `logs-${seq}`) as AbsolutePath,
    workers: 1,
  };
}

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
      expect(envs[0]?.core?.nodeVersion).toBe(process.version);
      expect(statuses).toContain(
        `remote agent37:eu:vm (${REMOTE_PLATFORM}/${REMOTE_ARCH}, Node ${process.version}); results keyed to remote environment`,
      );

      // Pure remote tier tags executedCore to the remote machine and keeps status naming it.
      const remoteReport = await lane.run([REF], runOptions(true));
      expect(remoteRan).toEqual([REF.path]);
      expect(executedCoreOf(remoteReport, REF)?.platform).toBe(REMOTE_PLATFORM);
      expect(executedCoreOf(remoteReport, REF)?.arch).toBe(REMOTE_ARCH);
      expect(statuses.at(-1)).toContain(
        `remote agent37:eu:vm (${REMOTE_PLATFORM}/${REMOTE_ARCH}, Node ${process.version}); results keyed to remote environment; proven at `,
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
    const configHome = join(scratch, `cfg-${++seq}`);
    mkdirSync(join(configHome, "squeal"), { recursive: true });
    writeFileSync(
      join(configHome, "squeal", "remote.json"),
      JSON.stringify({
        repositories: {
          [root]: {
            target: "box",
            lanes: "all",
            planning: "remote",
            environmentMode: "remote-key",
          },
        },
      }),
    );
    const notes: { topic: string; text: string }[] = [];
    const remoteAdapter = fakeAdapter("vitest");
    const remote = createDaemonRemote({
      root,
      commonDir: join(root, ".git") as AbsolutePath,
      version: "0.1.620",
      launch: { node: process.execPath, cli: join(scratch, "cli.mjs") as AbsolutePath },
      policy: () => DEFAULT_POLICY,
      note: (text, topic) => notes.push({ topic, text }),
      lastNote: (topic) => notes.findLast((n) => n.topic === topic)?.text,
      log: () => {},
      env: { ...process.env, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: configHome },
      startHost: async () => fakeHost(root, remoteAdapter),
    });
    expect(remote).not.toBeNull();
    const wrapped = remote!.wrap({
      runner: "vitest",
      local: fakeAdapter("vitest"),
      start: {
        options: { childEnv: {} },
        policy: () => ({
          observe: false,
          exclude: [],
          excludeProjects: [],
          coverage: false,
          coverageChildren: false,
        }),
      },
    });
    try {
      const envs = await wrapped.environment();
      expect(envs[0]?.core?.platform).toBe(REMOTE_PLATFORM);
      expect(envs[0]?.core?.arch).toBe(REMOTE_ARCH);
      expect(notes.some((n) => n.text.includes("results keyed to remote environment"))).toBe(true);
    } finally {
      await wrapped.close();
      await remote!.release();
    }
  });
});
