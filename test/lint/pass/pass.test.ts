import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { FakeProvider, history, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

describe("the lint pass (spec 017 D7)", () => {
  it("keys, looks up, lints and judges every file over two revisions, a hit and a config change", async () => {
    const tree = lintTree()
      .write("src/a.js", "bad no-undef\nok\n")
      .write("src/b.js", "ok\n")
      .write("README.md", "# not linted\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass, reports, errors } = lintPass(tree, provider);

    // Revision 1, the first pass: every file ESLint lints is a miss, linted in one part. Like
    // 015's first count it records no transition: the findings were there before the session.
    pass.nudge();
    await pass.idle();
    const store = storeOf(tree);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pass" });
    expect(provider.calls).toEqual([["src/a.js", "src/b.js"]]);
    expect(provider.refreshes).toEqual(["none"]);
    expect(history(store, tree, "src/a.js")).toEqual([]);

    // Revision 2 fixes `a`: a miss, linted at once with the kept instance.
    tree.write("src/a.js", "ok\nok\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    expect(provider.calls.at(-1)).toEqual(["src/a.js"]);
    // A module file's edit reads the program again before keying (wave 1.5, review 0.1.348 B3).
    expect(provider.refreshes).toEqual(["none", "none"]);
    expect(history(store, tree, "src/a.js")).toEqual(["fail-to-pass -no-undef"]);

    // Revision 3 puts back the bytes of revision 1: a hit, judged with no lint.
    tree.write("src/a.js", "bad no-undef\nok\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toHaveLength(2);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pass" });
    expect(history(store, tree, "src/a.js").at(-1)).toBe("pass-to-fail +no-undef");

    // Revision 4 changes the config: a new instance, every file linted again; the states move
    // and no file records a transition (D2's last row).
    provider.off.add("no-undef");
    tree.write("eslint.config.js", "export default [{ rules: { 'no-undef': 'off' } }];\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(provider.refreshes).toEqual(["none", "none", "none", "instance"]);
    expect(provider.calls.at(-1)).toEqual(["src/a.js", "src/b.js"]);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    expect(history(store, tree, "src/a.js")).toHaveLength(2);
    expect(reports.map((r) => [r.revision, r.mode, r.hits, r.linted])).toEqual([
      [1, "first", 0, 2],
      [2, "edit", 0, 1],
      [3, "edit", 1, 0],
      [4, "config", 0, 2],
    ]);
    expect(errors).toEqual([]);
    await pass.close();
    expect(provider.closed).toBe(1);
  });

  it("with the policy off opens no provider and no lint store (goal 1)", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass, storePath } = lintPass(tree, provider, { policy: () => DEFAULT_POLICY });
    pass.nudge();
    await pass.idle();
    await pass.close();
    expect(provider.opened).toBe(0);
    expect(existsSync(storePath)).toBe(false);
  });
});
