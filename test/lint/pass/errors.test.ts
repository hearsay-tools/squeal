import { describe, expect, it } from "vitest";
import { failedKey, offKey } from "../../../src/core/lint/pass/index.js";
import { FakeProvider, history, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/* Spec 017 D9: what the pass does when the provider cannot give a result. */

/** `a` failing and `b` passing after their first pass. */
async function linted(provider = new FakeProvider()) {
  const tree = lintTree().write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
  tree.revise();
  const rig = lintPass(tree, provider);
  rig.pass.nudge();
  await rig.pass.idle();
  const step = async (edit: () => void) => {
    edit();
    tree.revise();
    rig.pass.nudge();
    await rig.pass.idle();
  };
  return { tree, provider, step, store: storeOf(tree), ...rig };
}

describe("the lint pass's errors (spec 017 D9)", () => {
  it("a config that does not load: the files read unknown with why, until the config loads", async () => {
    const rig = await linted();
    const reason = "eslint.config.js does not load: SyntaxError: Unexpected token";
    rig.provider.failInputs = reason;
    await rig.step(() => rig.tree.write("eslint.config.js", "export default [;\n"));
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "unknown", "src/b.js": "unknown" });
    expect(rig.store.states.list(rig.tree.id).map((s) => s.reason)).toEqual([reason, reason]);
    expect(rig.store.meta.get(failedKey(rig.tree.id))).toBe(reason);

    rig.provider.failInputs = null;
    rig.provider.off.add("no-undef");
    await rig.step(() => rig.tree.write("eslint.config.js", "export default [{}];\n"));
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    expect(rig.store.meta.get(failedKey(rig.tree.id))).toBeNull();
    expect(history(rig.store, rig.tree, "src/a.js")).toEqual([]);
    expect(rig.errors).toEqual([]);
    await rig.pass.close();
  });

  it("a lint that throws or gives no result: unknown with why, judged against the last result after", async () => {
    const rig = await linted();
    rig.provider.failLint = "the ESLint worker exited with code 1";
    await rig.step(() => rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n"));
    const a = () => rig.store.states.list(rig.tree.id, { paths: ["src/a.js"] })[0];
    expect(a()).toMatchObject({
      outcome: "unknown",
      reason: "the ESLint worker exited with code 1",
    });

    rig.provider.failLint = null;
    rig.provider.unknown.set("src/a.js", "timed out");
    await rig.step(() => rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n\n"));
    expect(a()).toMatchObject({ outcome: "unknown", reason: "timed out" });

    rig.provider.unknown.clear();
    await rig.step(() => rig.tree.write("src/a.js", "ok\n"));
    expect(a()).toMatchObject({ outcome: "pass", reason: null });
    expect(history(rig.store, rig.tree, "src/a.js")).toEqual(["fail-to-pass -no-undef"]);
    await rig.pass.close();
  });

  it("a provider off at open lints nothing, says why, and opens again after a config change", async () => {
    const provider = new FakeProvider();
    const on = provider.declaration;
    provider.declaration = { off: "no ESLint installed in <root>" };
    const rig = await linted(provider);
    expect(provider.calls).toEqual([]);
    expect(provider.closed).toBe(1);
    expect(rig.store.meta.get(offKey(rig.tree.id))).toBe("no ESLint installed in <root>");

    provider.declaration = on;
    await rig.step(() => rig.tree.write("src/a.js", "bad no-undef\n\n"));
    expect(provider.opened).toBe(1);
    await rig.step(() => rig.tree.write("package.json", '{"devDependencies":{"eslint":"9"}}\n'));
    expect(provider.opened).toBe(2);
    expect(provider.calls).toEqual([["src/a.js", "src/b.js"]]);
    expect(rig.store.meta.get(offKey(rig.tree.id))).toBeNull();
    await rig.pass.close();
  });

  it("a provider that turns itself off in a lint closes; its files wait until a config change", async () => {
    const rig = await linted();
    const reason = "the ESLint worker failed 3 times; timed out";
    rig.provider.offOnLint = reason;
    await rig.step(() => rig.tree.write("src/a.js", "ok\n"));
    expect(rig.provider.closed).toBe(1);
    expect(rig.store.meta.get(offKey(rig.tree.id))).toBe(reason);
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pending", "src/b.js": "pass" });

    rig.provider.offOnLint = null;
    await rig.step(() => rig.tree.write("eslint.config.js", "export default [{}];\n"));
    expect(rig.provider.opened).toBe(2);
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    await rig.pass.close();
  });

  it("a failing file deleted is resolved once; a lint report's grown closure keys again quietly", async () => {
    const rig = await linted();
    await rig.step(() => rig.tree.remove("src/a.js"));
    expect(history(rig.store, rig.tree, "src/a.js")).toEqual(["removed -no-undef"]);
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/b.js": "pass" });

    rig.provider.lintedClosure = ["eslint.config.js", "rules/late.mjs"];
    await rig.step(() =>
      rig.tree.write("rules/late.mjs", "export {};\n").write("src/b.js", "ok\n\n"),
    );
    expect(rig.reports.map((r) => r.mode)).toEqual(["first", "edit", "edit", "config"]);
    expect(rig.provider.calls.slice(1)).toEqual([["src/b.js"], ["src/b.js"]]);
    await rig.pass.close();
  });
});
