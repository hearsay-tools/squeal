import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import type { SetupPlan } from "../../../src/cli/setup/plan.js";
import { capture, cleanupFixtures, json, squealShaped } from "./fixture.js";

/*
 * Spec 004 D7 as amended 2026-10-18 (task 004-81): `squeal setup --plan` and
 * `--check` name the `vitest.exclude` globs as suites Squeal does not cover,
 * a fact, never a finding.
 */

afterEach(cleanupFixtures);

async function check(root: string, asJson: boolean) {
  const { io, out } = capture(root);
  const code = await main(["setup", "--check", ...(asJson ? ["--json"] : [])], io);
  return { code, stdout: out.stdout };
}

describe("squeal setup names the excluded Vitest test files", () => {
  it("lists each vitest.exclude glob as not covered, and counts nothing outdated", async () => {
    const root = squealShaped({
      "squeal.config.json": json({ vitest: { exclude: ["test/e2e/**", "bench/**"] } }),
    });
    const plan = JSON.parse((await check(root, true)).stdout) as SetupPlan;
    expect(plan.excluded).toEqual({ vitest: ["test/e2e/**", "bench/**"] });
    const { stdout } = await check(root, false);
    expect(stdout).toContain(
      'Not covered, excluded by squeal.config.json:\n  Vitest test files matching "test/e2e/**"\n  Vitest test files matching "bench/**"\n',
    );
    expect(stdout).not.toContain("problem:");
    expect(plan.outdated.join("\n")).not.toContain("exclude");
  });

  it("has no section without the key", async () => {
    const root = squealShaped();
    expect((await check(root, false)).stdout).not.toContain("Not covered");
  });
});
