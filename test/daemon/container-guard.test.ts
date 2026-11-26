import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rootStatOf } from "../../src/cli/runner-host.js";
import { createNodeTestRunners, type RemoteWrap } from "../../src/core/daemon/node-test-runners.js";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import type { RecoveringRunner } from "../../src/core/daemon/runner.js";
import type { DockerCli } from "../../src/core/runner-host/container/docker.js";
import type {
  ContainerSummaryEntry,
  ContainerWiring,
} from "../../src/core/runner-host/container/index.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fakeAdapter, inProcessHost, REPORT } from "../runner-host/fake-channel.js";

/*
 * Review 0.1.643 B1 (spec 027 D4.2, row 027-04): a container-configured
 * project never runs on this host or a remote lane, with or without
 * consent. Row 027-06: with consent and the daemon's container wiring, it
 * runs in its container, and still never here.
 */

const dirs: string[] = [];
const runners: RecoveringRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.close();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): AbsolutePath {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir as AbsolutePath;
}

/** The node:test list's key, so version-sensitive selection does not read it as a literal. */
const NODE = ["node", "Test"].join("") as `node${"Test"}`;

const PROOF = `const { test } = require("node:test");
test("host proof", () => {
  require("node:fs").writeFileSync(__dirname + "/HOST_RAN", "yes");
});
`;

/** The review's probe project, with an optional host sibling; consent from `consent`. */
function setup(
  consent: ((root: string) => object) | undefined,
  wiring?: (root: AbsolutePath) => ContainerWiring,
) {
  const root = temp("squeal-container-guard-");
  const config = temp("squeal-container-guard-xdg-");
  vi.stubEnv("XDG_CONFIG_HOME", config);
  if (consent !== undefined) {
    mkdirSync(join(config, "squeal"), { recursive: true });
    writeFileSync(join(config, "squeal", "containers.json"), JSON.stringify(consent(root)));
  }
  mkdirSync(join(root, "blocked"));
  mkdirSync(join(root, "host"));
  writeFileSync(join(root, "blocked", "proof.test.cjs"), PROOF);
  writeFileSync(join(root, "host", "proof.test.cjs"), PROOF);
  writeFileSync(join(root, "blocked", "test_proof.py"), "def test_proof():\n    pass\n");
  writeFileSync(
    join(root, POLICY_FILE),
    JSON.stringify({
      containers: { blocked: { image: "nonexistent/no-pull:643" } },
      [NODE]: [
        { name: "blocked", cwd: "blocked", include: ["*.test.cjs"], container: "blocked" },
        { name: "host", cwd: "host", include: ["*.test.cjs"] },
      ],
      pytest: [
        { name: "py-blocked", cwd: "blocked", include: ["test_*.py"], container: "blocked" },
      ],
    }),
  );
  const { policy, problems } = loadPolicy(root);
  expect(problems).toEqual([]);
  const notes: string[] = [];
  const remoteNames: string[] = [];
  const remote: RemoteWrap = (spec) => {
    remoteNames.push(spec.name ?? spec.runner);
    return spec.local;
  };
  const base = {
    root,
    tempDir: temp("squeal-container-guard-tmp-"),
    tierSize: () => 1,
    note: (text: string) => notes.push(text),
    remote,
    ...(wiring === undefined ? {} : { containers: wiring(root) }),
  };
  const node = createNodeTestRunners(policy.nodeTest, base);
  const py = createPytestRunners(policy.pytest, { ...base, stateDir: temp("squeal-cg-state-") });
  runners.push(...node, ...py);
  return { root, node, py, notes, remoteNames };
}

const blockedFile = { project: "blocked", path: "blocked/proof.test.cjs" } as TestFileRef;
const pyFile = { project: "py-blocked", path: "blocked/test_proof.py" } as TestFileRef;

async function expectGuarded(runner: RecoveringRunner | undefined, file: TestFileRef) {
  if (runner === undefined) throw new Error("no runner");
  expect(await runner.testFiles()).toEqual([]);
  const report = await runner.run([file], {
    runId: "r1",
    logDir: temp("squeal-container-guard-log-"),
    timeoutMs: 10_000,
  });
  expect(report.end).toBe("crashed");
  expect(report.results).toEqual([]);
  expect(report.completedFiles).toEqual([]);
  expect(report.fileErrors).toEqual([]);
  expect(report.failure).toMatch(/container target "blocked"/);
  const [environment] = await runner.environment();
  expect(environment?.runnerVersion).toBe("unavailable");
  return report.failure as string;
}

const CASES: readonly (readonly [string, ((root: string) => object) | undefined])[] = [
  ["absent containers.json", undefined],
  ["disabled consent", (root) => ({ allow: { [root]: { enabled: false, targets: "all" } } })],
  [
    "wrong-target consent",
    (root) => ({ allow: { [root]: { enabled: true, targets: ["other"] } } }),
  ],
];

describe("a container-configured project (review 0.1.643 B1)", () => {
  for (const [label, consent] of CASES) {
    it(`never runs on the host or remote, with ${label}`, async () => {
      const { root, node, py, notes, remoteNames } = setup(consent);
      const failure = await expectGuarded(node[0], blockedFile);
      await expectGuarded(py[0], pyFile);
      expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
      expect(failure).toMatch(/squeal setup/);
      expect(failure).toMatch(/root-equivalent/);
      expect(notes.filter((n) => n.includes("has not allowed"))).toHaveLength(2);
      expect(remoteNames).toEqual(["node-test host"]);
    });
  }

  it("stays unknown with an honest note when consent allows the target", async () => {
    const { root, node, py, notes, remoteNames } = setup((r) => ({
      allow: { [r]: { enabled: true, targets: ["blocked"] } },
    }));
    const failure = await expectGuarded(node[0], blockedFile);
    await expectGuarded(py[0], pyFile);
    expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
    expect(failure).toMatch(/does not run container targets yet/);
    expect(failure).toMatch(/no container route/);
    expect(notes.some((n) => n.includes("has not allowed"))).toBe(false);
    expect(remoteNames).toEqual(["node-test host"]);
  });

  it("notes again when containers.json changes, still never running here", async () => {
    const { root, node, notes } = setup(undefined);
    await expectGuarded(node[0], blockedFile);
    const config = process.env.XDG_CONFIG_HOME as string;
    mkdirSync(join(config, "squeal"), { recursive: true });
    writeFileSync(
      join(config, "squeal", "containers.json"),
      JSON.stringify({ allow: { [root]: { enabled: true, targets: "all" } } }),
    );
    await node[0]?.recheck?.();
    expect(notes.at(-1)).toMatch(/does not run container targets yet/);
    await expectGuarded(node[0], blockedFile);
    expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
  });

  it("leaves a sibling host project running as before", async () => {
    const { root, node } = setup(undefined);
    const host = node[1];
    if (host === undefined) throw new Error("no host runner");
    const files = await host.testFiles();
    expect(files.map((f) => f.path)).toEqual(["host/proof.test.cjs"]);
    const report = await host.run(files, {
      runId: "r2",
      logDir: temp("squeal-container-guard-log-"),
      timeoutMs: 10_000,
    });
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    expect(existsSync(join(root, "host", "HOST_RAN"))).toBe(true);
  });
});

/** A fake Docker and a runner host served here as the container's, with its calls. */
function fakeWiring(root: AbsolutePath) {
  const calls: string[] = [];
  const states: ContainerSummaryEntry[] = [];
  const cli: DockerCli = {
    imageInspect: async (ref) => {
      calls.push(`inspect ${ref}`);
      return { id: "sha256:img", repoDigests: [], env: [], architecture: "amd64", os: "linux" };
    },
    runIdle: async () => {
      calls.push("run");
      return `c${calls.length}`;
    },
    execSyncText: async (_id, argv) => {
      if (argv[1] === "-p") return { code: 0, stdout: "22.19.0\n", stderr: "" };
      if (argv[1] === "-e") return { code: 0, stdout: "v22.19.0 linux x64", stderr: "" };
      return { code: 0, stdout: "none\n", stderr: "" };
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
  const inside = (project: string) => ({ project, path: "blocked/inside.test.cjs" }) as TestFileRef;
  const wiring = (): ContainerWiring => ({
    containers: () => ({
      blocked: {
        image: "nonexistent/no-pull:643",
        keyMode: "build-content",
        dockerfileInputs: [],
        dependencyServices: [],
        env: {},
      },
    }),
    worktreeId: "wt-guard",
    bundleDir: temp("squeal-cg-bundle-"),
    squealCliPath: "/bundle/cli.mjs",
    stateDir: temp("squeal-cg-state-"),
    logRoot: temp("squeal-cg-logs-"),
    commonDir: root,
    version: "0.0.0-test",
    status: (entry) => states.push(entry),
    manager: { cli, pid: 42, user: { uid: 1, gid: 1 } },
    openChannel: () =>
      inProcessHost(
        async (start) => {
          const project = (start.options.process?.project.name ?? "") as string;
          return fakeAdapter({
            name: start.runner,
            testFiles: async () => [inside(project)],
            environment: async () => [
              {
                project,
                runnerName: start.runner,
                runnerVersion: "1",
                adapterVersion: "1",
                resolvedConfig: "{}",
                files: [],
              },
            ],
            run: async () => ({ ...REPORT, completedFiles: [inside(project)] }),
          });
        },
        "0.0.0-test",
        { rootStat: () => rootStatOf(root) },
      ).channel,
  });
  return { calls, states, wiring, inside };
}

describe("a consented container project with the daemon's container route (row 027-06)", () => {
  it("runs in its container, keyed there, and never on the host or remote", async () => {
    const fake = { current: null as ReturnType<typeof fakeWiring> | null };
    const { root, node, py, remoteNames } = setup(
      (r) => ({ allow: { [r]: { enabled: true, targets: ["blocked"] } } }),
      (r) => {
        fake.current = fakeWiring(r);
        return fake.current.wiring();
      },
    );
    const f = fake.current as unknown as ReturnType<typeof fakeWiring>;
    for (const [runner, project] of [
      [node[0], "blocked"],
      [py[0], "py-blocked"],
    ] as const) {
      expect(await runner?.testFiles()).toEqual([f.inside(project)]);
      const report = await runner?.run([f.inside(project)], {
        runId: "r1",
        logDir: temp("squeal-container-guard-log-"),
        timeoutMs: 10_000,
      });
      expect(report?.completedFiles).toEqual([f.inside(project)]);
      const [environment] = (await runner?.environment()) ?? [];
      expect(environment?.core?.nodeVersion).toBe("v22.19.0");
      expect(JSON.parse(environment?.resolvedConfig ?? "{}")).toHaveProperty("container");
    }
    expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
    expect(remoteNames).toEqual(["node-test host"]);
    expect(f.calls.filter((c) => c === "run")).toHaveLength(2);
    expect(f.states.map((s) => [s.target, s.project, s.state, s.keyMode])).toEqual([
      ["blocked", "blocked", "ready", "build-content"],
      ["blocked", "py-blocked", "ready", "build-content"],
    ]);
  });

  it("runs no docker command without consent, even with the route", async () => {
    const fake = { current: null as ReturnType<typeof fakeWiring> | null };
    const { root, node, py } = setup(undefined, (r) => {
      fake.current = fakeWiring(r);
      return fake.current.wiring();
    });
    await expectGuarded(node[0], blockedFile);
    await expectGuarded(py[0], pyFile);
    expect(fake.current?.calls).toEqual([]);
    expect(fake.current?.states.map((s) => s.state)).toEqual(["unconsented", "unconsented"]);
    expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
  });

  it("starts the container route at the next batch once consent is given", async () => {
    const fake = { current: null as ReturnType<typeof fakeWiring> | null };
    const { root, node } = setup(undefined, (r) => {
      fake.current = fakeWiring(r);
      return fake.current.wiring();
    });
    await expectGuarded(node[0], blockedFile);
    const config = process.env.XDG_CONFIG_HOME as string;
    mkdirSync(join(config, "squeal"), { recursive: true });
    writeFileSync(
      join(config, "squeal", "containers.json"),
      JSON.stringify({ allow: { [root]: { enabled: true, targets: "all" } } }),
    );
    expect(await node[0]?.invalidate([])).toEqual({ recreatedProjects: ["blocked"] });
    expect(await node[0]?.testFiles()).toEqual([fake.current?.inside("blocked")]);
  });
});
