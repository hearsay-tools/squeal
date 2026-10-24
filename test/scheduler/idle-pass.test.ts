import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { pytestObservedStore } from "../../src/core/daemon/pytest-runners.js";
import type {
  AbsolutePath,
  NodeTestProject,
  PytestProject,
  RunnerAdapter,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { createPytestAdapter } from "../../src/runners/pytest/adapter.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { pythonEnv } from "../helpers/pytest-env.js";
import { pytestRepos } from "../integration/pytest-repo.js";
import { openHarness, openRepoStore } from "./helpers.js";

/*
 * Task 007-26 (007 review wave 2.5, R2): an idle daemon's quiet pass over a
 * composite of Vitest, node:test and pytest does no runner work but the
 * pytest environment's fingerprint read. Counted over the whole pass, not
 * one call: every adapter method, every observation read of the shared
 * store, and the fingerprint reads.
 */

const fingerprints = vi.hoisted(() => ({ reads: 0 }));
vi.mock("../../src/runners/pytest/adapter-run.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/runners/pytest/adapter-run.js")>();
  return {
    ...actual,
    currentFingerprint: (...args: Parameters<typeof actual.currentFingerprint>) => {
      fingerprints.reads += 1;
      return actual.currentFingerprint(...args);
    },
  };
});

const repos = pytestRepos("idle-pass");
const SLOW = { timeout: 300_000 } as const;
const PASSES = 3;

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const PYTEST: PytestProject = { name: "small", args: [], env: {}, include: ["tests/**/test_*.py"] };
const NT_FILES: Readonly<Record<string, string>> = {
  "nt/src/value.mjs": "export const value = 1;\n",
  "nt/test/value.test.mjs": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { value } from "../src/value.mjs";',
    'test("value is one", () => assert.equal(value, 1));',
    "",
  ].join("\n"),
};

const METHODS = [
  "invalidate",
  "recheck",
  "affected",
  "closure",
  "enumerate",
  "testFiles",
  "environment",
  "run",
] as const;

/** Counts every call to `adapter`'s runner methods, in place, under `label`. */
function count(adapter: RunnerAdapter, label: string, calls: string[]): void {
  for (const name of METHODS) {
    const method = adapter[name] as ((...args: unknown[]) => Promise<unknown>) | undefined;
    if (method === undefined) continue;
    Object.assign(adapter, {
      [name]: (...args: unknown[]) => {
        calls.push(`${label}.${name}`);
        return method.apply(adapter, args);
      },
    });
  }
}

/** `store` with each read method counted in `reads`. */
function counted<T extends object>(store: T, reads: string[], label: string): T {
  return new Proxy(store, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || !String(key).startsWith("read")) return value;
      return (...args: unknown[]) => {
        reads.push(`${label}.${String(key)}`);
        return value.apply(target, args);
      };
    },
  });
}

describe("an idle pass over Vitest, node:test and pytest (007-26)", () => {
  it(
    "costs one pytest fingerprint read and nothing else: no affected, discovery or observation scan",
    SLOW,
    async (ctx) => {
      const main = repos.createRepo("main", NT_FILES);
      repos.uvSync(ctx, main);
      const commonDir = join(main, ".git");
      const store = openRepoStore(commonDir);
      const reads: string[] = [];
      const calls: string[] = [];
      const nodeTest = await createNodeTestAdapter(NT, {
        root: main,
        observed: counted(observedStore(store, NT.name), reads, "node-test"),
      });
      const pytest = await createPytestAdapter(PYTEST, {
        root: main as AbsolutePath,
        source: pythonEnv(),
        observed: counted(pytestObservedStore(store, PYTEST.name), reads, "pytest"),
        cacheDir: join(main, "..", "pytest-cache") as AbsolutePath,
      });
      count(nodeTest, "node-test", calls);
      count(pytest, "pytest", calls);
      const h = await openHarness(main, store, commonDir, {
        adapters: [nodeTest, pytest],
        policy: RUN_MISSING,
      });
      count(h.runner, "vitest", calls);
      await h.scheduler.start();
      await h.scheduler.idle();
      // Every runner ran at the baseline, pytest in a ready environment.
      expect(calls).toEqual(expect.arrayContaining(["vitest.run", "node-test.run", "pytest.run"]));
      expect((await pytest.environment())[0]?.runnerVersion).toMatch(/^\d+\.\d+/);
      expect(h.header().counts).toMatchObject({ pending: 0, stale: 0, unknown: 0 });

      calls.length = 0;
      reads.length = 0;
      fingerprints.reads = 0;
      for (let pass = 0; pass < PASSES; pass++) {
        await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
        await h.scheduler.idle();
      }
      ctx.annotate(
        `${PASSES} quiet passes: calls ${JSON.stringify(calls)}, observation reads ${reads.length}, fingerprint reads ${fingerprints.reads}`,
      );

      expect(calls).toEqual(Array.from({ length: PASSES }, () => "pytest.recheck"));
      expect(reads).toEqual([]);
      expect(fingerprints.reads).toBe(PASSES);
    },
  );
});
