import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";

/* Spec 018 D14 (row 018-20): `shared.ref`, the project's opt-in to fetching CI's results. */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-shared-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

describe("policy shared.ref (018 D14)", () => {
  it("is null by default: a project that sets none fetches nothing", () => {
    expect(DEFAULT_POLICY.shared).toEqual({ ref: null });
    const { policy, problems } = load({});
    expect(problems).toEqual([]);
    expect(policy.shared.ref).toBeNull();
  });

  it("takes a ref prefix, and null", () => {
    expect(load({ shared: { ref: "refs/squeal" } }).policy.shared.ref).toBe("refs/squeal");
    expect(load({ shared: { ref: "refs/ci/results-v1" } }).policy.shared.ref).toBe(
      "refs/ci/results-v1",
    );
    const off = load({ shared: { ref: null } });
    expect(off.problems).toEqual([]);
    expect(off.policy.shared.ref).toBeNull();
  });

  it.each([
    ["no refs/ prefix", "squeal"],
    ["a branch prefix every clone fetches", "refs/heads/squeal"],
    ["a tag prefix", "refs/tags"],
    ["a remote-tracking prefix", "refs/remotes/origin"],
    ["a trailing slash", "refs/squeal/"],
    ["a wildcard", "refs/squeal/*"],
    ["a dot-dot", "refs/../squeal"],
    ["a component ending in .lock", "refs/squeal.lock"],
    ["a number", 3],
  ])("reports %s as a problem, and the default applies", (_, ref) => {
    const { policy, problems } = load({ shared: { ref } });
    expect(policy.shared.ref).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/shared\.ref.*refs\/squeal.*null/);
  });
});
