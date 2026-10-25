import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readSummary, StepCache, writeSummary } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { COVERED, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-44: a later run at a key a judgement read stores its record over
 * the first. The summary's signature holds each loader's stored record, so
 * the file is judged again from the new one; before, it held only the keys,
 * and the file kept the judgement of the first record.
 */

async function judgedFrom(ran: number[]) {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c1\n" });
  const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
  const store = (lines: number[]) =>
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blob, 2, lines)],
    });
  store(ran);
  return { rig, store };
}

describe("a record stored again at a judged key (row 015-44)", () => {
  it("judges the file again from the new record", async () => {
    const { rig, store } = await judgedFrom([1, 2]);
    expect(rig.step()?.judged).toBe(1);
    expect(rig.states("crap")).toEqual(["cold pass 6", "hot pass 12"]);

    // The same key, a run that hit only `hot`; the store's clock did not move.
    store([1]);
    expect(rig.step()?.judged).toBe(1);
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12"]);
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([
      "crap pass-to-fail cold",
      "uncovered pass-to-fail cold",
    ]);
    expect(rig.step()?.judged).toBe(0);
  });

  it("judges it again through a chain's cache once the record is stored", async () => {
    const { rig, store } = await judgedFrom([1]);
    const cache = new StepCache();
    expect(rig.step({ cache })?.judged).toBe(1);
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -"]);
    cache.settle();

    store([1, 2]);
    // What `CodePass.soon()` does when a record is stored.
    cache.invalidate();
    expect(rig.step({ cache })?.judged).toBe(1);
    expect(rig.states("uncovered")).toEqual(["cold pass -", "hot pass -"]);
  });

  it("judges each file once more after the upgrade, with no transition", async () => {
    const { rig } = await judgedFrom([1]);
    expect(rig.step()?.judged).toBe(1);
    const file = rig.store.files.list(WT, ["src/a.ts"])[0];
    const summary = readSummary(rig.store.meta, WT);
    const judged = summary?.files["src/a.ts"];
    if (file === undefined || summary === null || judged?.state !== "judged") {
      throw new Error("not judged");
    }
    // The signature 0.1.305 wrote: the loaders' keys alone.
    const old = createHash("sha1")
      .update(
        [
          file.blob,
          `counter ${file.counterVersion}`,
          `crap ${COVERED.crap.threshold}`,
          "key-test/a.test.ts",
        ].join("\n"),
      )
      .digest("hex");
    writeSummary(rig.store.meta, WT, {
      ...summary,
      files: { ...summary.files, "src/a.ts": { ...judged, signature: old } },
    });
    const states = rig.states("crap");
    expect(rig.step()?.judged).toBe(1);
    expect(rig.states("crap")).toEqual(states);
    expect(rig.transitions("src/a.ts", ["cold", "hot"])).toEqual([]);
    expect(rig.step()?.judged).toBe(0);
  });
});
