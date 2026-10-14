import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import {
  createNodeTestAdapter,
  type ObservedStore,
} from "../../../src/runners/node-test/adapter.js";

/**
 * 007 review wave 2, B1 (agreed with the coordinator): the scheduler hands
 * every adapter an empty `invalidate` at each reconciliation pass, the
 * recheck pytest's installed set needs. node:test needs none: it reads no
 * store, probes no Node and builds no failed project again for it.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
let root = "";

beforeAll(() => {
  mkdirSync(scratch, { recursive: true });
  cpSync(join(FIXTURES, "reference"), join(scratch, "reference"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  root = realpathSync(join(scratch, "reference"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const project = (name: string, cwd: string): NodeTestProject => ({
  name,
  cwd,
  node: process.execPath,
  argv: ["--import", "tsx"],
  env: {},
  include: ["test/unit/*.test.ts"],
});

/** A store that counts its reads. */
function counting(): ObservedStore & { reads: () => number } {
  let reads = 0;
  return {
    reads: () => reads,
    read: () => {
      reads += 1;
      return {};
    },
    write: () => {},
    readPreloads: () => [],
    writePreloads: () => {},
  };
}

describe("node:test on the scheduler's empty recheck (007 B1)", () => {
  it("a built project reads no store and recreates nothing", SLOW, async () => {
    const store = counting();
    const adapter = await createNodeTestAdapter(project("demo", "packages/demo"), {
      root,
      observed: store,
    });
    const reads = store.reads();
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
    expect(store.reads()).toBe(reads);
    // A real batch still refreshes from the store.
    await adapter.invalidate([{ path: "packages/demo/src/a.ts", kind: "change" }]);
    expect(store.reads()).toBe(reads + 1);
  });

  it("a failed project is not built again by it, only by a batch", SLOW, async () => {
    const cwd = `packages/later-${randomUUID()}`;
    const adapter = await createNodeTestAdapter(project("later", cwd), { root });
    const testFile = `${cwd}/test/unit/a.test.ts`;
    mkdirSync(join(root, cwd, "test/unit"), { recursive: true });
    writeFileSync(join(root, cwd, "package.json"), `{"type":"module"}\n`);
    writeFileSync(
      join(root, testFile),
      `import { test } from "node:test";\ntest("x", () => {});\n`,
    );
    // The cwd now exists, so a batch would build it; the recheck does not.
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
    expect(await adapter.testFiles()).toEqual([]);
    expect(await adapter.invalidate([{ path: testFile, kind: "add" }])).toEqual({
      recreatedProjects: ["later"],
    });
  });
});
