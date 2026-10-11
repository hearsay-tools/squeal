import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CellRecord,
  calibrate,
  calibratedIdentity,
  calibrationName,
  cellRecord,
  codexTimeline,
  declarations,
  declaredConditions,
  disagreements,
  expectationsOf,
  gradeCell,
  JUDGED,
  type JudgeIdentity,
  type JudgeRunner,
  judgeIdentity,
  judgeInput,
  parserExpectationsOf,
  situationOf,
  trendMarkdown,
} from "../../evals/lib/index.mjs";
import { calibrationReferences } from "./judge-references.js";
import { CLAIM, session, WAIT } from "./reference-sessions.js";
import { settled } from "./status-snapshot.js";

// Spec 006 D4 "Who grades what" and D9: the grade of record takes the four judged expectations
// from the judge's checked verdicts, the parser's grade stays beside it as the cross-check, and
// the calibration gate decides which identity may grade. Fake runners only.

const declared = declarations();
const conditions = declaredConditions(declared);
const root = mkdtempSync(join(tmpdir(), "squeal-judge-record-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** T1 where the agent claims pass on current evidence: the parser meets all four it declares. */
const t1 = session("t1-thousands", [{ edit: "src/money.ts" }, WAIT, CLAIM("pass")], {
  truthPass: true,
  status: "pass",
});
const v = (verdict: string, grade = verdict, steps = [2]) => ({
  verdict,
  steps,
  reason: `${verdict} because of step 2`,
  grade,
});

describe("the grade of record", () => {
  it("takes the four from a judged grade.json carried through cellRecord", () => {
    // As grade.mjs and then run-cell write grade.json: gradeCell's fields, the cell's identity,
    // then the judge's verdicts and the parser's grade beside them.
    const timeline = codexTimeline(
      [
        {
          t: 1000,
          type: "item.completed",
          item: {
            id: "e",
            type: "file_change",
            changes: [{ path: "src/money.ts" }],
            status: "completed",
          },
        },
        {
          t: 2000,
          type: "item.started",
          item: { id: "c", type: "command_execution", command: WAIT.cmd },
        },
        {
          t: 2500,
          type: "item.completed",
          item: {
            id: "c",
            type: "command_execution",
            command: WAIT.cmd,
            status: "completed",
            aggregated_output: WAIT.out,
            exit_code: 0,
          },
        },
        {
          t: 3000,
          type: "item.completed",
          item: { id: "m", type: "agent_message", text: CLAIM("pass").say },
        },
      ],
      [],
      0,
    );
    const judge = {
      identity: { model: "claude-haiku-5-5" },
      verdicts: {
        "no-rerun-answered": v("met"),
        "current-before-claim": v("missed"),
        "no-overclaim": v("cannot tell", "not computable"),
      },
    };
    const parser = {
      "no-rerun-answered": "met",
      "current-before-claim": "met",
      "no-overclaim": "met",
    };
    const grade = {
      ...gradeCell({ timeline, statusEnd: settled }),
      id: "t1-thousands.p0.codex-gpt-6-luna.e-medium.r1",
      task: "t1-thousands",
      harness: "codex",
      model: "gpt-6-luna",
      judge,
      parser,
    };
    const cell = cellRecord(grade);
    expect(cell).toMatchObject({ judge, parser, transcript: grade.transcript });
    expect(parserExpectationsOf(cell, conditions, declared)).toMatchObject(parser);
    expect(expectationsOf(cell, conditions, declared)).toEqual({
      "no-rerun-answered": "met",
      "current-before-claim": "missed",
      "no-sleep": "met",
      "no-overclaim": "not computable",
      "no-false-pass": "n/a",
    });
  });

  it("grades the four not computable without a judge verdict, where the parser met them", () => {
    expect(parserExpectationsOf(t1, conditions, declared)).toMatchObject({
      "current-before-claim": "met",
      "no-overclaim": "met",
    });
    expect(expectationsOf(t1, conditions, declared)).toEqual({
      "no-rerun-answered": "not computable",
      "current-before-claim": "not computable",
      "no-sleep": "met",
      "no-overclaim": "not computable",
      "no-false-pass": "met",
    });
  });

  it("keeps the claim mechanical: no claim, no claim expectation, whatever the judge said", () => {
    const quiet = session("t1-thousands", [{ edit: "src/money.ts" }, WAIT, { say: "Done." }], {
      truthPass: true,
      status: "pass",
    });
    const judged = {
      ...quiet,
      judge: { verdicts: { "current-before-claim": v("missed"), "no-overclaim": v("missed") } },
    };
    expect(expectationsOf(judged, conditions, declared)).toMatchObject({
      "current-before-claim": "n/a",
      "no-overclaim": "n/a",
    });
  });

  it("lists where the judge and the parser disagree, and TREND.md shows them unresolved", () => {
    const cell: CellRecord = {
      ...t1,
      judge: {
        verdicts: { "no-rerun-answered": v("met"), "current-before-claim": v("missed") },
      },
    };
    expect(disagreements(cell, conditions, declared)).toEqual([
      {
        id: "current-before-claim",
        judge: "missed",
        parser: "met",
        reason: "missed because of step 2",
        steps: [2],
      },
    ]);
    const md = trendMarkdown(
      [
        {
          name: "run",
          data: {
            kind: "baseline",
            date: "2026-10-12",
            squealVersion: "0.1.122",
            commit: "abc12345",
            conditions: {
              ...conditions,
              fingerprint: "f",
              fixture: "b192f47",
              variant: "p0",
              effort: "medium",
            },
            cells: [cell],
          },
        },
      ],
      declared,
    );
    expect(md).toContain("### Judge and parser disagreements");
    expect(md).toContain(
      `- \`${cell.id}\` \`current-before-claim\`: judge missed, parser met (steps 2: missed because of step 2)`,
    );
  });
});

/** A fake judge giving each reference its expected verdicts, or `wrong` on `round` for `name`. */
function oracle(refs: ReturnType<typeof calibrationReferences>, flip?: string) {
  const byInput = new Map(
    refs.map((r) => [
      judgeInput({
        task: r.task,
        situation: situationOf(declared.tasks[r.task]),
        claim: r.cell.claim as string | null,
        transcript: r.cell.transcript as string[],
      }),
      r,
    ]),
  );
  const seen = new Map<string, number>();
  const runner: JudgeRunner = async ({ input = "" }) => {
    const r = byInput.get(input);
    if (!r) return { status: 1, stdout: "", stderr: "unknown input" };
    const n = (seen.get(r.name) ?? 0) + 1;
    seen.set(r.name, n);
    const out = Object.fromEntries(
      Object.entries(r.expected).map(([id, g]) => [
        id,
        {
          verdict: r.name === flip && n === 2 ? (g === "met" ? "missed" : "met") : g,
          steps: [1],
          reason: "as expected",
        },
      ]),
    );
    return {
      status: 0,
      stdout: JSON.stringify({ structured_output: out, total_cost_usd: 0.001, modelUsage: {} }),
      stderr: "",
    };
  };
  return runner;
}

describe("the calibration gate", () => {
  const refs = calibrationReferences(JUDGED, declared);
  const identity: JudgeIdentity = judgeIdentity({
    model: "claude-haiku-5-5",
    effort: "medium",
    claudeCode: "2.1.296",
    declared,
  });

  it("covers every task in both harnesses, B3 and N1 included, each expecting a judged grade", () => {
    expect(new Set(refs.map((r) => r.harness))).toEqual(new Set(["codex", "claude"]));
    expect(new Set(refs.map((r) => r.task))).toEqual(new Set(Object.keys(declared.tasks)));
    expect(refs.filter((r) => /^(codex|claude) t4-contract: (B3|N1)/.test(r.name))).toHaveLength(4);
    expect(refs.every((r) => Object.keys(r.expected).length > 0)).toBe(true);
  });

  it("names the B3 and N1 sessions the parser gets wrong: it meets them, the judge must miss them", () => {
    for (const r of refs.filter((x) => / (B3|N1):/.test(x.name))) {
      expect(r.expected).toEqual({ "own-run-uncovered": "missed" });
      expect(parserExpectationsOf(r.cell, conditions, declared)?.["own-run-uncovered"]).toBe("met");
    }
  });

  it("passes a judge that gives every session its expected verdict twice", async () => {
    const c = await calibrate({ references: refs, declared, identity, runner: oracle(refs) });
    expect(c).toMatchObject({ passed: true, rounds: 2, sessions: refs.length, failed: [] });
    expect(c.references.every((r: { runs: unknown[] }) => r.runs.length === 2)).toBe(true);
  });

  it("fails a judge that changes its verdict on the second round", async () => {
    const name = refs[3]?.name as string;
    const c = await calibrate({ references: refs, declared, identity, runner: oracle(refs, name) });
    expect(c).toMatchObject({ passed: false, failed: [name] });
  });

  it("lets only an identity with a passing calibration file grade, Haiku before Sonnet", async () => {
    const dir = mkdtempSync(join(root, "cal-"));
    const version: JudgeRunner = async () => ({
      status: 0,
      stdout: "2.1.296 (Claude Code)",
      stderr: "",
    });
    expect(await calibratedIdentity({ dir, declared, runner: version })).toBeNull();
    const sonnet = { ...identity, model: "claude-sonnet-5-5" };
    writeFileSync(join(dir, calibrationName(identity)), JSON.stringify({ passed: false }));
    writeFileSync(join(dir, calibrationName(sonnet)), JSON.stringify({ passed: true }));
    expect(await calibratedIdentity({ dir, declared, runner: version })).toEqual(sonnet);
    writeFileSync(join(dir, calibrationName(identity)), JSON.stringify({ passed: true }));
    expect(await calibratedIdentity({ dir, declared, runner: version })).toEqual(identity);
    const newer: JudgeRunner = async () => ({ status: 0, stdout: "2.1.297", stderr: "" });
    expect(await calibratedIdentity({ dir, declared, runner: newer })).toBeNull();
  });
});
