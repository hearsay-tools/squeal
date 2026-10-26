import { describe, expect, it, vi } from "vitest";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import { FakeProvider, lintPass, lintTree } from "../pass/helpers.js";
import { consumer, lintRig, ownAfter, said, sourceOf } from "./helpers.js";

/*
 * Spec 017 D8: a config, plugin or ESLint change is one summary line once
 * the pass that follows ends, and the consumer's view is seeded again by
 * count; the first lint of every file ends the same way.
 */

const NEW_CONFIG = "export default [{ rules: { 'no-undef': 'off' } }];\n";

describe("the lint summary (017 D8)", () => {
  it("tells a config change once, when its files are linted, re-seeds by count, then tells edits", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n", "src/b.js": "bad no-console\n" });
    const me = consumer(rig.tree);
    const since = () => ownAfter(1);
    expect(registerLint(rig.source, me, 5_000)).toEqual({ v: 1, failing: 2, stale: 0 });

    // The config turns `no-undef` off: `a` passes, with no transition (D2's last row).
    let release = () => {};
    rig.provider.gate = new Promise((resolve) => {
      release = resolve;
    });
    rig.provider.off.add("no-undef");
    rig.tree.write("eslint.config.js", NEW_CONFIG);
    rig.tree.revise();
    const calls = rig.provider.calls.length;
    rig.pass.nudge();
    await vi.waitFor(() => expect(rig.provider.calls.length).toBe(calls + 1));
    // While its files lint, no summary yet; a consumer that registers now hears the progress.
    expect(tellLint(rig.source, me, 5_100, since)).toBeNull();
    const late = consumer(rig.tree, "s2");
    expect(registerLint(rig.source, late, 5_100)).toEqual({
      v: 1,
      failing: 0,
      stale: 0,
      linting: { done: 0, total: 2 },
    });
    release();
    rig.provider.gate = null;
    await rig.pass.idle();

    const summary = { reason: "config", revision: 2, failing: 1, stale: 0 };
    expect(tellLint(rig.source, me, 5_200, since)).toEqual({ v: 1, entries: [], more: 0, summary });
    expect(tellLint(rig.source, late, 5_200, since)).toEqual({
      v: 1,
      entries: [],
      more: 0,
      summary,
    });
    expect(tellLint(rig.source, me, 5_300, since)).toBeNull();

    // Re-seeded: `a` passes in the view, so the session's edit to it is a PASS -> FAIL.
    rig.tree.write("src/a.js", "bad no-alert\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_400, since)?.entries.map(said)).toEqual([
      "pass-to-fail src/a.js +no-alert",
    ]);
  });

  it("tells a config change whose keys all hit, though no file lints", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n" });
    const me = consumer(rig.tree);
    rig.provider.off.add("no-undef");
    rig.tree.write("eslint.config.js", NEW_CONFIG);
    await rig.revise();
    registerLint(rig.source, me, 5_000);
    // The config put back: every key hits the first pass's results.
    rig.provider.off.delete("no-undef");
    rig.tree.write("eslint.config.js", "export default [];\n");
    const calls = rig.provider.calls.length;
    await rig.revise();
    expect(rig.provider.calls).toHaveLength(calls);
    expect(tellLint(rig.source, me, 5_100, () => ownAfter(2))?.summary).toEqual({
      reason: "config",
      revision: 3,
      failing: 1,
      stale: 0,
    });
  });

  it("tells the first lint's end to a consumer that registered before it, or before the store", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
    tree.revise();
    const source = sourceOf(tree);
    const early = consumer(tree, "early");
    // No daemon has made the store: the registration says lint has not started.
    expect(registerLint(source, early, 5_000)).toEqual({
      v: 1,
      failing: 0,
      stale: 0,
      linting: { done: 0, total: 0 },
    });
    expect(tellLint(source, early, 5_001, () => ownAfter(0))).toBeNull();

    const provider = new FakeProvider();
    let release = () => {};
    provider.gate = new Promise((resolve) => {
      release = resolve;
    });
    const { pass } = lintPass(tree, provider);
    pass.nudge();
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    const during = consumer(tree, "during");
    expect(registerLint(source, during, 5_100)?.linting).toEqual({ done: 0, total: 2 });
    expect(tellLint(source, early, 5_101, () => ownAfter(0))).toBeNull();
    release();
    await pass.idle();

    const summary = { reason: "first", revision: 1, failing: 1, stale: 0 };
    expect(tellLint(source, early, 5_200, () => ownAfter(0))?.summary).toEqual(summary);
    expect(tellLint(source, during, 5_200, () => ownAfter(1))?.summary).toEqual(summary);
    // One that registers after it hears the count at registration, and no summary.
    const later = consumer(tree, "later");
    expect(registerLint(source, later, 5_300)).toEqual({ v: 1, failing: 1, stale: 0 });
    expect(tellLint(source, later, 5_301, () => ownAfter(1))).toBeNull();
    expect(tellLint(source, early, 5_301, () => ownAfter(0))).toBeNull();
    await pass.close();
  });
});
