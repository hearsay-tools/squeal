import { describe, expect, it, vi } from "vitest";
import { releaseLintGroup } from "../../../src/core/lint/pass/commit-entry.js";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import { lintEntryLine, lintStatusLines } from "../../../src/core/lint/surface/format.js";
import { lintStatus } from "../../../src/core/lint/surface/report.js";
import type { CheckMoment } from "../../../src/core/types/check-groups.js";
import type { Policy } from "../../../src/core/types/policy.js";
import { LINT_ON } from "../helpers.js";
import { consumer, lintRig, ownAfter, sourceOf } from "../surface/helpers.js";
import { FakeProvider, outcomes } from "./helpers.js";

/*
 * Row 019-45 (spec 019 D1 as amended 2026-11-05): a lint group at `pause`
 * or `stop` keys an edit at once, as every lint check, and lints it when
 * the agent pauses (`pauseIn` 0), never before. Its result is the edit's
 * news, told once.
 */

const at = (moment: CheckMoment): Policy => ({
  ...LINT_ON,
  checks: [{ name: "lint", lint: true, at: moment }],
});
const linted = (calls: readonly (readonly string[])[]) =>
  calls.flat().filter((p) => p.endsWith(".js"));

describe("a lint group at pause or stop (019-45)", () => {
  it.each<CheckMoment>(["pause", "stop"])(
    "at %s: an edit lints nothing until the agent pauses, then tells its FAIL line once",
    async (moment) => {
      const policy = at(moment);
      let pauseIn = 0;
      const rig = await lintRig(
        { "src/a.js": "ok\n" },
        { policy: () => policy, pauseIn: () => pauseIn },
      );
      const source = sourceOf(rig.tree, () => policy);
      const me = consumer(rig.tree);
      expect(registerLint(source, me, 2_000)).toEqual({ v: 1, failing: 0, stale: 0 });
      expect(linted(rig.provider.calls), "the first pass, paused, lints").toEqual(["src/a.js"]);
      const since = ownAfter(1);

      // The agent is in a turn: an edit keys `a` and lints nothing; the pass looks again soon.
      pauseIn = 40;
      rig.tree.write("src/a.js", "bad no-undef\n");
      await rig.revise();
      expect(linted(rig.provider.calls)).toEqual(["src/a.js"]);
      expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pending" });
      expect(tellLint(source, me, 2_100, () => since)).toBeNull();
      const status = lintStatus(source, rig.tree.id, null);
      expect(status && lintStatusLines(status, "squeal")).toEqual([
        "Lint: 0 files with findings, 1 waits for the agent to pause; squeal lint lists them.",
      ]);

      // The agent pauses: the pass looks again by itself and lints `a`.
      pauseIn = 0;
      await vi.waitFor(
        () => expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "fail" }),
        { timeout: 5_000, interval: 20 },
      );
      const told = tellLint(source, me, 2_200, () => since);
      expect(told?.entries.map(lintEntryLine)).toEqual([
        "FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)",
      ]);
      expect(
        tellLint(source, me, 2_300, () => since),
        "told once",
      ).toBeNull();
      expect(rig.errors).toEqual([]);
    },
  );

  it("at edit, lints each edit at once whatever the pause (unchanged)", async () => {
    const policy = at("edit");
    const rig = await lintRig(
      { "src/a.js": "ok\n" },
      { policy: () => policy, pauseIn: () => 15_000 },
    );
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    expect(linted(rig.provider.calls)).toEqual(["src/a.js", "src/a.js"]);
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "fail" });
  });
});

/*
 * Review 0.1.406 B1: a changed program file goes to the worker in the next
 * lint call (017 D5's feed). The feed obeys the hold: an edit to a typed
 * file lints nothing before its release, and the released call still feeds
 * every program file changed since, so the worker holds the keys' bytes.
 */
describe("a held lint group's program feed (review 0.1.406 B1)", () => {
  const typed = () => {
    const fake = new FakeProvider();
    fake.program = ["src/a.js", "src/types.d.ts"];
    fake.wholeProgram.add("src/a.js");
    return fake;
  };

  it.each<CheckMoment>(["pause", "stop"])(
    "at %s: an edited program file lints nothing in a turn; the pause lints it with the feed",
    async (moment) => {
      const policy = at(moment);
      let pauseIn = 0;
      const rig = await lintRig(
        { "src/a.js": "ok\n", "src/types.d.ts": "type A = 1;\n" },
        { policy: () => policy, pauseIn: () => pauseIn, fake: typed() },
      );
      expect(rig.provider.calls, "the first pass, paused, lints").toHaveLength(1);

      pauseIn = 60_000;
      rig.tree.write("src/a.js", "bad no-undef\n");
      rig.tree.write("src/types.d.ts", "type A = 2;\n");
      await rig.revise();
      expect(rig.provider.calls.slice(1), "no lint call in the turn").toEqual([]);
      expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pending" });

      pauseIn = 0;
      await rig.settle();
      expect(rig.provider.calls.slice(1), "the release feeds both changed files").toEqual([
        ["src/a.js", "src/types.d.ts"],
      ]);
      expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "fail" });
      expect(rig.errors).toEqual([]);
    },
  );

  it("at commit: an edited program file lints nothing until its release", async () => {
    const policy = at("commit");
    const rig = await lintRig(
      { "src/a.js": "ok\n", "src/types.d.ts": "type A = 1;\n" },
      { policy: () => policy, fake: typed() },
    );
    const blobs = (path: string) => rig.tree.source.file(path)?.hash ?? null;
    releaseLintGroup(rig.tree.commonDir, policy, rig.tree.id, "lint", blobs);
    await rig.settle();
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pass" });
    const before = rig.provider.calls.length;

    rig.tree.write("src/a.js", "bad no-undef\n");
    rig.tree.write("src/types.d.ts", "type A = 2;\n");
    await rig.revise();
    expect(rig.provider.calls.slice(before), "no lint call before a release").toEqual([]);
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "pending" });

    releaseLintGroup(rig.tree.commonDir, policy, rig.tree.id, "lint", blobs);
    await rig.settle();
    expect(rig.provider.calls.slice(before)).toEqual([["src/a.js", "src/types.d.ts"]]);
    expect(outcomes(rig.store, rig.tree)).toEqual({ "src/a.js": "fail" });
    expect(rig.errors).toEqual([]);
  });
});
