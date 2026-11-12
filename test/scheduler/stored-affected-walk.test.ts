import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { askAffected } from "../../src/core/scheduler/stored-affected.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import type { AffectedTestFiles } from "../../src/core/types/runner.js";
import { SLOW } from "./cleanup.js";
import { openHarness as openNodeTestHarness } from "./node-test-harness.js";
import { createRepo, openRepoStore } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Row 021-30 (spec 021 D21.3): after a content edit the scheduler takes
 * `affected` from the walks it stored, at the keys the files held before
 * the edit, and the answer is the one a real Vitest walk gives; every edit
 * the rule does not cover still asks the runner.
 */

vi.mock("../../src/core/scheduler/stored-affected.js", async (actual) => {
  const real = await actual<typeof import("../../src/core/scheduler/stored-affected.js")>();
  return { ...real, askAffected: vi.fn(real.askAffected) };
});

const LEAF = "src/leaf.ts";
const DIRECT = "test/direct.test.ts";
const THROUGH = "test/through.test.ts";
const FILES: Readonly<Record<string, string>> = {
  [LEAF]: "export const value = 1;\n",
  "src/mid.ts": 'export { value } from "./leaf.js";\n',
  [DIRECT]: [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/leaf.js";',
    'it("d", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
  [THROUGH]: [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/mid.js";',
    'it("t", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
};

const NODE_TEST: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

/** A started scheduler over the basic fixture and `FILES`, settled, with its runner's `affected` asks counted. */
async function settled(nodeTest = false) {
  const repo = createRepo("basic");
  const files = nodeTest
    ? {
        ...FILES,
        "nt/test/a.test.mjs": 'import { test } from "node:test";\ntest("a", () => {});\n',
      }
    : FILES;
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), text);
  }
  const store = openRepoStore(repo.commonDir);
  const h = nodeTest
    ? await openNodeTestHarness(repo.main, store, repo.commonDir, {
        tierSize: 2,
        nodeTest: [NODE_TEST],
        policy: { nodeTest: [NODE_TEST] },
      })
    : await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
  await h.scheduler.start();
  await h.scheduler.idle();
  const host = h.runner.affected.bind(h.runner);
  const asked: string[][] = [];
  h.runner.affected = (paths) => {
    asked.push([...paths]);
    return host(paths);
  };
  return { h, host, asked };
}

async function edit(h: Harness, path: string, text: string | null): Promise<void> {
  if (text === null) h.remove(path);
  else h.write(path, text);
  await h.batch(path);
  await h.scheduler.idle();
}

const pathsOf = (a: AffectedTestFiles | null) => ({
  direct: (a?.direct ?? []).map((r) => r.path),
  transitive: (a?.transitive ?? []).map((r) => r.path),
});

/** What `askAffected` answered for exactly `paths`, last. */
async function answered(paths: readonly string[]): Promise<AffectedTestFiles | null> {
  const { calls, results } = vi.mocked(askAffected).mock;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (JSON.stringify(calls[i]?.[3]) !== JSON.stringify(paths)) continue;
    const result = results[i];
    if (result?.type !== "return") break;
    return (await result.value).affected;
  }
  throw new Error(`no affected ask for ${paths.join(", ")}`);
}

describe("affected from the stored import graph (021-30)", SLOW, () => {
  it("answers a content edit from the stored walks as Vitest's walk does, without the runner", async () => {
    const { h, host, asked } = await settled();
    await edit(h, LEAF, `${FILES[LEAF]}// an edit\n`);
    expect(asked).toEqual([]);
    const stored = pathsOf(await answered([LEAF]));
    expect(stored).toEqual({ direct: [DIRECT], transitive: [THROUGH] });
    expect(stored).toEqual(pathsOf(await host([LEAF as RelativePath])));
    expect(h.runsOf(DIRECT).length).toBeGreaterThan(0);
    expect(h.errors).toEqual([]);
  });

  it("asks the runner for an add, a delete, a snapshot and an environment input", async () => {
    const { h, asked } = await settled();
    const snapshot = "test/__snapshots__/direct.test.ts.snap";
    const config = readFileSync(join(h.root, "vitest.config.ts"), "utf8");
    const steps: [string, string | null][] = [
      ["src/new.ts", "export const fresh = 1;\n"],
      ["src/new.ts", null],
      [snapshot, "// Vitest Snapshot v1\n"],
      [snapshot, "// Vitest Snapshot v1\n\n"],
      ["vitest.config.ts", `${config}// an edit\n`],
    ];
    for (const [path, text] of steps) {
      asked.length = 0;
      await edit(h, path, text);
      expect(asked, `${path} ${text === null ? "deleted" : "written"}`).toContainEqual([path]);
    }
    expect(h.errors).toEqual([]);
  });

  it("asks the runner while a node:test project is listed beside Vitest", async () => {
    const { h, asked } = await settled(true);
    await edit(h, LEAF, `${FILES[LEAF]}// an edit\n`);
    expect(asked).toContainEqual([LEAF]);
    expect(h.errors).toEqual([]);
  });
});
