import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type Calibration,
  coverageGaps,
  declarations,
  JUDGED,
  rubricRevision,
  transcriptHash,
} from "../../evals/lib/index.mjs";
import { calibrationReferences } from "./judge-references.js";

// Spec 006 D9's calibration gate, tied to its references (006-30): a calibration identity is the
// model, effort, Claude Code version and rubric, never the reference set, so a committed passing
// file counts only while it covers exactly the references the judge is calibrated on now.

const declared = declarations();
const refs = calibrationReferences(JUDGED, declared);
const RESULTS = fileURLToPath(new URL("../../evals/results/", import.meta.url));

/** The calibration record `refs` would make, before any model answers. */
const recordOf = (rs: typeof refs): Pick<Calibration, "references"> => ({
  references: rs.map((r) => ({
    name: r.name,
    task: r.task,
    harness: r.harness,
    transcriptHash: transcriptHash(r.task, r.cell.transcript as string[]),
    expected: r.expected,
    parser: null,
    pass: true,
    runs: [],
  })),
});

describe("a calibration's coverage", () => {
  it("is complete for the record of the same references", () => {
    expect(coverageGaps(recordOf(refs), refs)).toEqual([]);
  });

  it("names a missing reference, an extra one, a changed transcript and changed grades", () => {
    const [first, second, third, ...rest] = refs;
    if (!first || !second || !third) throw new Error("too few references");
    const held = recordOf([second, third, ...rest]);
    const [h2, h3] = held.references;
    if (!h2 || !h3) throw new Error("too few records");
    h2.transcriptHash = "0000000000000000";
    h3.expected = Object.fromEntries(Object.keys(h3.expected).map((id) => [id, "n/a"]));
    held.references.push({ ...h2, name: "codex t9: gone" });
    expect(coverageGaps(held, refs)).toEqual([
      `missing: ${first.name}`,
      "not a reference: codex t9: gone",
      `changed transcript or expected grades: ${second.name}`,
      `changed transcript or expected grades: ${third.name}`,
    ]);
  });

  it("is incomplete for a file from before records kept their transcript hash", () => {
    const old = recordOf(refs);
    for (const r of old.references) delete r.transcriptHash;
    expect(coverageGaps(old, refs)).toHaveLength(refs.length);
  });

  // 006-44 made `no-overclaim`'s `unknown` claim explicit after 006-43's rubric failed calibration
  // (Haiku 71/72): this rubric has no calibration yet. Recalibrate, then remove this line.
  const UNCALIBRATED = "4bb132acc949";

  it("is exact for the committed passing calibration of the current rubric", () => {
    const rubric = rubricRevision(declared);
    const passing = readdirSync(RESULTS)
      .filter((f) => f.startsWith("judge-calibration-") && f.endsWith(".json"))
      .map((f) => ({ f, c: JSON.parse(readFileSync(`${RESULTS}${f}`, "utf8")) as Calibration }))
      .filter(({ c }) => c.identity.rubric === rubric && c.passed === true);
    if (rubric !== UNCALIBRATED) expect(passing.map(({ f }) => f)).not.toEqual([]);
    for (const { f, c } of passing)
      expect({ f, gaps: coverageGaps(c, refs) }).toEqual({ f, gaps: [] });
  });
});
