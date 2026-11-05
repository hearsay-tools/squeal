import { describe, expect, it, vi } from "vitest";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import { lintEntryLine, lintStatusLines } from "../../../src/core/lint/surface/format.js";
import { lintStatus } from "../../../src/core/lint/surface/report.js";
import type { CheckMoment, Policy } from "../../../src/core/types/index.js";
import { LINT_ON } from "../helpers.js";
import { consumer, lintRig, ownAfter, sourceOf } from "../surface/helpers.js";
import { outcomes } from "./helpers.js";

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
