import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { FixtureRepo } from "../daemon/helpers.js";
import { featureRepo, gate, hasRecord, keepPolicy, keysNow } from "./code-gate-keep-kit.js";

/*
 * Spec 020 D11.7 and D17.3 (row 020-51): `squeal code --base` keys the
 * stores with the Vitest adapter its run opens, built as a daemon builds
 * its own, and starts no second Vitest only to key. The file it keeps is
 * at the key a daemon's adapters give, and the next run reads it there.
 */

const vitests = vi.hoisted(() => ({ opened: 0 }));

vi.mock("../../src/runners/vitest/index.js", async (original) => {
  const actual = await original<typeof import("../../src/runners/vitest/index.js")>();
  return {
    ...actual,
    createVitestAdapter: (...args: Parameters<typeof actual.createVitestAdapter>) => {
      vitests.opened++;
      return actual.createVitestAdapter(...args);
    },
  };
});

const SLOW = { timeout: 240_000 } as const;

const FEATURE: Readonly<Record<string, string>> = {
  "src/one.ts": "export const one = (x: number) => (x > 0 ? 1 : 0);\n",
  "test/one.test.ts": `import { expect, it } from "vitest";\nimport { one } from "../src/one.ts";\n\nit("one", () => {\n  expect(one(1)).toBe(1);\n});\n`,
};

const ONE: TestFileRef = { project: "", path: "test/one.test.ts" };

describe("squeal code --base keys with its own Vitest (row 020-51)", () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = featureRepo(keepPolicy("lookup-only"), FEATURE);
  });

  afterAll(() => repo?.cleanup());

  it("opens one Vitest adapter in a run that keys, keeps and then reads a file", SLOW, async () => {
    vitests.opened = 0;
    const first = await gate(repo, ["src/one.ts"]);

    expect(first.ran).toEqual([ONE.path]);
    expect(first.report.runs.map((r) => [r.runner, r.completed])).toEqual([
      ["vitest", [ONE.path]],
    ]);
    expect(vitests.opened).toBe(1);

    // The key the run kept the file at is the one a daemon's own adapters give.
    const [key] = await keysNow(repo, [ONE]);
    expect(hasRecord(repo, key as CheckKey)).toBe(true);

    vitests.opened = 0;
    const second = await gate(repo, ["src/one.ts"]);

    expect(second.ran).toEqual([]);
    expect(second.report.runs.map((r) => [r.runner, r.from])).toEqual([
      ["vitest", { [ONE.path]: "store" }],
    ]);
    expect(vitests.opened).toBe(1);
  });
});
