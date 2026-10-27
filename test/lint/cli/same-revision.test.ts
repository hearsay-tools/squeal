import { describe, expect, it } from "vitest";
import { HEAD, sameRevisionRig } from "./same-revision-rig.js";

describe.each([9, 10] as const)(
  "ESLint %i: current state within one revision (017-10.R2)",
  (major) => {
    it.each(["pass", "fail"] as const)(
      "keeps %s history apart from the current result in text and JSON",
      async (history) => {
        const { rig, change } = await sameRevisionRig(major, history);
        expect(await rig.changed()).toBe(
          `${HEAD}\n${change}; now fail: 1 finding, linted at revision 2\n`,
        );
        const json = await rig.changedJson();
        expect(json.entries).toEqual([
          expect.objectContaining({
            kind: history === "pass" ? "fail-to-pass" : "pass-to-fail",
            revision: 2,
            judgedAt: 2,
            outcome: "fail",
            stale: false,
            findings: 1,
          }),
        ]);
      },
      60_000,
    );

    it.each(["refresh", "inputs", "lint"])(
      "does not pair old findings with new bytes after %s",
      async (call) => {
        const { rig, change } = await sameRevisionRig(major, "pass", call);
        expect(await rig.changed()).toBe(
          `${HEAD}\n${change}; now fail: 1 finding, linted at revision 2\n`,
        );
        expect((await rig.changedJson()).entries).toEqual([
          expect.objectContaining({
            kind: "fail-to-pass",
            revision: 2,
            judgedAt: 2,
            outcome: "fail",
            stale: false,
            findings: 1,
          }),
        ]);
      },
      60_000,
    );
  },
);
