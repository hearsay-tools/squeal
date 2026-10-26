import { describe, expect, it } from "vitest";
import { readKeying } from "../../../src/core/lint/pass/records.js";
import { FakeProvider, lintPass, lintTree, storeOf } from "../pass/helpers.js";

/*
 * Spec 017 D8: the pass records each keying of every file, so a delivery's
 * config summary has a source even when no state or transition moves.
 */

describe("the lint pass's keying record (017 D8)", () => {
  it("numbers the first keying and each config keying, all-hit ones too, and no edit", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider);
    pass.nudge();
    await pass.idle();
    const store = storeOf(tree);
    expect(readKeying(store.meta, tree.id)).toMatchObject({ seq: 1, mode: "first", revision: 1 });

    tree.write("src/a.js", "ok\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(readKeying(store.meta, tree.id)?.seq).toBe(1);

    // A config change: every file keyed again, quietly.
    provider.off.add("no-undef");
    tree.write("eslint.config.js", "export default [{ rules: { 'no-undef': 'off' } }];\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(readKeying(store.meta, tree.id)).toMatchObject({ seq: 2, mode: "config", revision: 3 });

    // The config put back: every key hits, so nothing lints and no quiet file is left; the
    // record still moves.
    provider.off.delete("no-undef");
    tree.write("eslint.config.js", "export default [];\n");
    tree.revise();
    const calls = provider.calls.length;
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toHaveLength(calls);
    expect(readKeying(store.meta, tree.id)).toMatchObject({ seq: 3, mode: "config", revision: 4 });
  });
});
