import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rootStatOf } from "../../../src/cli/runner-host.js";
import type { ContainerConsent } from "../../../src/core/runner-host/container/consent.js";
import type { DockerCli, ImageInfo } from "../../../src/core/runner-host/container/docker.js";
import type { ContainerPaths } from "../../../src/core/runner-host/container/manager.js";
import {
  type ContainerRunnerOptions,
  type ContainerTargetState,
  containerHostGone,
  createContainerRunner,
} from "../../../src/core/runner-host/container/runner.js";
import { readOtherMachineKeys } from "../../../src/core/scheduler/other-machine-keys.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerEnvironment, RunOptions } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import { claimRepo, fileName, side } from "../../scheduler/claims-fixture.js";
import { fakeAdapter, inProcessHost, POLICY, REPORT } from "../fake-channel.js";

/*
 * Spec 027 D5 to D7 (row 027-06): a consented container project's adapter
 * over a fake Docker CLI and a runner host served in this process. Every
 * refusal leaves the files unknown and runs nothing on the host; a rebuilt
 * image replaces the container and re-keys before a run.
 */

const VERSION = "0.0.0-test";
const FILE = { project: "backend", path: "tests/test_a.py" } as TestFileRef;
const INSIDE: RunnerEnvironment = {
  project: "backend",
  runnerName: "pytest",
  runnerVersion: "8.3.0",
  adapterVersion: "7",
  resolvedConfig: JSON.stringify({ args: [] }),
  files: [],
};

let dir: string;
let paths: ContainerPaths;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "squeal-ct-runner-"));
  paths = {
    worktreeRoot: join(dir, "wt"),
    squealBundleDir: join(dir, "bundle"),
    worktreeCacheDir: join(dir, "cache"),
    worktreeLogRoot: join(dir, "logs"),
  };
  for (const path of Object.values(paths)) mkdirSync(path);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A fake Docker: `image` is what the tag names now, `null` for none. */
function fakeDocker(state: { image: ImageInfo | null; node?: string; probe?: string }) {
  const calls: string[] = [];
  let next = 0;
  const cli: DockerCli = {
    imageInspect: async (ref) => {
      calls.push(`inspect ${ref}`);
      return state.image;
    },
    runIdle: async (spec) => {
      calls.push(`run ${spec.imageId}`);
      return `c${++next}`;
    },
    execSyncText: async (id, argv) => {
      calls.push(`exec ${id} ${argv[0]} ${argv[1]}`);
      if (argv[1] === "-p") return { code: 0, stdout: `${state.node ?? "22.19.0"}\n`, stderr: "" };
      if (argv[1] === "-e")
        return { code: 0, stdout: state.probe ?? "v22.19.0 linux x64", stderr: "" };
      return { code: 0, stdout: "dpkg\nlibpq5=15.8\n", stderr: "" };
    },
    spawnExec: () => {
      throw new Error("the test opens its own channel");
    },
    psManaged: async () => [],
    removeManaged: async (id) => {
      calls.push(`rm ${id}`);
      return true;
    },
  };
  return { cli, calls };
}

const image = (id: string): ImageInfo => ({
  id,
  repoDigests: [],
  env: ["PATH=/usr/bin"],
  architecture: "amd64",
  os: "linux",
});

interface Made {
  readonly options: ContainerRunnerOptions;
  readonly states: ContainerTargetState[];
  readonly notes: string[];
  readonly hosts: ReturnType<typeof inProcessHost>[];
}

function make(
  cli: DockerCli,
  over: Partial<ContainerRunnerOptions> & { rootAt?: string } = {},
): Made {
  const states: ContainerTargetState[] = [];
  const notes: string[] = [];
  const hosts: ReturnType<typeof inProcessHost>[] = [];
  const rootAt = over.rootAt ?? paths.worktreeRoot;
  const options: ContainerRunnerOptions = {
    runner: "pytest",
    adapterVersion: "7",
    traits: NO_TRAITS,
    worktreeId: "wt-1",
    project: "backend",
    targetName: "backend",
    target: {
      image: "sb/backend",
      keyMode: "build-content",
      dockerfileInputs: ["Dockerfile"],
      dependencyServices: [],
      env: {},
    },
    consent: (): ContainerConsent => ({ enabled: true, targets: "all" }),
    paths,
    squealCliPath: join(paths.squealBundleDir, "cli.mjs"),
    version: VERSION,
    start: { options: { childEnv: {} }, policy: () => POLICY },
    note: (text) => notes.push(text),
    status: (state) => states.push(state),
    manager: { cli, pid: 42, user: { uid: 1, gid: 1 } },
    openChannel: () => {
      const host = inProcessHost(
        async () =>
          fakeAdapter({
            name: "pytest",
            environment: async () => [INSIDE],
            testFiles: async () => [FILE],
            run: async () => ({ ...REPORT, completedFiles: [FILE] }),
          }),
        VERSION,
        { rootStat: () => rootStatOf(rootAt) },
      );
      hosts.push(host);
      return host.channel;
    },
    ...over,
  };
  return { options, states, notes, hosts };
}

const RUN = { runId: "r1", logDir: "/tmp", timeoutMs: 10_000 };

describe("a consented container project (D5, D6)", () => {
  it("starts, proves the mount, runs in the container and keys in its space", async () => {
    const { cli, calls } = fakeDocker({ image: image("sha256:one") });
    const made = make(cli);
    const runner = await createContainerRunner(made.options);
    expect(made.states).toEqual(["ready"]);
    expect(await runner.testFiles()).toEqual([FILE]);
    const [environment] = await runner.environment();
    expect(environment?.core).toMatchObject({ nodeVersion: "v22.19.0", platform: "linux" });
    expect(JSON.parse(environment?.resolvedConfig ?? "{}")).toMatchObject({
      container: { keyMode: "build-content", packages: { manager: "dpkg" } },
    });
    expect((await runner.run([FILE], RUN)).completedFiles).toEqual([FILE]);
    await runner.close();
    expect(calls.at(-1)).toBe("rm c1");
  });

  it("runs no docker command without consent, and answers an unavailable environment", async () => {
    const { cli, calls } = fakeDocker({ image: image("sha256:one") });
    const made = make(cli, { consent: () => null });
    const runner = await createContainerRunner(made.options);
    expect(calls).toEqual([]);
    expect(made.states).toEqual(["unconsented"]);
    expect(await runner.testFiles()).toEqual([]);
    const report = await runner.run([FILE], RUN);
    expect(report).toMatchObject({ end: "crashed", completedFiles: [] });
    expect(report.failure).toMatch(/in container backend/);
    expect((await runner.environment())[0]?.runnerVersion).toBe("unavailable");
    expect(made.hosts).toEqual([]);
  });

  it("refuses a missing image without building or pulling it", async () => {
    const { cli, calls } = fakeDocker({ image: null });
    const made = make(cli);
    const runner = await createContainerRunner(made.options);
    expect(made.states).toEqual(["image-missing"]);
    expect(calls.some((c) => c.startsWith("run"))).toBe(false);
    expect((await runner.run([FILE], RUN)).completedFiles).toEqual([]);
    expect(made.notes.at(-1)).toMatch(/never builds or pulls/);
  });

  it("refuses an image whose Node is older than 22.19 and removes its container", async () => {
    const { cli, calls } = fakeDocker({ image: image("sha256:one"), node: "20.11.0" });
    const made = make(cli);
    const runner = await createContainerRunner(made.options);
    expect(made.states).toEqual(["node-too-old"]);
    expect(calls).toContain("rm c1");
    expect((await runner.environment())[0]?.runnerVersion).toBe("unavailable");
    expect(made.hosts).toEqual([]);
  });

  it("refuses a container whose root is not the worktree mounted live, running nothing", async () => {
    const { cli, calls } = fakeDocker({ image: image("sha256:one") });
    const made = make(cli, { rootAt: paths.worktreeCacheDir });
    const runner = await createContainerRunner(made.options);
    expect(made.states).toEqual(["mount-mismatch"]);
    expect(calls).toContain("rm c1");
    const report = await runner.run([FILE], RUN);
    expect(report.completedFiles).toEqual([]);
    expect(report.failure).toMatch(/device:inode/);
  });

  it("reports an unreachable Docker as its state", async () => {
    const { cli } = fakeDocker({ image: image("sha256:one") });
    const broken: DockerCli = {
      ...cli,
      imageInspect: async () => {
        throw new Error("Cannot connect to the Docker daemon");
      },
    };
    const made = make(broken);
    await createContainerRunner(made.options);
    expect(made.states).toEqual(["docker-unreachable"]);
  });

  it("replaces the container on a rebuilt image and re-keys before running", async () => {
    const docker = { image: image("sha256:one") as ImageInfo | null };
    const { cli, calls } = fakeDocker(docker);
    const made = make(cli, {
      target: {
        image: "sb/backend",
        keyMode: "image-id",
        dockerfileInputs: [],
        dependencyServices: [],
        env: {},
      },
    });
    const runner = await createContainerRunner(made.options);
    const before = (await runner.environment())[0]?.resolvedConfig;
    docker.image = image("sha256:two");
    // Rebuilt between batches: the batch's invalidate replaces it and re-keys.
    expect(await runner.invalidate([])).toEqual({ recreatedProjects: ["backend"] });
    expect(calls).toContain("rm c1");
    expect(calls).toContain("run sha256:two");
    expect((await runner.environment())[0]?.resolvedConfig).not.toBe(before);
    // Rebuilt inside a batch: the run runs nothing, and the next batch re-keys.
    docker.image = image("sha256:three");
    const report = await runner.run([FILE], RUN);
    expect(report.completedFiles).toEqual([]);
    expect(report.failure).toMatch(/rebuilt/);
    expect(await runner.invalidate([])).toEqual({ recreatedProjects: ["backend"] });
    expect((await runner.run([FILE], RUN)).completedFiles).toEqual([FILE]);
    await runner.close();
  });

  it("is gone once its runner host ends, so the recovering runner replaces it", async () => {
    const { cli } = fakeDocker({ image: image("sha256:one") });
    const made = make(cli);
    const runner = await createContainerRunner(made.options);
    expect(containerHostGone(runner)).toBe(false);
    made.hosts[0]?.channel.kill();
    await expect(runner.testFiles()).rejects.toThrow();
    expect(containerHostGone(runner)).toBe(true);
    await runner.close();
  });
});

/*
 * Review 0.1.644 B2 (spec 027 D7): a completed container run names the
 * container's machine, so the real scheduler stores it at the container
 * key it ran for, and no host-machine variant of that key receives it.
 */
describe("a completed container run, through the scheduler (review 0.1.644 B2)", () => {
  it("is stored and current at the container key when the container's Node is not this one", {
    timeout: 60_000,
  }, async () => {
    // A Node no host runs, so the container's machine is never this one.
    const node = "v22.19.0-container";
    const { main } = claimRepo(1);
    const local = side(main, { count: 1, policy: RUN_MISSING });
    const [inner] = await local.runner.environment();
    if (inner === undefined) throw new Error("the fake runner has an environment");
    const runHere = local.runner.run.bind(local.runner);
    const { cli } = fakeDocker({ image: image("sha256:one"), probe: `${node} linux x64` });
    const made = make(cli, {
      project: "",
      paths: { ...paths, worktreeRoot: main },
      rootAt: main,
      openChannel: () =>
        inProcessHost(
          async () =>
            fakeAdapter({
              name: "pytest",
              environment: async () => [inner],
              testFiles: async () => local.runner.testFiles(),
              run: async (files) => runHere(files),
            }),
          VERSION,
          { rootStat: () => rootStatOf(main) },
        ).channel,
    });
    const runner = await createContainerRunner(made.options);
    try {
      const [environment] = await runner.environment();
      expect(environment?.core?.nodeVersion).toBe(node);
      const F0 = fileName(0);
      const report = await runner.run([{ project: "", path: F0 }], RUN);
      expect(report.completedFiles).toEqual([{ project: "", path: F0 }]);
      expect(report.executedCore?.nodeVersion).toBe(node);
      expect(report.executedCore).toEqual(environment?.core);
      // The scheduler's environment and runs are the container adapter's.
      Object.assign(local.runner, {
        environment: () => runner.environment(),
        run: (files: readonly TestFileRef[], options: RunOptions) => runner.run(files, options),
      });
      await local.scheduler.start();
      await local.quiet();
      const key = local.keyOf(F0);
      if (key === null || key === undefined) throw new Error("F0 is keyed");
      // Nothing pending, and its test passes as current at the key it ran for.
      expect(local.phase(F0)).toBeNull();
      expect(local.passing()).toBe(1);
      const stored = local.store.results.byKey(key, 0);
      expect(stored.map((r) => [r.check.kind, r.outcome]).sort()).toEqual([
        ["file", "pass"],
        ["test", "pass"],
      ]);
      // No host-machine variant: the container key is the only key with results.
      expect([...readOtherMachineKeys(local.store, local.worktreeId)]).toEqual([]);
      expect(local.store.results.keysSince(0).map((k) => k.key)).toEqual([key]);
    } finally {
      await runner.close();
    }
  });
});
