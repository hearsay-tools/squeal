import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { CoverageRun, RunnerCoverageOptions } from "../../../src/core/code/coverage/types.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../../src/core/types/runner.js";
import { createJestAdapter, type JestAdapterOptions } from "../../../src/runners/jest/adapter.js";
import { defaultWarmMemoryLimitBytes } from "../../../src/runners/jest/run/warm.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";

/*
 * Spec 028 D7 (row 028-07a) on real Jest 29.7.0 and 30.5.2: the warm
 * worker pool. A worker serves run after run; source and manual-mock edits
 * show without a new worker; config edits, added, deleted and touched
 * files, the memory limit, a kill and idleness replace or end it; each
 * batch is observed afresh; coverage and an inline project run warm; a
 * project with `args` or a global hook runs a Jest process per batch.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};

const CONFIG = (extra = "") => `module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],${extra}
};
`;

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": CONFIG(),
  "src/sum.js": "exports.sum = (a, b) => a + b;\n",
  "src/dep.js": "exports.dep = 'real';\n",
  "src/__mocks__/dep.js": "exports.dep = 'mocked';\n",
  "src/child.js": `const fs = require("fs");\nconst path = require("path");\nprocess.stdout.write(fs.readFileSync(path.join(__dirname, "../data/child.txt"), "utf8"));\n`,
  "data/input.txt": "3\n",
  "data/child.txt": "child\n",
  "test/sum.test.js": `const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { sum } = require("../src/sum");
test("adds", () => {
  const want = Number(fs.readFileSync(path.join(__dirname, "../data/input.txt"), "utf8"));
  expect(sum(1, 2)).toBe(want);
});
test("child reads", () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, "../src/child.js")], { encoding: "utf8" });
  expect(out).toBe("child\\n");
});
`,
  "test/mock.test.js": `jest.mock("../src/dep");
const { dep } = require("../src/dep");
test("mocked", () => expect(dep).toBe("mocked"));
`,
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-warm-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;
let runs = 0;

function worktree(major: JestMajor, extra: Readonly<Record<string, string>> = {}): AbsolutePath {
  const root = join(scratch, `tree-${made++}`);
  for (const [path, text] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  const installed = realpathSync(join(installJest(major), "node_modules/jest"));
  symlinkSync(installed, join(root, "node_modules/jest"));
  return root as AbsolutePath;
}

const ref = (path: string): TestFileRef => ({ project: "app", path });
const SUM = ref("test/sum.test.js");
const MOCK = ref("test/mock.test.js");
const SLOW = { timeout: 240_000 };

async function open(
  root: AbsolutePath,
  project: JestProject = PROJECT,
  options: Partial<JestAdapterOptions> = {},
): Promise<RunnerAdapter> {
  const adapter = await createJestAdapter(project, {
    root,
    cacheDir: join(root, "..", `cache-${made}`) as AbsolutePath,
    ...options,
  });
  onTestFinished(() => adapter.close());
  return adapter;
}

interface Ran {
  readonly report: RunReport;
  /** The warm worker of each batch, in order; `null` for a Jest process of its own. */
  readonly workers: (number | null)[];
}

async function run(
  adapter: RunnerAdapter,
  files: readonly TestFileRef[],
  options: Partial<RunOptions> = {},
): Promise<Ran> {
  const logDir = join(scratch, `logs-${runs++}`) as AbsolutePath;
  const report = await adapter.run(files, {
    runId: `run-${runs}`,
    logDir,
    timeoutMs: 120_000,
    ...options,
  });
  const log = JSON.parse(readFileSync(join(logDir, "jest", "app", "run.json"), "utf8")) as {
    batches: { worker: number | null }[];
  };
  return { report, workers: log.batches.map((b) => b.worker) };
}

function outcomes(report: RunReport): Record<string, string> {
  return Object.fromEntries(
    report.results.map((r) => [`${r.check.testPath} > ${r.check.fullName}`, r.outcome]),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number, withinMs = 10_000): Promise<boolean> {
  const until = Date.now() + withinMs;
  while (alive(pid)) {
    if (Date.now() > until) return false;
    await sleep(25);
  }
  return true;
}

/** The single warm worker of a run. */
function only(ran: Ran): number {
  const [worker, ...rest] = ran.workers;
  expect(rest).toEqual([]);
  expect(worker).toEqual(expect.any(Number));
  return worker as number;
}

describe("defaultWarmMemoryLimitBytes (spec 028 D7.2)", () => {
  it("is 10% of the machine's memory, between 256 and 1024 MiB", () => {
    const mib = 1024 * 1024;
    expect(defaultWarmMemoryLimitBytes(64 * 1024 * mib)).toBe(1024 * mib);
    expect(defaultWarmMemoryLimitBytes(4 * 1024 * mib)).toBe(409 * mib);
    expect(defaultWarmMemoryLimitBytes(1024 * mib)).toBe(256 * mib);
  });
});

describe.each(JEST_MAJORS)("the Jest %i warm pool (spec 028 D7)", (major) => {
  it("reuses its worker and sees source and manual-mock edits", SLOW, async () => {
    const root = worktree(major);
    const adapter = await open(root);
    const first = await run(adapter, [SUM, MOCK]);
    expect(first.report.completedFiles).toHaveLength(2);
    expect(Object.values(outcomes(first.report))).toEqual(["pass", "pass", "pass"]);
    const pid = only(first);
    const second = await run(adapter, [SUM, MOCK]);
    expect(only(second)).toBe(pid);
    // Warm: no Jest start, no config read, no haste map.
    expect(second.report.durationMs).toBeLessThan(first.report.durationMs);

    writeFileSync(join(root, "src/sum.js"), "exports.sum = (a, b) => a * b;\n");
    writeFileSync(join(root, "src/__mocks__/dep.js"), "exports.dep = 'edited';\n");
    await adapter.invalidate([
      { path: "src/sum.js", kind: "change" },
      { path: "src/__mocks__/dep.js", kind: "change" },
    ]);
    const edited = await run(adapter, [SUM, MOCK]);
    expect(only(edited)).toBe(pid);
    expect(outcomes(edited.report)).toMatchObject({
      "test/sum.test.js > adds": "fail",
      "test/mock.test.js > mocked": "fail",
    });
  });

  it("asks a transform's cache key again each batch, as a type checker needs", SLOW, async () => {
    const root = worktree(major, {
      "transform/side.js": `const fs = require("fs");
const path = require("path");
const side = () => fs.readFileSync(path.join(__dirname, "..", "data", "types.txt"), "utf8");
module.exports = {
  getCacheKey: (text, file) => file + text + side(),
  process(text) {
    if (side().includes("broken")) throw new Error("type error");
    return { code: text };
  },
};
`,
      "data/types.txt": "ok\n",
      "jest.config.js": CONFIG(`\n  transform: { "\\\\.js$": "<rootDir>/transform/side.js" },`),
    });
    const adapter = await open(root);
    const first = await run(adapter, [MOCK]);
    expect(outcomes(first.report)).toEqual({ "test/mock.test.js > mocked": "pass" });
    writeFileSync(join(root, "data/types.txt"), "broken\n");
    await adapter.invalidate([{ path: "data/types.txt", kind: "change" }]);
    const second = await run(adapter, [MOCK]);
    expect(only(second)).toBe(only(first));
    expect(second.report.fileErrors.map((e) => e.testFile)).toEqual([MOCK]);
  });

  it("replaces a worker above its memory limit after the batch", SLOW, async () => {
    const root = worktree(major);
    const adapter = await open(root, { ...PROJECT, warmMemoryLimitMb: 1 });
    const first = only(await run(adapter, [MOCK]));
    expect(await gone(first)).toBe(true);
    const second = await run(adapter, [MOCK]);
    expect(only(second)).not.toBe(first);
    expect(second.report.completedFiles).toEqual([MOCK]);
  });

  it(
    "replaces its worker on a config edit and an added, deleted or touched file",
    SLOW,
    async () => {
      const root = worktree(major);
      const adapter = await open(root);
      let pid = only(await run(adapter, [SUM]));

      const added = ref("test/added.test.js");
      writeFileSync(join(root, added.path), `test("added", () => expect(1).toBe(1));\n`);
      await adapter.invalidate([{ path: added.path, kind: "add" }]);
      expect(await adapter.testFiles()).toContainEqual(added);
      const afterAdd = await run(adapter, [SUM, added]);
      expect(await gone(pid)).toBe(true);
      expect(only(afterAdd)).not.toBe(pid);
      expect(outcomes(afterAdd.report)["test/added.test.js > added"]).toBe("pass");
      pid = only(afterAdd);

      rmSync(join(root, added.path));
      await adapter.invalidate([{ path: added.path, kind: "delete" }]);
      const afterDelete = only(await run(adapter, [SUM]));
      expect(afterDelete).not.toBe(pid);
      pid = afterDelete;

      utimesSync(join(root, "src/sum.js"), new Date(), new Date());
      await adapter.invalidate([{ path: "src/sum.js", kind: "touch" }]);
      const afterTouch = only(await run(adapter, [SUM]));
      expect(afterTouch).not.toBe(pid);
      pid = afterTouch;

      // A config the old worker would keep in Node's require cache: tests are now `*.spec.js`.
      writeFileSync(
        join(root, "jest.config.js"),
        `module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/test/**/*.spec.js"] };\n`,
      );
      const spec = ref("test/sum.spec.js");
      writeFileSync(join(root, spec.path), `test("spec", () => expect(2).toBe(3));\n`);
      expect(await adapter.invalidate([{ path: "jest.config.js", kind: "change" }])).toEqual({
        recreatedProjects: ["app"],
      });
      expect(await adapter.testFiles()).toEqual([spec]);
      const afterConfig = await run(adapter, [spec]);
      expect(only(afterConfig)).not.toBe(pid);
      expect(outcomes(afterConfig.report)).toEqual({ "test/sum.spec.js > spec": "fail" });
    },
  );

  it("ends an idle worker on its own, and every worker at close", SLOW, async () => {
    const root = worktree(major);
    const idle = await open(root, PROJECT, { warmIdleMs: 150 });
    const pid = only(await run(idle, [MOCK]));
    expect(await gone(pid)).toBe(true);

    const closing = await open(root);
    const kept = only(await run(closing, [MOCK]));
    await sleep(300);
    expect(alive(kept)).toBe(true);
    await closing.close();
    expect(alive(kept)).toBe(false);
  });

  it(
    "keeps files completed before a stop and replaces the killed worker (Kit K8)",
    SLOW,
    async () => {
      const hang = ref("test/hang.test.js");
      const root = worktree(major, {
        [hang.path]: `const fs = require("fs");
const path = require("path");
test("hangs", async () => {
  fs.writeFileSync(path.join(__dirname, "..", "hang.started"), "");
  await new Promise((done) => setTimeout(done, 600_000));
}, 700_000);
`,
      });
      const adapter = await open(root, { ...PROJECT, batchSize: 2 });
      const stop = new AbortController();
      const started = join(root, "hang.started");
      const watch = setInterval(() => {
        if (existsSync(started)) stop.abort();
      }, 20);
      onTestFinished(() => clearInterval(watch));
      const cut = await run(adapter, [MOCK, hang], { stop: stop.signal });
      clearInterval(watch);
      expect(cut.report.completedFiles).toEqual([MOCK]);
      expect(outcomes(cut.report)).toEqual({ "test/mock.test.js > mocked": "pass" });
      const killed = only(cut);
      expect(await gone(killed)).toBe(true);
      const next = await run(adapter, [MOCK]);
      expect(only(next)).not.toBe(killed);
      expect(next.report.completedFiles).toEqual([MOCK]);
    },
  );

  it("observes each batch afresh in the same worker", SLOW, async () => {
    const root = worktree(major);
    const adapter = await open(root);
    const seen = (report: RunReport) =>
      report.observed?.find((o) => o.testFile.path === SUM.path)?.paths ?? [];
    const first = await run(adapter, [SUM]);
    const second = await run(adapter, [SUM]);
    expect(only(second)).toBe(only(first));
    for (const { report } of [first, second]) {
      expect(report.completedFiles).toEqual([SUM]);
      expect(seen(report)).toEqual(expect.arrayContaining(["data/input.txt", "data/child.txt"]));
    }
  });

  it("collects coverage and runs an inline project warm", SLOW, async () => {
    const root = worktree(major, {
      "inline.config.js": `module.exports = { projects: [
  { displayName: "unit", testEnvironment: "node", testMatch: ["<rootDir>/test/mock.test.js"] },
  { displayName: "other", testEnvironment: "node", testMatch: ["<rootDir>/test/none.test.js"] },
] };
`,
    });
    const coverageRuns: CoverageRun[] = [];
    const coverage: RunnerCoverageOptions = {
      enabled: () => true,
      collected: (r) => coverageRuns.push(r),
    };
    const covered = await open(root, PROJECT, { coverage });
    await covered.environment();
    const first = await run(covered, [SUM]);
    const again = await run(covered, [SUM]);
    expect(only(again)).toBe(only(first));
    expect(coverageRuns.map((r) => r.files.map((f) => f.testFile.path))).toEqual([
      [SUM.path],
      [SUM.path],
    ]);

    const inline = await open(root, { ...PROJECT, config: "inline.config.js", project: "unit" });
    expect(await inline.testFiles()).toEqual([MOCK]);
    const unit = await run(inline, [MOCK]);
    only(unit);
    expect(outcomes(unit.report)).toEqual({ "test/mock.test.js > mocked": "pass" });
  });

  it("runs a Jest process per batch for args or a global hook", SLOW, async () => {
    const root = worktree(major, {
      "setup/global.js": "module.exports = async () => { process.env.FROM_GLOBAL = '1'; };\n",
      "global.config.js": CONFIG(`\n  globalSetup: "<rootDir>/setup/global.js",`),
    });
    const withArgs = await open(root, { ...PROJECT, args: ["--testTimeout=20000"] });
    const argsRun = await run(withArgs, [MOCK]);
    expect(argsRun.workers).toEqual([null]);
    expect(outcomes(argsRun.report)).toEqual({ "test/mock.test.js > mocked": "pass" });

    const hooked = await open(root, { ...PROJECT, config: "global.config.js" });
    const hookRun = await run(hooked, [MOCK]);
    expect(hookRun.workers).toEqual([null]);
    expect(outcomes(hookRun.report)).toEqual({ "test/mock.test.js > mocked": "pass" });
  });
});
