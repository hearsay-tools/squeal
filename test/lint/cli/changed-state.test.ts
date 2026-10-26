import { describe, expect, it } from "vitest";
import { codeSince } from "../../../src/core/delivery/code-since.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { lintChanged } from "../../../src/core/lint/surface/report.js";
import { lintStoreSource } from "../../../src/core/lint/surface/source.js";
import { FakeProvider } from "../pass/helpers.js";
import { deliveryOf, type WiredRig, wiredRig } from "../wiring/rig.js";

/*
 * Review 0.1.360 B2: `squeal lint --changed` lists each file's last change,
 * which is history, and the file's state now, which can be another result:
 * a config change judges files again with no transition (D2), and a stale
 * result is not current (D5). The two are told apart.
 */

const CONFIG = "export default [{ rules: {} }];\n";

/** The store's `--changed` answer for session `s1`, with no disk check. */
function changedOf(rig: WiredRig) {
  const source = lintStoreSource(rig.repo.commonDir, rig.repo.main);
  const id = worktreeIdFor(rig.repo.main);
  const since = codeSince(rig.store, id, { session: "s1", agent: null });
  return lintChanged(source, id, since)?.entries ?? expect.unreachable();
}

describe("the revision a changed file's result now is from (017 D8)", () => {
  it("is the change's own until a config change judges the file again", async () => {
    const provider = new FakeProvider();
    provider.off.add("no-unused-vars");
    const rig = await wiredRig({ "src/a.js": "bad no-unused-vars\n" }, { alive: false, provider });
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/a.js": "bad no-unused-vars\nbad no-console\n" });
    expect(changedOf(rig)).toEqual([
      expect.objectContaining({ kind: "pass-to-fail", revision: 2, judgedAt: 2, findings: 1 }),
    ]);
    // The config turns `no-console` off and `no-unused-vars` on: one finding still, another rule.
    provider.off.clear();
    provider.off.add("no-console");
    await rig.edit({ "eslint.config.js": CONFIG });
    expect(changedOf(rig)).toEqual([
      expect.objectContaining({ kind: "pass-to-fail", revision: 2, judgedAt: 3, findings: 1 }),
    ]);
  });
});
