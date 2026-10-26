import { describe, expect, it } from "vitest";
import {
  failedKey,
  failuresKey,
  offsKey,
  readCount,
  readKeying,
} from "../../../src/core/lint/pass/records.js";
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
    expect(readKeying(store.meta, tree.id)).toMatchObject({
      seq: 1,
      mode: "first",
      revision: 1,
      transition: 0,
    });

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
    // The edit's transition came before it: a transition after it is judged under its config.
    expect(store.transitions.lastId(tree.id)).toBe(1);
    expect(readKeying(store.meta, tree.id)).toMatchObject({
      seq: 2,
      mode: "config",
      revision: 3,
      transition: 1,
    });

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

  it("counts each failed keying and each time lint goes off, at the source (D9)", async () => {
    const tree = lintTree().write("src/a.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider);
    const step = async (text: string) => {
      tree.write("src/a.js", text);
      tree.revise();
      pass.nudge();
      await pass.idle();
    };
    await step("ok\n");
    const store = storeOf(tree);
    const counts = () => [
      readCount(store.meta, failuresKey(tree.id)),
      readCount(store.meta, offsKey(tree.id)),
    ];
    expect(counts()).toEqual([0, 0]);
    // Each pass whose keying fails is one more, with the same reason each time.
    provider.failInputs = "eslint.config.js does not load: SyntaxError";
    await step("ok\nok\n");
    await step("ok\nok\nok\n");
    expect(counts()).toEqual([2, 0]);
    expect(store.meta.get(failedKey(tree.id))).toBe("eslint.config.js does not load: SyntaxError");
    provider.failInputs = null;
    provider.offOnLint = "the ESLint worker failed 3 times";
    await step("bad no-undef\n");
    expect(counts()).toEqual([2, 1]);
    expect(store.meta.get(failedKey(tree.id))).toBeNull();
    await pass.close();
  });
});
