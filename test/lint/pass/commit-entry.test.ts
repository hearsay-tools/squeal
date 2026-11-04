import { describe, expect, it } from "vitest";
import {
  heldForCommit,
  readReleased,
  release,
  releaseLintGroup,
} from "../../../src/core/lint/pass/commit-entry.js";
import { lintScope } from "../../../src/core/lint/pass/records.js";
import type { CheckGroup, Policy } from "../../../src/core/types/index.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/*
 * Row 019-22 (spec 019 D5 step 1, D6): a lint group at `commit`. Its
 * checks are keyed at each edit but lint only once a commit or `squeal run
 * <group>` released their path, at the blob it was released at.
 */

const AT_COMMIT: CheckGroup = { name: "lint", lint: true, at: "commit" };
const HELD: Policy = { ...LINT_ON, checks: [AT_COMMIT] };
const linted = (provider: FakeProvider) => provider.calls.flat().filter((p) => p.endsWith(".js"));

describe("a lint group at commit (019-22)", () => {
  it("owns its tools by the first lint group that selects them", () => {
    expect(heldForCommit(HELD, "eslint")).toBe(true);
    expect(heldForCommit(LINT_ON, "eslint")).toBe(false);
    const named: Policy = {
      ...LINT_ON,
      checks: [{ name: "ox", lint: ["oxlint"], at: "edit" }, AT_COMMIT],
    };
    expect([heldForCommit(named, "oxlint"), heldForCommit(named, "eslint")]).toEqual([false, true]);
  });

  it("keys an edit and lints nothing until a release, then only the released path at its blob", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass, errors } = lintPass(tree, provider, { policy: () => HELD });
    pass.nudge();
    await pass.idle();
    const store = storeOf(tree);
    expect(linted(provider), "never before a commit").toEqual([]);
    expect(outcomes(store, tree)).toMatchObject({ "src/a.js": "pending", "src/b.js": "pending" });

    const scope = lintScope(tree.id, "eslint");
    const blob = (path: string) => tree.source.file(path)?.hash ?? "";
    release(store.meta, scope, new Map([["src/a.js", blob("src/a.js")]]));
    // A release at a blob the file no longer has lints nothing.
    release(store.meta, scope, new Map([["src/b.js", "0".repeat(40)]]));
    pass.nudge();
    await pass.idle();
    expect(linted(provider)).toEqual(["src/a.js"]);
    expect(outcomes(store, tree)).toMatchObject({ "src/a.js": "fail", "src/b.js": "pending" });

    // An edit after the release waits for the next one.
    tree.write("src/a.js", "bad semi\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(linted(provider)).toEqual(["src/a.js"]);
    expect(outcomes(store, tree)).toMatchObject({ "src/a.js": "pending" });
    expect(readReleased(store.meta, scope), "the next pass drops a spent release").toEqual(
      new Map(),
    );

    // `squeal run lint`: every waiting check, at its blob now.
    const blobs = (path: string) => tree.source.file(path)?.hash ?? null;
    expect(releaseLintGroup(tree.commonDir, HELD, tree.id, "lint", blobs)).toBe(2);
    pass.nudge();
    await pass.idle();
    expect(linted(provider).sort()).toEqual(["src/a.js", "src/a.js", "src/b.js"]);
    expect(outcomes(store, tree)).toMatchObject({ "src/a.js": "fail", "src/b.js": "pass" });
    expect(errors).toEqual([]);
    await pass.close();
  });

  it("without a lint group at commit, lints at each edit as before", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider);
    pass.nudge();
    await pass.idle();
    expect(linted(provider)).toEqual(["src/a.js"]);
    expect(releaseLintGroup(tree.commonDir, LINT_ON, tree.id, "lint", () => null)).toBe(0);
    await pass.close();
  });
});
