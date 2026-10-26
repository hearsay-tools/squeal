import { describe, expect, it } from "vitest";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import { LINT_LISTED_MAX } from "../../../src/core/types/lint-delivery.js";
import { FakeProvider } from "../pass/helpers.js";
import { consumer, lintRig, ownAfter, said } from "./helpers.js";

/* Spec 017 D2, D8: what a consumer is told of each file, and what it is never told. */

const mine = () => ownAfter(1);

describe("lint news by file (017 D8)", () => {
  it("tells each consumer apart: one's acknowledgement leaves another's news", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n" });
    const one = consumer(rig.tree, "s1");
    const two = consumer(rig.tree, "s2", "agent-2");
    registerLint(rig.source, one, 5_000);
    registerLint(rig.source, two, 5_000);
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    expect(tellLint(rig.source, one, 5_100, mine)?.entries.map(said)).toEqual([
      "pass-to-fail src/a.js +no-undef",
    ]);
    expect(tellLint(rig.source, one, 5_101, mine)).toBeNull();
    expect(tellLint(rig.source, two, 5_102, mine)?.entries.map(said)).toEqual([
      "pass-to-fail src/a.js +no-undef",
    ]);
    expect(tellLint(rig.source, two, 5_103, mine)).toBeNull();
  });

  it("lists 5 changes and counts the rest, which are then told by count", async () => {
    const files = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`src/f${n}.js`, "ok\n"]));
    const rig = await lintRig(files);
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    for (const path of Object.keys(files)) rig.tree.write(path, "bad no-undef\n");
    await rig.revise();
    const news = tellLint(rig.source, me, 5_100, mine);
    expect(news?.entries.map((e) => e.path)).toEqual(
      ["f1", "f2", "f3", "f4", "f5"].map((f) => `src/${f}.js`),
    );
    expect(news?.entries).toHaveLength(LINT_LISTED_MAX);
    expect(news?.more).toBe(2);
    expect(tellLint(rig.source, me, 5_101, mine)).toBeNull();
    // A file told by count only is still told when it changes again.
    rig.tree.write("src/f7.js", "ok\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_200, mine)?.entries.map(said)).toEqual([
      "fail-to-pass src/f7.js -no-undef",
    ]);
  });

  it("tells a failing file deleted as resolved, once; a passing one deleted, never", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    rig.tree.remove("src/a.js").remove("src/b.js");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_100, mine)).toEqual({
      v: 1,
      entries: [
        expect.objectContaining({ path: "src/a.js", kind: "removed", findings: 0, revision: 2 }),
      ],
      more: 0,
    });
    expect(tellLint(rig.source, me, 5_101, mine)).toBeNull();
  });

  it("tells several edits since the last delivery as one change from what the consumer was told", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    rig.tree.write("src/a.js", "bad no-console\n");
    await rig.revise();
    // The consumer never heard of `no-undef`: one FAIL with what is there now.
    expect(tellLint(rig.source, me, 5_100, mine)?.entries.map(said)).toEqual([
      "pass-to-fail src/a.js +no-console",
    ]);
  });

  it("takes in by count a change outside the consumer's own revisions", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    // Revision 2 is in the tree at the registration (a start scan's, `codeSeenUpTo`).
    const since = () => ownAfter(2);
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_100, since)).toBeNull();
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_200, since)?.entries.map(said)).toEqual([
      "fail-changed src/a.js +no-console",
    ]);
  });

  it("tells nothing of an unknown file and keeps its change until it is judged, never as a PASS before", async () => {
    const provider = new FakeProvider();
    const rig = await lintRig({ "src/a.js": "bad no-undef\n" }, { fake: provider });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    rig.tree.write("src/a.js", "ok\n");
    await rig.revise();
    // Before a delivery, the next edit cannot be linted: `a` reads unknown, its fix kept.
    provider.unknown.set("src/a.js", "the ESLint worker timed out");
    rig.tree.write("src/a.js", "ok\nok\n");
    await rig.revise();
    expect(rig.store.states.list(rig.tree.id)[0]).toMatchObject({
      outcome: "unknown",
      reason: "the ESLint worker timed out",
    });
    expect(tellLint(rig.source, me, 5_100, mine)).toBeNull();
    // Linted again with the same result: no transition, and the fix is told now.
    provider.unknown.clear();
    rig.tree.write("src/a.js", "ok\nok\nok\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_200, mine)?.entries.map(said)).toEqual([
      "fail-to-pass src/a.js -no-undef",
    ]);
    expect(tellLint(rig.source, me, 5_201, mine)).toBeNull();
  });

  it("tells a stale FAIL as stale, and a stale PASS only once it is linted at its key", async () => {
    const provider = new FakeProvider();
    provider.wholeProgram.add("src/a.js").add("src/c.js");
    const clock = { idle: false };
    const rig = await lintRig(
      { "src/a.js": "bad import/no-unresolved\n", "src/b.js": "ok\n", "src/c.js": "ok\n" },
      { fake: provider, idleIn: () => (clock.idle ? 0 : 60_000) },
    );
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    rig.tree.write("src/a.js", "ok\n").write("src/c.js", "bad import/named\n");
    await rig.revise();
    // `b`'s edit moves the program: `a` (now passing) and `c` (now failing) read stale.
    rig.tree.write("src/b.js", "ok\nok\n");
    await rig.revise();
    const states = rig.store.states
      .list(rig.tree.id)
      .map((s) => [s.check.path, s.outcome, s.stale]);
    expect(states).toEqual([
      ["src/a.js", "pass", true],
      ["src/b.js", "pass", false],
      ["src/c.js", "fail", true],
    ]);
    const news = tellLint(rig.source, me, 5_100, mine);
    expect(news?.entries.map(said)).toEqual(["pass-to-fail src/c.js +import/named"]);
    expect(news?.entries[0]?.stale).toBe(true);
    expect(tellLint(rig.source, me, 5_101, mine)).toBeNull();
    // Idle: both lint at their keys, with the same results; `a`'s PASS is told now.
    clock.idle = true;
    await rig.settle();
    expect(tellLint(rig.source, me, 5_200, mine)?.entries.map(said)).toEqual([
      "fail-to-pass src/a.js -import/no-unresolved",
    ]);
    expect(tellLint(rig.source, me, 5_201, mine)).toBeNull();
  });

  it("tells why keying fails once per failed pass, and why lint is off once", async () => {
    const provider = new FakeProvider();
    const rig = await lintRig({ "src/a.js": "ok\n" }, { fake: provider });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    provider.failInputs = "eslint.config.js does not load: SyntaxError: Unexpected token";
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    const failed = "eslint.config.js does not load: SyntaxError: Unexpected token";
    expect(tellLint(rig.source, me, 5_100, mine)).toEqual({ v: 1, entries: [], more: 0, failed });
    expect(tellLint(rig.source, me, 5_101, mine)).toBeNull();
    // D9: one line per pass while it lasts, though its wording is the same.
    rig.tree.write("src/a.js", "bad no-undef\nok\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_102, mine)?.failed).toBe(failed);
    expect(tellLint(rig.source, me, 5_103, mine)).toBeNull();
    expect(registerLint(rig.source, consumer(rig.tree, "s2"), 5_102)).toMatchObject({ failed });

    provider.failInputs = null;
    provider.offOnLint = "the ESLint worker failed 3 times; it exited";
    rig.tree.write("src/a.js", "bad no-console\n");
    await rig.revise();
    const off = "the ESLint worker failed 3 times; it exited";
    expect(tellLint(rig.source, me, 5_200, mine)).toEqual({ v: 1, entries: [], more: 0, off });
    expect(tellLint(rig.source, me, 5_201, mine)).toBeNull();
    expect(registerLint(rig.source, consumer(rig.tree, "s3"), 5_202)).toMatchObject({ off });
  });
});
