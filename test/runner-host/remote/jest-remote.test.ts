import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { SharedRecord } from "../../../src/core/code/coverage/parts.js";
import { createJestRunners, jestCacheDir } from "../../../src/core/daemon/jest-runners.js";
import type { RemoteWrap } from "../../../src/core/daemon/node-test-runners.js";
import type { HostStart } from "../../../src/core/runner-host/protocol.js";
import {
  type RemoteHostOptions,
  remoteAdapterOptions,
  remoteHostOver,
} from "../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type LaneSpec,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import {
  loadRemoteSettings,
  remoteSettingsPath,
} from "../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import { buildAdapter } from "../../../src/core/runner-host/runners.js";
import type { AbsolutePath, ProjectName } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { inProcessHost, POLICY } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fake, VERSION } from "./share-fixture.js";

/*
 * Spec 028 D7.4 (row 028-07b): Jest on the spec 026 remote lane. A lane may
 * name Jest; a remote host of a Jest project gets its temp and cache
 * directories under the remote tree and keeps coverage only when the lane
 * maps it; the daemon's Jest runners go on the lane, a container project
 * never. End to end on real Jest 29 and 30: the daemon's lane over a
 * `command` machine, whose host is served in this process over a real tree
 * host, runs a Jest project there once its environment is proven equal,
 * with its loads, reads and mapped coverage; a lost host runs it here under
 * `whenLost: "local"` and nowhere under `"not-run"`.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-remote-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};
const SUM: TestFileRef = { project: "app", path: "test/sum.test.js" };
const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js":
    'module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/test/**/*.test.js"] };\n',
  "src/sum.js": "exports.sum = (a, b) => a + b;\n",
  "data/answer.txt": "3\n",
  "test/sum.test.js": [
    'const { readFileSync } = require("node:fs");',
    'const { join } = require("node:path");',
    'const { sum } = require("../src/sum");',
    'test("adds", () => {',
    '  const answer = Number(readFileSync(join(__dirname, "../data/answer.txt"), "utf8"));',
    "  expect(sum(1, 2)).toBe(answer);",
    "});",
    "",
  ].join("\n"),
};

function settingsOf(content: unknown) {
  const xdg = join(scratch, `xdg${++n}`);
  mkdirSync(join(xdg, "squeal"), { recursive: true });
  const env = { XDG_CONFIG_HOME: xdg, HOME: join(scratch, "no-home") };
  writeFileSync(remoteSettingsPath(env), JSON.stringify(content));
  return loadRemoteSettings(env);
}

/** A `RemoteWrap` that keeps each spec and puts nothing on a lane. */
function keeping(): { wrap: RemoteWrap; specs: LaneSpec<RunnerAdapter>[] } {
  const specs: LaneSpec<RunnerAdapter>[] = [];
  const wrap = <R extends RunnerAdapter>(spec: LaneSpec<R>): R => {
    specs.push(spec as unknown as LaneSpec<RunnerAdapter>);
    return spec.local;
  };
  return { wrap, specs };
}

describe("a remote lane that names Jest (row 028-07b, spec 028 D7.4)", () => {
  it("takes jest by runners, by runner, and in all", () => {
    const loaded = settingsOf({
      repositories: {
        "/a": { target: "box", runners: ["jest"] },
        "/b": { target: "box", runner: "jest" },
        "/c": { target: "box", runners: "all" },
      },
    });
    expect(loaded.problems).toEqual([]);
    expect(loaded.repositories["/a"]?.runners).toEqual(["jest"]);
    expect(loaded.repositories["/b"]?.runners).toEqual(["jest"]);
    expect(loaded.repositories["/c"]?.runners).toContain("jest");
  });

  it("moves a Jest host's temp and cache directories under the remote tree, coverage kept", () => {
    const options = {
      childEnv: {},
      process: {
        project: PROJECT,
        tempDir: "/laptop/tmp",
        cacheDir: "/laptop/state/jest/0123456789abcdef",
        coverage: true as const,
      },
    };
    expect(remoteAdapterOptions(options, "/srv/tree", "remote")).toEqual({
      childEnv: {},
      process: {
        project: PROJECT,
        tempDir: "/srv/tree/tmp",
        cacheDir: "/srv/tree/cache/0123456789abcdef",
        coverage: true,
      },
    });
  });

  it.each([
    ["off", undefined],
    ["remote", true],
  ] as const)(
    "starts a Jest host under coverage %s with process.coverage %s",
    async (mode, kept) => {
      const starts: HostStart[] = [];
      const served = inProcessHost(
        async (start) => {
          starts.push(start);
          return fake("jest", async () => {
            throw new Error("no run");
          });
        },
        VERSION,
        { tree: createTreeHost(join(scratch, `tree${++n}`), () => {}) },
      );
      onTestFinished(() => served.channel.kill());
      const root = join(scratch, `repo${n}`) as AbsolutePath;
      mkdirSync(root, { recursive: true });
      execFileSync("git", ["init", "-q", root]);
      const host = await remoteHostOver(served.channel, "v-test", {
        target: { destination: "box" },
        version: VERSION,
        root,
        runner: "jest",
        coverage: mode,
        options: remoteAdapterOptions(
          { childEnv: {}, process: { project: PROJECT, tempDir: "/t", coverage: true } },
          "/srv/tree",
          mode,
        ),
        policy: () => ({ ...POLICY, observe: true, coverage: true }),
      });
      onTestFinished(() => host.adapter.close());
      expect(starts[0]?.runner).toBe("jest");
      expect(starts[0]?.options.process?.coverage).toBe(kept);
      expect(starts[0]?.options.process?.tempDir).toBe("/srv/tree/tmp");
      expect(starts[0]?.policy.coverage).toBe(mode === "remote");
      expect(starts[0]?.policy.observe).toBe(true);
    },
  );
});

describe("the daemon's Jest runners on the remote lane (row 028-07b)", () => {
  const ROOT = "/repo" as AbsolutePath;
  const STATE = "/repo/.git/squeal" as AbsolutePath;
  const options = (remote: RemoteWrap, coverage: boolean) => ({
    root: ROOT,
    stateDir: STATE,
    tempDir: "/daemon/tmp" as AbsolutePath,
    childEnv: { SQUEAL_MARK: "1" },
    tierSize: () => 3,
    observe: () => false,
    note: () => {},
    remote,
    ...(coverage ? { coverage: { enabled: () => true, collected: () => {} } } : {}),
  });

  it("wraps an ordinary project as a local host starts, and leaves a container project here", () => {
    const { wrap, specs } = keeping();
    const boxed: JestProject = { ...PROJECT, name: "boxed", container: "node" };
    const runners = createJestRunners([PROJECT, boxed], options(wrap, true));
    expect(runners).toHaveLength(2);
    // Spec 027 D4.2: the container project is never offered to the lane.
    expect(specs.map((s) => [s.runner, s.name])).toEqual([["jest", "jest app"]]);
    expect(specs[0]?.local).toBe(runners[0]);
    const start = specs[0]?.start;
    expect(start?.options).toEqual({
      childEnv: { SQUEAL_MARK: "1" },
      process: {
        project: PROJECT,
        tempDir: "/daemon/tmp",
        cacheDir: jestCacheDir(STATE, ROOT, "app" as ProjectName),
        coverage: true,
      },
    });
    expect(start?.policy()).toMatchObject({ observe: false, coverage: true, tierSize: 3 });
    expect(start?.note).toBeTypeOf("function");
  });

  it("asks no coverage of a remote host when the daemon has none", () => {
    const { wrap, specs } = keeping();
    createJestRunners([PROJECT], options(wrap, false));
    expect(specs[0]?.start.options.process?.coverage).toBeUndefined();
    expect(specs[0]?.start.policy().coverage).toBe(false);
  });
});

/** A Git worktree with `FILES` and a link to the fixture's Jest `major`. */
function worktree(dir: string, major: JestMajor): AbsolutePath {
  const root = join(dir, "repo");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  symlinkSync(
    realpathSync(join(installJest(major), "node_modules/jest")),
    join(root, "node_modules/jest"),
  );
  execFileSync("git", ["init", "-q", root]);
  return realpathSync(root) as AbsolutePath;
}

/** A `command` machine's `remote.json` in `dir` for the repository at `root`. */
function writeSettings(dir: string, root: string, entry: Record<string, unknown>) {
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  const acquire = join(dir, "acquire.mjs");
  const answer = JSON.stringify({ v: 1, id: "lan", destination: "dev@lan-box" });
  writeFileSync(acquire, `console.log(${JSON.stringify(answer)});`);
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        [root]: {
          provider: "command",
          providerConfig: { acquire: [process.execPath, acquire] },
          runners: ["jest"],
          lanes: ["edit", "background"],
          diskCheck: { enabled: false },
          ...entry,
        },
      },
    }),
  );
  return env;
}

/**
 * The daemon's Jest runner (`createJestRunners`) over a `command` machine's
 * lane, its host served here over a real tree host and the host's real Jest
 * adapter (`buildAdapter`); `lose` ends the host at each remote run.
 */
function jestOnLane(major: JestMajor, entry: Record<string, unknown>, lose = false) {
  const dir = join(scratch, `lane${++n}`);
  const root = worktree(dir, major);
  const tree = join(dir, "remote");
  const remoteRoot = join(tree, "root") as AbsolutePath;
  for (const sub of ["root", "tmp", "cache"]) mkdirSync(join(tree, sub), { recursive: true });
  const env = writeSettings(dir, root, entry);
  const starts: HostStart[] = [];
  const remoteRuns: string[][] = [];
  const startHost = async (options: RemoteHostOptions) => {
    const served = inProcessHost(
      async (start, hooks) => {
        starts.push(start);
        const adapter = await buildAdapter(remoteRoot, start, hooks);
        const run = adapter.run.bind(adapter);
        adapter.run = async (files, runOptions) => {
          remoteRuns.push(files.map((f) => f.path));
          if (!lose) return run(files, runOptions);
          served.channel.kill();
          return new Promise<never>(() => {});
        };
        return adapter;
      },
      VERSION,
      { tree: createTreeHost(remoteRoot, () => {}) },
    );
    onTestFinished(() => served.channel.kill());
    // As `startRemoteHost` makes them, over the remote tree's absolute path.
    return remoteHostOver(served.channel, "v-test", {
      ...options,
      options: remoteAdapterOptions(options.options, realpathSync(tree), options.coverage),
    });
  };
  const notes: [string, string][] = [];
  const records: [TestFileRef, SharedRecord][] = [];
  const remote = createDaemonRemote({
    root,
    commonDir: join(root, ".git") as AbsolutePath,
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => DEFAULT_POLICY,
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: () => {},
    env,
    startHost,
    remoteCoverage: (_runId, testFile, record) => records.push([testFile, record]),
  });
  if (remote === null) throw new Error("no remote lane");
  const [runner] = createJestRunners([PROJECT], {
    root,
    stateDir: join(dir, "state-dir") as AbsolutePath,
    tempDir: join(dir, "tmp") as AbsolutePath,
    tierSize: () => 1,
    observe: () => true,
    note: () => {},
    coverage: { enabled: () => true, collected: () => {} },
    remote: remote.wrap,
  });
  if (runner === undefined) throw new Error("no runner");
  onTestFinished(async () => {
    await runner.close();
    await remote.release();
  });
  const run = (): Promise<RunReport> =>
    runner.run([SUM], { runId: `r${++n}`, logDir: join(dir, `logs${n}`), timeoutMs: 120_000 });
  const proven = () => until(() => notes.some(([, text]) => / go there/.test(text)), 120_000);
  return { starts, remoteRuns, records, notes, run, proven };
}

const SLOW = { timeout: 300_000 };

describe.each(JEST_MAJORS)("Jest %i over the remote lane (row 028-07b)", (major) => {
  it("runs there, proven equal, with its loads, reads and mapped coverage", SLOW, async () => {
    const lane = jestOnLane(major, { coverage: "remote" });
    await lane.proven();
    const report = await lane.run();
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["adds", "pass"]]);
    expect(lane.remoteRuns).toEqual([[SUM.path]]);
    // The host started as `startRemoteHost` starts it: temp and cache under the tree, coverage on.
    const data = lane.starts[0]?.options.process;
    expect(data?.tempDir).toMatch(/\/remote\/tmp$/);
    expect(data?.cacheDir).toMatch(/\/remote\/cache\/[0-9a-f]{16}$/);
    expect(data?.coverage).toBe(true);
    const loaded = report.loaded?.find((l) => l.testFile.path === SUM.path)?.paths ?? [];
    expect(loaded).toEqual(expect.arrayContaining([SUM.path, "src/sum.js"]));
    const read = report.observed?.find((o) => o.testFile.path === SUM.path)?.paths ?? [];
    expect(read).toContain("data/answer.txt");
    await until(() => lane.records.length > 0, 30_000);
    const [file, record] = lane.records[0] ?? [];
    expect(file?.path).toBe(SUM.path);
    expect(record?.paths).toContain("src/sum.js");
  });

  it('runs here when the host is lost under whenLost "local"', SLOW, async () => {
    const lane = jestOnLane(major, { whenLost: "local" }, true);
    await lane.proven();
    const report = await lane.run();
    expect(lane.remoteRuns).toEqual([[SUM.path]]);
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["adds", "pass"]]);
  });

  it('runs nowhere when the host is lost under whenLost "not-run"', SLOW, async () => {
    const lane = jestOnLane(major, { whenLost: "not-run" }, true);
    await lane.proven();
    const report = await lane.run();
    // The lane may connect again and try once more before it gives the run up; never here.
    expect(lane.remoteRuns.length).toBeGreaterThan(0);
    for (const files of lane.remoteRuns) expect(files).toEqual([SUM.path]);
    expect(report.end).toBe("crashed");
    expect(report.failure).toMatch(/not run here \(whenLost "not-run"\)/);
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
  });
});
