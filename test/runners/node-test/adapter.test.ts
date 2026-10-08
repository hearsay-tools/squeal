import { randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NodeTestProject, RunnerAdapter } from "../../../src/core/types/index.js";
import {
  createNodeTestAdapter,
  type ObservedPaths,
} from "../../../src/runners/node-test/adapter.js";

/**
 * Spec 003 D1 to D5 through the assembled adapter, on a copy of the
 * reference fixture. Copies go under the fixtures' git-ignored `.tmp/`, so
 * tsx resolves from the repository's `node_modules`.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-adapter-"));
let root = "";

const HIDDEN_TEST = [
  `import assert from "node:assert/strict";`,
  `import { test } from "node:test";`,
  `const target = "../../src/hidden.ts";`,
  `test("loads a module the graph cannot see", async () => {`,
  `  const { hidden } = await import(target);`,
  `  assert.equal(hidden, 1);`,
  `});`,
  `test("sees Squeal's temp directory", async () => {`,
  `  const { tmpdir } = await import("node:os");`,
  `  assert.equal(tmpdir(), process.env.EXPECTED_TMP);`,
  `});`,
  `test("carries the daemon's child mark", () => {`,
  `  assert.equal(process.env.SQUEAL_DAEMON_CHILD, "mark-003-38");`,
  `});`,
].join("\n");

beforeAll(() => {
  mkdirSync(scratch, { recursive: true });
  cpSync(join(FIXTURES, "reference"), join(scratch, "reference"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  root = realpathSync(join(scratch, "reference"));
  writeFileSync(join(root, "packages/demo/src/hidden.ts"), "export const hidden = 1;\n");
  writeFileSync(join(root, "packages/demo/test/unit/hidden.test.ts"), `${HIDDEN_TEST}\n`);
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const tempDir = mkdtempSync(join(tmpdir(), "squeal-node-test-adapter-tmp-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const project = (more: Partial<NodeTestProject> = {}): NodeTestProject => ({
  name: "unit",
  cwd: "packages/demo",
  node: process.execPath,
  argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
  env: { EXPECTED_TMP: tempDir },
  include: ["test/unit/*.test.ts"],
  ...more,
});
const UNIT = "packages/demo/test/unit";
const ref = (name: string) => ({ project: "unit", path: `${UNIT}/${name}.test.ts` });

/** An in-memory `nodeTest.observed.<project>` key. */
function memoryStore(initial: ObservedPaths = {}) {
  let value: Record<string, string[]> = Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [k, [...v]]),
  );
  const writes: ObservedPaths[] = [];
  return {
    writes,
    value: () => value,
    store: {
      read: () => value,
      readPreloads: () => [],
      writePreloads: () => {},
      write(additions: ObservedPaths) {
        writes.push(additions);
        value = { ...value };
        for (const [file, paths] of Object.entries(additions)) {
          value[file] = [...new Set([...(value[file] ?? []), ...paths])].sort();
        }
      },
    },
  };
}

const open = (more: Partial<NodeTestProject> = {}, extra = {}) => {
  const notes: string[] = [];
  const adapter = createNodeTestAdapter(project(more), {
    root,
    tempDir,
    childEnv: { SQUEAL_DAEMON_CHILD: "mark-003-38" },
    note: (text) => notes.push(text),
    ...extra,
  });
  return { adapter, notes };
};
const run = (adapter: RunnerAdapter, names: string[]) =>
  adapter.run(names.map(ref), { runId: "r", logDir: join(logs, randomUUID()), timeoutMs: 30_000 });

describe("createNodeTestAdapter", () => {
  it("lists the project's test files and its environment", SLOW, async () => {
    const { adapter, notes } = open({ exclude: ["test/unit/title.test.ts"] });
    const a = await adapter;
    // Review wave 2, N4: the computed import is named before the file runs.
    expect(notes).toEqual([
      `node-test project "unit": 1 test file(s) with an incomplete static closure, keyed by what their runs load: ${UNIT}/hidden.test.ts (import() with a computed specifier at ${UNIT}/hidden.test.ts:5:28)`,
    ]);
    expect(await a.testFiles()).toEqual([ref("hidden"), ref("math")]);
    const [env] = await a.environment();
    expect(env).toMatchObject({
      project: "unit",
      root: "packages/demo",
      runnerName: "node-test",
      runnerVersion: process.version,
      adapterVersion: a.adapterVersion,
      files: [
        "package.json",
        "packages/demo/package.json",
        "scripts/lib/marker.mjs",
        "scripts/preload.mjs",
      ],
    });
    expect(JSON.parse(env?.resolvedConfig ?? "")).toEqual({
      node: process.execPath,
      execPath: process.execPath,
      argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
      env: [["EXPECTED_TMP", tempDir]],
      cwd: "packages/demo",
      include: ["test/unit/*.test.ts"],
      exclude: ["test/unit/title.test.ts"],
    });
    expect((await a.enumerate(ref("math"))).map((c) => c.check.fullName)).toEqual([
      "adds",
      "sees the preload",
    ]);
  });

  it("affects only the test files whose closure holds a changed module", SLOW, async () => {
    const a = await open().adapter;
    expect(await a.affected(["packages/demo/src/math.ts"])).toEqual({
      direct: [ref("math")],
      transitive: [],
    });
    expect(await a.affected(["packages/util/src/index.ts"])).toEqual({
      direct: [],
      transitive: [ref("title")],
    });
    expect((await a.affected(["scripts/lib/marker.mjs"])).transitive).toEqual(
      ["hidden", "math", "title"].map(ref),
    );
  });

  it(
    "runs under the project's logDir with TMPDIR, and records what the graph missed",
    SLOW,
    async () => {
      const memory = memoryStore();
      const a = await open({}, { observed: memory.store }).adapter;
      const hidden = "packages/demo/src/hidden.ts";
      expect((await a.closure(ref("hidden"))).paths).not.toContain(hidden);
      expect(await a.affected([hidden])).toEqual({ direct: [], transitive: [] });

      const logDir = join(logs, randomUUID());
      const report = await a.run([ref("hidden"), ref("math")], {
        runId: "r",
        logDir,
        timeoutMs: 30_000,
      });
      expect(report).toMatchObject({ end: "completed", failure: null });
      expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
        "loads a module the graph cannot see: pass",
        "sees Squeal's temp directory: pass",
        "carries the daemon's child mark: pass",
        "adds: pass",
        "sees the preload: pass",
      ]);
      expect(existsSync(join(logDir, "node-test", "unit", "run.json"))).toBe(true);

      expect(memory.writes).toEqual([{ [ref("hidden").path]: [hidden] }]);
      expect((await a.closure(ref("hidden"))).paths).toContain(hidden);
      expect(await a.affected([hidden])).toEqual({ direct: [], transitive: [ref("hidden")] });

      // A second run that sees nothing new writes nothing.
      await run(a, ["hidden"]);
      expect(memory.writes).toHaveLength(1);
    },
  );

  it("reads the stored observations before its first run", SLOW, async () => {
    const hidden = "packages/demo/src/hidden.ts";
    const memory = memoryStore({ [ref("hidden").path]: [hidden] });
    const a = await open({}, { observed: memory.store }).adapter;
    expect((await a.closure(ref("hidden"))).paths).toContain(hidden);
    expect((await a.closure(ref("math"))).paths).not.toContain(hidden);
    expect((await a.affected([hidden])).transitive).toEqual([ref("hidden")]);
  });

  it("refreshes the listing after an add or a delete", SLOW, async () => {
    const a = await open().adapter;
    const added = `${UNIT}/added.test.ts`;
    writeFileSync(
      join(root, added),
      `import { test } from "node:test";\nimport { add } from "../../src/math.js";\ntest("x", () => add(1, 1));\n`,
    );
    try {
      await a.invalidate([{ path: added, kind: "add" }]);
      expect(await a.testFiles()).toContainEqual(ref("added"));
      expect((await a.closure(ref("added"))).paths).toContain("packages/demo/src/math.ts");
      expect((await a.affected(["packages/demo/src/math.ts"])).direct).toEqual([
        ref("added"),
        ref("math"),
      ]);
    } finally {
      unlinkSync(join(root, added));
    }
    await a.invalidate([{ path: added, kind: "delete" }]);
    expect(await a.testFiles()).not.toContainEqual(ref("added"));
  });

  it(
    "is a runner failure of its project while its Node is missing, and recovers",
    SLOW,
    async () => {
      const node = join(scratch, `node-${randomUUID()}`);
      const { adapter, notes } = open({ node });
      const a = await adapter;
      expect(notes.filter((n) => !n.includes("incomplete static closure"))).toEqual([
        expect.stringMatching(/^node-test project "unit": cannot run .*node-/),
      ]);
      expect(await a.testFiles()).toContainEqual(ref("math"));
      expect((await a.environment())[0]?.runnerVersion).toBe("unavailable");
      expect(await run(a, ["math"])).toMatchObject({
        end: "crashed",
        completedFiles: [],
        failure: expect.stringMatching(/cannot run/),
      });
      expect(await a.invalidate([{ path: "README.md", kind: "change" }])).toEqual({
        recreatedProjects: [],
      });

      writeFileSync(node, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
      chmodSync(node, 0o755);
      expect(await a.invalidate([{ path: "README.md", kind: "change" }])).toEqual({
        recreatedProjects: ["unit"],
      });
      expect((await a.environment())[0]?.runnerVersion).toBe(process.version);
      expect((await run(a, ["math"])).end).toBe("completed");
    },
  );
});
