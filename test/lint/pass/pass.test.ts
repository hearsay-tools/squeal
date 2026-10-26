import { describe, expect, it } from "vitest";
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

    // Revision 1, the first pass: every included file is a miss, linted in one part.
    pass.nudge();
    await pass.idle();
    const store = storeOf(tree);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pass" });
    expect(provider.linted()).toEqual([["src/a.js", "src/b.js"]]);
    expect(history(store, tree, "src/a.js")).toEqual(["first-seen-fail +no-undef"]);
    expect(history(store, tree, "src/b.js")).toEqual([]);

    // Revision 2 fixes `a`: a miss, linted at once with the kept instance.
    tree.write("src/a.js", "ok\nok\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    expect(provider.calls.at(-1)).toEqual({ paths: ["src/a.js"], refresh: "none" });
    expect(history(store, tree, "src/a.js")).toEqual([
      "first-seen-fail +no-undef",
      "fail-to-pass -no-undef",
    ]);

    // Revision 3 puts back the bytes of revision 1: a hit, judged with no lint.
    tree.write("src/a.js", "bad no-undef\nok\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toHaveLength(2);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pass" });
    expect(history(store, tree, "src/a.js").at(-1)).toBe("pass-to-fail +no-undef");

    // Revision 4 changes the config: every file is linted again on a new instance; the
    // states move and no file records a transition (D2's last row).
    provider.off.add("no-undef");
    tree.write("eslint.config.js", "export default [{ rules: { 'no-undef': 'off' } }];\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(provider.calls.at(-1)).toEqual({ paths: ["src/a.js", "src/b.js"], refresh: "instance" });
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    expect(history(store, tree, "src/a.js")).toHaveLength(3);
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
});
