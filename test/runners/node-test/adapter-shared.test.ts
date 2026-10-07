import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { observedStore } from "../../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject, RunnerAdapter } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/**
 * Review wave 2, S2: two worktrees' adapters over one store, both started
 * before either ran. A's run observes a path its static graph cannot see; B
 * learns it from the shared `nodeTest.observed.<project>` key without a
 * restart (spec 003 D3).
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-shared-"));
let roots: string[] = [];

const HIDDEN_TEST = [
  `import assert from "node:assert/strict";`,
  `import { test } from "node:test";`,
  `const target = "../../src/hidden.ts";`,
  `test("loads a module the graph cannot see", async () => {`,
  `  assert.equal((await import(target)).hidden, 1);`,
  `});`,
  "",
].join("\n");

beforeAll(() => {
  roots = ["a", "b"].map((name) => {
    const root = join(scratch, name);
    mkdirSync(root, { recursive: true });
    cpSync(join(FIXTURES, "reference"), root, { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(root, "packages/demo/src/hidden.ts"), "export const hidden = 1;\n");
    writeFileSync(join(root, "packages/demo/test/unit/hidden.test.ts"), HIDDEN_TEST);
    return realpathSync(root);
  });
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const PROJECT: NodeTestProject = {
  name: "unit",
  cwd: "packages/demo",
  node: process.execPath,
  argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
  env: {},
  include: ["test/unit/*.test.ts"],
};
const HIDDEN = { project: "unit", path: "packages/demo/test/unit/hidden.test.ts" };
const HIDDEN_SRC = "packages/demo/src/hidden.ts";
const UNRELATED = "README.md";

const runHidden = (adapter: RunnerAdapter) =>
  adapter.run([HIDDEN], { runId: "r", logDir: join(logs, randomUUID()), timeoutMs: 30_000 });

describe("a daemon already running when another worktree observes a path (review wave 2, S2)", () => {
  it(
    "learns it at its next revision, whatever changed, and re-keys the test file",
    SLOW,
    async () => {
      const store = open(fakeCommonDir());
      const [rootA, rootB] = roots as [string, string];
      const a = await createNodeTestAdapter(PROJECT, {
        root: rootA,
        observed: observedStore(store, "unit"),
      });
      const b = await createNodeTestAdapter(PROJECT, {
        root: rootB,
        observed: observedStore(store, "unit"),
      });
      expect((await b.closure(HIDDEN)).paths).not.toContain(HIDDEN_SRC);

      expect((await runHidden(a)).end).toBe("completed");

      // The rule that bounds "B applies A's pass under a key lacking A's observed path":
      // B's next refinement, which any revision of B starts (invalidate, then affected),
      // reports the file affected, so the scheduler fetches its closure, which now holds
      // the path, and re-keys it. With no revision in B the scheduler asks B's runner
      // nothing, so the window is open until B's next revision.
      await b.invalidate([{ path: UNRELATED, kind: "change" }]);
      expect(await b.affected([UNRELATED])).toEqual({ direct: [], transitive: [HIDDEN] });
      expect((await b.closure(HIDDEN)).paths).toContain(HIDDEN_SRC);
      // Reported once: the next revision's refinement does not re-key it again.
      await b.invalidate([{ path: UNRELATED, kind: "change" }]);
      expect(await b.affected([UNRELATED])).toEqual({ direct: [], transitive: [] });
      // From then on B's edits of the path schedule the file.
      expect(await b.affected([HIDDEN_SRC])).toEqual({ direct: [], transitive: [HIDDEN] });
    },
  );

  it("holds the path in a closure asked for before any revision of its own", SLOW, async () => {
    const store = open(fakeCommonDir());
    const [rootA, rootB] = roots as [string, string];
    const b = await createNodeTestAdapter(PROJECT, {
      root: rootB,
      observed: observedStore(store, "unit"),
    });
    const a = await createNodeTestAdapter(PROJECT, {
      root: rootA,
      observed: observedStore(store, "unit"),
    });
    expect((await runHidden(a)).end).toBe("completed");
    expect((await b.closure(HIDDEN)).paths).toContain(HIDDEN_SRC);
    expect((await b.affected([HIDDEN_SRC])).transitive).toEqual([HIDDEN]);
  });
});
