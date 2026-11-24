import { describe, expect, it } from "vitest";
import { releaseLintGroup } from "../../../src/core/lint/pass/commit-entry.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { Policy } from "../../../src/core/types/policy.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/*
 * Review 0.1.616 B4 (spec 026 D4.3, repair 026-r3): `squeal run <lint
 * group> --base <ref>` releases only the changed paths' waiting checks.
 * A changed path with no lint check is left out, and a waiting check of
 * a path that did not change neither lints for the request nor counts.
 */

const MANUAL: Policy = { ...LINT_ON, checks: [{ name: "lint", lint: true, at: "manual" }] };
const linted = (provider: FakeProvider) => provider.calls.flat().filter((p) => p.endsWith(".js"));

describe("a lint group's release of the changed paths only (review 0.1.616 B4)", () => {
  it("lints and counts a changed path's check; leaves a nonmatching path and an unrelated one", async () => {
    const tree = lintTree()
      .write("src/changed.js", "ok\n")
      .write("src/unrelated.js", "bad no-undef\n")
      .write("README.md", "text\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass, errors } = lintPass(tree, provider, { policy: () => MANUAL });
    pass.nudge();
    await pass.idle();
    expect(linted(provider), "a manual group lints nothing before a request").toEqual([]);

    const blobs = (path: string) => tree.source.file(path)?.hash ?? null;
    const paths = ["README.md", "src/changed.js"] as RelativePath[];
    expect(releaseLintGroup(tree.commonDir, MANUAL, tree.id, "lint", blobs, paths)).toBe(1);
    pass.nudge();
    await pass.idle();
    expect(linted(provider)).toEqual(["src/changed.js"]);
    expect(outcomes(storeOf(tree), tree)).toMatchObject({
      "src/changed.js": "pass",
      "src/unrelated.js": "pending",
    });
    expect(errors).toEqual([]);
    await pass.close();
  });

  it("without paths, releases every waiting check of the group as before", async () => {
    const tree = lintTree().write("src/a.js", "ok\n").write("src/b.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider, { policy: () => MANUAL });
    pass.nudge();
    await pass.idle();
    const blobs = (path: string) => tree.source.file(path)?.hash ?? null;
    expect(releaseLintGroup(tree.commonDir, MANUAL, tree.id, "lint", blobs)).toBe(2);
    await pass.close();
  });
});
