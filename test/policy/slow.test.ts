import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

/*
 * Spec 004 D1 and D7 (one `slow` object, status.md 2026-10-08): `slow.include`
 * (default `[]`), `slow.maxWorkers` (2), `slow.maxLoadPerCpu` (1.0),
 * `slow.maxDeferMs` (600000), `slow.maxParallel` (4, D2 as amended
 * 2026-10-09), `nodeTest[].slow` (`false`) and `stop.requireSlowSuite`
 * (`false`), all under the 001 D11 loader rules.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-slow-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

const FULL = {
  include: ["test/e2e/**/*.test.ts", "test/package/*.test.ts"],
  maxWorkers: 1,
  maxLoadPerCpu: 0.5,
  maxDeferMs: 0,
  maxParallel: 2,
};

describe("policy slow (spec 004 D7)", () => {
  it("defaults to no slow files, two workers, load 1.0 per CPU, ten minutes and four at once", () => {
    expect(DEFAULT_POLICY.slow).toEqual({
      include: [],
      maxWorkers: 2,
      maxLoadPerCpu: 1,
      maxDeferMs: 600_000,
      maxParallel: 4,
    });
    expect(DEFAULT_POLICY.stop.requireSlowSuite).toBe(false);
  });

  it("accepts the full object as given", () => {
    const { policy, problems } = load({ slow: FULL, stop: { requireSlowSuite: true } });
    expect(problems).toEqual([]);
    expect(policy.slow).toEqual(FULL);
    expect(policy.stop).toEqual({ ...DEFAULT_POLICY.stop, requireSlowSuite: true });
  });

  it.each(Object.keys(FULL))("applies the default for an absent %s", (key) => {
    const given: Record<string, unknown> = { ...FULL };
    delete given[key];
    const { policy, problems } = load({ slow: given });
    expect(problems).toEqual([]);
    expect(policy.slow).toEqual({
      ...FULL,
      [key]: DEFAULT_POLICY.slow[key as keyof typeof FULL],
    });
  });

  it.each([
    [
      "include",
      "test/e2e/*.test.ts",
      `"slow.include" must be an array of strings, got "test/e2e/*.test.ts"`,
    ],
    [
      "include",
      ["a.test.ts", 3],
      `"slow.include" must be an array of strings, got ["a.test.ts",3]`,
    ],
    ["maxWorkers", 0, `"slow.maxWorkers" must be a positive integer, got 0`],
    ["maxWorkers", 1.5, `"slow.maxWorkers" must be a positive integer, got 1.5`],
    ["maxLoadPerCpu", 0, `"slow.maxLoadPerCpu" must be a number > 0, got 0`],
    ["maxLoadPerCpu", "1", `"slow.maxLoadPerCpu" must be a number > 0, got "1"`],
    ["maxDeferMs", -1, `"slow.maxDeferMs" must be a number >= 0, got -1`],
    ["maxDeferMs", null, `"slow.maxDeferMs" must be a number >= 0, got null`],
    ["maxParallel", 0, `"slow.maxParallel" must be a positive integer, got 0`],
    ["maxParallel", 2.5, `"slow.maxParallel" must be a positive integer, got 2.5`],
  ])("rejects slow.%s = %j with one problem and its default", (key, value, problem) => {
    const { policy, problems } = load({ slow: { ...FULL, [key]: value } });
    expect(problems).toEqual([problem]);
    expect(policy.slow).toEqual({
      ...FULL,
      [key]: DEFAULT_POLICY.slow[key as keyof typeof FULL],
    });
  });

  it("drops an include glob that does not compile with one problem and keeps the others", () => {
    const { policy, problems } = load({
      slow: { include: ["test/e2e/*.test.ts", "!test/unit/**", "test/[x.test.ts"] },
    });
    expect(policy.slow.include).toEqual(["test/e2e/*.test.ts"]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(
      /^"slow\.include\[1\]" has a glob Squeal cannot use: .+; it is left out$/,
    );
    expect(problems[1]).toMatch(/^"slow\.include\[2\]" has a glob Squeal cannot use: /);
  });

  it("reports an unknown key under slow and keeps the known ones", () => {
    const { policy, problems } = load({ slow: { ...FULL, maxWorker: 4 } });
    expect(problems).toEqual([`unknown key "slow.maxWorker"`]);
    expect(policy.slow).toEqual(FULL);
  });

  it("is the defaults with one problem when slow is not an object", () => {
    const { policy, problems } = load({ slow: ["test/e2e/*.test.ts"] });
    expect(problems).toEqual([`"slow" must be an object, got ["test/e2e/*.test.ts"]`]);
    expect(policy.slow).toEqual(DEFAULT_POLICY.slow);
  });

  it("rejects stop.requireSlowSuite that is not a boolean with one problem and its default", () => {
    const { policy, problems } = load({ stop: { requireSlowSuite: "yes" } });
    expect(problems).toEqual([`"stop.requireSlowSuite" must be true or false, got "yes"`]);
    expect(policy.stop.requireSlowSuite).toBe(false);
  });
});

describe("policy nodeTest[].slow (spec 004 D1)", () => {
  const E2E = { name: "test:package", include: ["test/e2e/*.test.ts"] };

  it("keeps slow: true and leaves it absent when not given", () => {
    const { policy, problems } = load({
      nodeTest: [
        { ...E2E, slow: true },
        { ...E2E, name: "u" },
      ],
    });
    expect(problems).toEqual([]);
    expect(policy.nodeTest).toEqual([
      { ...E2E, slow: true, argv: [], env: {} },
      { ...E2E, name: "u", argv: [], env: {} },
    ]);
  });

  it("skips an entry whose slow is not a boolean with one problem", () => {
    const { policy, problems } = load({ nodeTest: [{ ...E2E, slow: "yes" }] });
    expect(policy.nodeTest).toEqual([]);
    expect(problems).toEqual([
      `"nodeTest[0].slow" must be true or false, got "yes"; project "test:package" is skipped`,
    ]);
  });
});
