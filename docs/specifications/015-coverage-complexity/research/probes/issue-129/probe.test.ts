import { expect, it } from "vitest";
import { formatCodeReport } from "../../../../../../src/cli/code.js";
import { readCodeReport } from "../../../../../../src/cli/code-report.js";
import { crapScore, readSummary } from "../../../../../../src/core/code/crap/index.js";
import { coverageRig, sourceOf } from "../../../../../../test/code/crap/rig.js";
import { WT } from "../../../../../../test/state/helpers.js";

// Throwaway research: fabricated counts and mapped records, real judgement and CLI readers.
it("reproduces unexplained CRAP unknown beside nonzero line coverage", async () => {
  const rig = coverageRig();
  await rig.recount({
    version: 999,
    async count() {
      return {
        errors: [],
        functions: [
          { qualifiedName: "pumpWork", occurrence: 0, bodyHash: "pump", complexity: 20,
            decisions: { if: 19 },
            range: { startLine: 1, startColumn: 1, endLine: 74, endColumn: 80 } },
          { qualifiedName: "other", occurrence: 0, bodyHash: "other", complexity: 7,
            decisions: { if: 6 },
            range: { startLine: 76, startColumn: 1, endLine: 76, endColumn: 80 } },
        ],
      };
    },
  });
  await rig.edit({ "src/a.ts": `${"// synthetic source\n".repeat(76)}` });
  const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
  const record = (covered: number[]) => [{
    ...sourceOf("src/a.ts", blob, 76, covered),
    functions: [[1, 0, 74, 78, 1], [76, 0, 76, 78, 1]] as const,
  }];
  const partial = [...Array.from({ length: 38 }, (_, i) => i + 1), 76];
  const all = Array.from({ length: 76 }, (_, i) => i + 1);
  rig.loader("test/ready.test.ts", { closure: ["src/a.ts"], record: record(partial) });
  rig.loader("test/skip.test.ts", {
    closure: ["src/a.ts"], outcomes: ["pass", "skip"], record: record(all),
  });
  const read = () => readCodeReport(rig.main, rig.store, WT,
    { threshold: 20, maxFileBytes: 524_288 },
    { paths: ["src/a.ts"], changed: false, shell: null });
  const step = rig.step();
  const report = read();
  const text = formatCodeReport(report);
  const pump = report.functions.find((f) => f.qualifiedName === "pumpWork");
  expect(pump?.coverage).toMatchObject({
    crap: { outcome: "unknown", value: null }, uncovered: "pass",
    lines: 74, covered: 38, testFiles: 1,
  });
  expect(pump?.coverage?.crap).not.toHaveProperty("reason");
  expect(report).not.toHaveProperty("coverage");
  expect(report).not.toHaveProperty("notes");
  expect(text).toContain("pumpWork  CC 20 (if 19), at or under; CRAP unknown");
  expect(text).not.toContain("skipped");
  expect(report.functions.find((f) => f.qualifiedName === "other")?.coverage?.crap)
    .toEqual({ outcome: "pass", value: 7 });
  const summary = readSummary(rig.store.meta, WT)?.files["src/a.ts"];
  expect(summary).toMatchObject({ state: "unknown", cause: "skipped" });
  console.log(JSON.stringify({ phase: "skipped", step, summary,
    partialScoreBound: crapScore(20, 38 / 74), text, report }, null, 2));
  // New key removes the skip and supplies a complete, current record.
  rig.loader("test/skip.test.ts", {
    closure: ["src/a.ts"], key: "completed-key", record: record(all),
  });
  rig.step();
  const settled = read();
  expect(settled.functions.find((f) => f.qualifiedName === "pumpWork")?.coverage?.crap)
    .toEqual({ outcome: "pass", value: 20 });
  console.log(JSON.stringify({ phase: "complete", summary: readSummary(rig.store.meta, WT)?.files["src/a.ts"],
    text: formatCodeReport(settled) }, null, 2));
});
