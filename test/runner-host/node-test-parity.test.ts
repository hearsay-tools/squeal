import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CoverageRun } from "../../src/core/code/coverage/types.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { createHostedNodeTest } from "../../src/core/runner-host/process-host.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../src/core/types/runner.js";
import {
  createNodeTestAdapter,
  type NodeTestAdapterOptions,
} from "../../src/runners/node-test/adapter.js";
import { SLOW } from "../daemon/helpers.js";
import { sourceHost, steady } from "./process-helpers.js";

/*
 * Spec 021 D8 (row 021-12) done-when: the node:test adapter in a runner
 * host, driven through the proxy, gives the same answers, notes and results
 * as the adapter in this process. Each case runs the same steps on two
 * copies of the reference fixture, one per adapter, and compares what they
 * return, durations left out. The host is the real `squeal runner-host`,
 * started from the sources as a daemon from the sources starts it.
 */

const FIXTURES = resolve(import.meta.dirname, "../fixtures/node-test");
// Under the fixtures' git-ignored `.tmp/`, so tsx resolves from the repository's `node_modules`.
const scratch = join(FIXTURES, ".tmp", randomUUID());
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const UNIT = "packages/demo/test/unit";
const FILES = ["math", "title"].map((name) => `${UNIT}/${name}.test.ts`);
const ref = (path: string): TestFileRef => ({ project: "unit", path });
const refs = FILES.map(ref);

type Make = (project: NodeTestProject, options: NodeTestAdapterOptions) => Promise<RunnerAdapter>;
const inProcess: Make = createNodeTestAdapter;
const hosted: Make = (project, options) =>
  createHostedNodeTest(sourceHost(squealVersion()), project, options);

interface Copy {
  readonly root: AbsolutePath;
  readonly adapter: RunnerAdapter;
  readonly notes: (readonly [string, string | undefined])[];
  readonly runOptions: () => RunOptions;
  write(path: string, text: string): void;
}

/** A fresh copy of the reference fixture with an adapter made by `make`. */
async function open(
  make: Make,
  options: Partial<NodeTestAdapterOptions> = {},
  more: Partial<NodeTestProject> = {},
): Promise<Copy> {
  const at = join(scratch, randomUUID());
  mkdirSync(at, { recursive: true });
  cpSync(join(FIXTURES, "reference"), join(at, "reference"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  const root = realpathSync(join(at, "reference")) as AbsolutePath;
  const tempDir = join(at, "tmp") as AbsolutePath;
  mkdirSync(tempDir);
  const notes: (readonly [string, string | undefined])[] = [];
  const project: NodeTestProject = {
    name: "unit",
    cwd: "packages/demo",
    node: process.execPath,
    argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
    env: {},
    include: ["test/unit/*.test.ts"],
    ...more,
  };
  const adapter = await make(project, {
    root,
    tempDir,
    childEnv: { SQUEAL_DAEMON_CHILD: "mark-021-12" },
    concurrency: () => 2,
    inputs: () => [],
    note: (text, topic) => notes.push([text, topic]),
    ...options,
  });
  let runs = 0;
  return {
    root,
    adapter,
    notes,
    runOptions: () => ({
      runId: `r${runs}`,
      logDir: join(at, `logs-${runs++}`) as AbsolutePath,
      timeoutMs: 60_000,
    }),
    write: (path, text) => writeFileSync(join(root, path), text),
  };
}

/** `steps` on a fresh copy through each adapter; both results. */
async function both<T>(
  steps: (copy: Copy) => Promise<T>,
  options: Partial<NodeTestAdapterOptions> = {},
): Promise<{ local: T; remote: T }> {
  const results: T[] = [];
  for (const make of [inProcess, hosted]) {
    const copy = await open(make, options);
    try {
      results.push(await steps(copy));
    } finally {
      await copy.adapter.close();
    }
  }
  const [local, remote] = results as [T, T];
  return { local, remote };
}

describe("the node:test adapter through a runner host", SLOW, () => {
  it("lists, keys, describes and notes the same", async () => {
    const { local, remote } = await both(async (copy) => {
      const { adapter } = copy;
      const answers = {
        name: adapter.name,
        adapterVersion: adapter.adapterVersion,
        focuses: adapter.traits.focuses(ref(`${UNIT}/title.test.ts`)),
        testFiles: await adapter.testFiles(),
        omitted: adapter.traits.omittedTestFiles(),
        environment: await adapter.environment(),
        closures: await Promise.all(refs.map((f) => adapter.closure(f))),
        checks: await Promise.all(refs.map((f) => adapter.enumerate(f))),
        affected: await adapter.affected(["packages/util/src/index.ts"]),
      };
      return { ...answers, notes: [...copy.notes] };
    });
    expect(remote).toEqual(local);
    expect(local.testFiles).toEqual(refs);
    expect(local.affected.transitive).toEqual([ref(`${UNIT}/title.test.ts`)]);
  });

  it("runs every file with the same results, file ends and observed inputs", async () => {
    const { local, remote } = await both(async (copy) => {
      const ended: string[] = [];
      const report = await copy.adapter.run(refs, {
        ...copy.runOptions(),
        fileEnded: (f) => ended.push(f.path),
      });
      return { report: steady(report), ended: ended.sort(), notes: [...copy.notes] };
    });
    expect(remote).toEqual(local);
    expect((local.report as RunReport).end).toBe("completed");
    expect((local.report as RunReport).results.map((r) => r.outcome)).toContain("pass");
  });

  it("hands over the same coverage payloads", async () => {
    const runs: CoverageRun[] = [];
    const { local, remote } = await both(
      async (copy) => {
        runs.length = 0;
        const report = await copy.adapter.run(refs, copy.runOptions());
        await expect.poll(() => runs.length).toBe(1);
        return {
          report: steady(report),
          covered: runs
            .flatMap((run) =>
              run.files.map((file) => ({
                testFile: file.testFile,
                payload: existsSync(file.payload),
                ownRoot: file.ownRoot === undefined ? null : relative(copy.root, file.ownRoot),
                sources: file.sources.size,
              })),
            )
            .sort((a, b) => a.testFile.path.localeCompare(b.testFile.path)),
        };
      },
      { coverage: { enabled: () => true, collected: (run) => runs.push(run) } },
    );
    expect(remote).toEqual(local);
    expect(local.covered.map((file) => file.testFile)).toEqual(refs);
    expect(local.covered.every((file) => file.payload)).toBe(true);
  });

  it("finds the same affected files after an edit, and runs a failing edit the same", async () => {
    const { local, remote } = await both(async (copy) => {
      const { adapter } = copy;
      await adapter.testFiles();
      copy.write(
        "packages/demo/src/math.ts",
        "export const add = (a: number, b: number) => a - b;\n",
      );
      const invalidated = await adapter.invalidate([
        { path: "packages/demo/src/math.ts", kind: "change" },
      ]);
      const affected = await adapter.affected(["packages/demo/src/math.ts"]);
      const report = await adapter.run(
        [...affected.direct, ...affected.transitive],
        copy.runOptions(),
      );
      return { invalidated, affected, report: steady(report) };
    });
    expect(remote).toEqual(local);
    expect((local.report as RunReport).results.some((r) => r.outcome === "fail")).toBe(true);
  });
});
