import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";

/*
 * Spec 004 D7 as amended 2026-10-18 (task 004-81): `vitest.exclude`, the
 * Vitest test-file globs Squeal never lists, runs, keys or counts. Every
 * glob compiles when the file is read, as `nodeTest[].exclude`'s do.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-vitest-exclude-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

describe("policy vitest.exclude (004 D7, task 004-81)", () => {
  it("excludes nothing by default", () => {
    expect(load({}).policy.vitest.exclude).toEqual([]);
  });

  it("keeps a list of globs as written", () => {
    const { policy, problems } = load({ vitest: { exclude: ["test/e2e/**"] } });
    expect(problems).toEqual([]);
    expect(policy.vitest.exclude).toEqual(["test/e2e/**"]);
  });

  it("reports a value that is not a list of strings and excludes nothing", () => {
    const { policy, problems } = load({ vitest: { exclude: "test/e2e/**" } });
    expect(problems).toEqual([`"vitest.exclude" must be an array of strings, got "test/e2e/**"`]);
    expect(policy.vitest.exclude).toEqual([]);
  });

  it("reports a glob Squeal cannot use and excludes nothing", () => {
    const { policy, problems } = load({ vitest: { exclude: ["test/[e2e/**"] } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^"vitest\.exclude" has a glob Squeal cannot use/);
    expect(policy.vitest.exclude).toEqual([]);
  });
});
