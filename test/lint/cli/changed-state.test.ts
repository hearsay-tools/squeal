import { describe, expect, it } from "vitest";
import { changedOnDisk } from "../../../src/cli/lint-disk.js";
import { formatLintChanged } from "../../../src/cli/lint-report.js";
import { codeSince } from "../../../src/core/delivery/code-since.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { lintChanged } from "../../../src/core/lint/surface/report.js";
import { lintStoreSource } from "../../../src/core/lint/surface/source.js";
import { FakeProvider } from "../pass/helpers.js";
import { deliveryOf, runLint, type WiredRig, wiredRig } from "../wiring/rig.js";

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

const SESSION = { CLAUDE_CODE_SESSION_ID: "s1" };
const STALE = "an input changed since it was linted; linting resumes when the agent is idle";

/** `squeal lint --changed` for session `s1`: its text, and its JSON entries. */
async function listed(rig: WiredRig) {
  const { code, out } = await runLint(rig.repo.main, ["--changed"], SESSION);
  expect(code).toBe(0);
  const json = JSON.parse((await runLint(rig.repo.main, ["--changed", "--json"], SESSION)).out);
  return { out, entries: json.entries };
}

const HEAD = "Lint: 1 file changed since this session started";

describe("squeal lint --changed: the change, then the state now (review 0.1.360 B2)", () => {
  it("case A: a PASS change the config made fail since is not told as passing", async () => {
    const provider = new FakeProvider();
    provider.off.add("no-console");
    const rig = await wiredRig(
      { "src/a.js": "bad no-unused-vars\nbad no-console\n" },
      { alive: false, provider },
    );
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/a.js": "bad no-console\n" });
    // Control: the PASS is the result now.
    expect((await listed(rig)).out).toBe(
      `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now pass: no findings, linted at revision 2\n`,
    );
    // The config turns `no-console` on: `a` fails with no transition.
    provider.off.clear();
    await rig.edit({ "eslint.config.js": CONFIG });
    const { out, entries } = await listed(rig);
    expect(out).toBe(
      `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now fail: 1 finding, linted at revision 3\n`,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "fail-to-pass",
        revision: 2,
        outcome: "fail",
        stale: false,
        findings: 1,
        judgedAt: 3,
      }),
    ]);
  });

  it("case B: a PASS that is stale now says so", async () => {
    const provider = new FakeProvider();
    provider.wholeProgram.add("src/a.js");
    const rig = await wiredRig(
      { "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" },
      { alive: false, provider, idleIn: () => 60_000 },
    );
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/a.js": "ok\n" });
    // `b`'s edit moves the program: `a` keeps its pass, stale, until the agent is idle.
    await rig.edit({ "src/b.js": "ok\nok\n" });
    const { out, entries } = await listed(rig);
    expect(out).toBe(
      `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now pass: no findings, linted at revision 2 (${STALE})\n`,
    );
    expect(entries).toEqual([
      expect.objectContaining({ kind: "fail-to-pass", outcome: "pass", stale: true, judgedAt: 2 }),
    ]);
  });

  it("a FAIL change the config judged again with another rule tells its findings as history", async () => {
    const provider = new FakeProvider();
    provider.off.add("no-unused-vars");
    const rig = await wiredRig({ "src/a.js": "bad no-unused-vars\n" }, { alive: false, provider });
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/a.js": "bad no-unused-vars\nbad no-console\n" });
    const change =
      "  FAIL lint: src/a.js: 1 finding, +1 no-console (no-console found); at revision 2";
    expect((await listed(rig)).out).toBe(
      `${HEAD}\n${change}; now fail: 1 finding, linted at revision 2\n`,
    );
    // The same outcome and count, but `no-console` is off and `no-unused-vars` on.
    provider.off.clear();
    provider.off.add("no-console");
    await rig.edit({ "eslint.config.js": CONFIG });
    expect((await listed(rig)).out).toBe(
      `${HEAD}\n${change}; now fail: 1 finding, linted at revision 3\n`,
    );
    // A FAIL the config made pass, and an edit after the keying, which is its own change again.
    provider.off.add("no-unused-vars");
    await rig.edit({ "eslint.config.js": `${CONFIG}\n` });
    expect((await listed(rig)).out).toBe(
      `${HEAD}\n${change}; now pass: no findings, linted at revision 4\n`,
    );
    await rig.edit({ "src/a.js": "bad no-alert\n" });
    expect((await listed(rig)).out).toBe(
      `${HEAD}\n  FAIL lint: src/a.js: 1 finding, +1 no-alert (no-alert found); at revision 5; now fail: 1 finding, linted at revision 5\n`,
    );
  });

  it("reads an edit between the store read and the disk read as pending, from the result now", async () => {
    const provider = new FakeProvider();
    provider.off.add("no-console");
    const rig = await wiredRig(
      { "src/a.js": "bad no-unused-vars\nbad no-console\n" },
      { alive: false, provider },
    );
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/a.js": "bad no-console\n" });
    provider.off.clear();
    await rig.edit({ "eslint.config.js": CONFIG });
    const read = changedOf(rig);
    // The attack: the agent saves between `squeal lint`'s two reads.
    rig.write("src/a.js", "ok\n");
    const changed = await changedOnDisk(rig.repo.main, { v: 1, since: "session", entries: read });
    expect(changed.entries).toEqual([
      expect.objectContaining({ outcome: "pending", findings: 1, judgedAt: 3, revision: 2 }),
    ]);
    expect(formatLintChanged(changed)).toBe(
      `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now pending: changed on disk since its lint at revision 3\n`,
    );
  });
});
