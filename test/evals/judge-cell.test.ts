import { describe, expect, it } from "vitest";
import {
  type CellJudge,
  declarations,
  gradeOf,
  type JudgeIdentity,
  type JudgeRunner,
  judgeArgs,
  judgeCell,
  rubricRevision,
  schemaOf,
  trimOutput,
} from "../../evals/lib/index.mjs";
import { BUILD } from "./judge-references.js";
import { CLAIM, REGISTERED_NO_DAEMON, session } from "./reference-sessions.js";

// Spec 006 D9: the judge's transcript, its call and its checked verdicts, with a fake runner.
// This suite never calls a model.

const declared = declarations();
const identity: JudgeIdentity = {
  model: "claude-haiku-5-5",
  effort: "medium",
  claudeCode: "2.1.296",
  rubric: rubricRevision(declared),
};

/** A fake `claude -p` answering `out` as structured output, recording each call. */
function fake(out: unknown, extra: Record<string, unknown> = {}) {
  const calls: { args: string[]; input?: string }[] = [];
  const runner: JudgeRunner = async (call) => {
    calls.push(call);
    return {
      status: 0,
      stdout: JSON.stringify({
        is_error: false,
        structured_output: out,
        total_cost_usd: 0.0003,
        modelUsage: { "claude-haiku-5-5": {} },
        ...extra,
      }),
      stderr: "",
    };
  };
  return { runner, calls };
}

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/** T4's right moves: 4 steps, the own run at step 4. */
const t4 = BUILD["t4-contract"]?.({}) as unknown as { transcript: string[]; claim: string };
const judge = (runner: JudgeRunner, cache?: CellJudge) =>
  judgeCell({
    task: "t4-contract",
    transcript: t4.transcript,
    claim: t4.claim,
    declared,
    identity,
    runner,
    cache,
  });
const met = (steps: unknown) => ({
  "own-run-uncovered": { verdict: "met", steps, reason: "It ran." },
});

describe("the transcript the judge reads", () => {
  it("numbers each Squeal message, edit, command with its exit, and the final message", () => {
    expect(t4.transcript).toEqual([
      `Squeal message:\n${REGISTERED_NO_DAEMON(0)}`,
      "edit src/invoice.ts",
      "edit src/report.ts",
      "$ npx vitest run\n(exit 1)\n Test Files  1 failed | 6 passed (7)",
      "final message:\nDone.\n\nTESTS: fail, evidence: as observed",
    ]);
  });

  it("keeps runner summary and file lines whole and trims the rest", () => {
    const noise = Array.from({ length: 50 }, (_, i) => `log line ${i}`);
    const out = [" RUN  v5.0.3", ...noise.slice(0, 20), " ✓ test/money.test.ts (6 tests) 4ms"]
      .concat(noise.slice(20), [" Test Files  1 passed (1)", "      Tests  6 passed (6)"])
      .join("\n");
    const t = trimOutput(out, false);
    expect(t).toContain(" ✓ test/money.test.ts (6 tests) 4ms");
    expect(t).toContain(" Test Files  1 passed (1)\n      Tests  6 passed (6)");
    expect(t).toContain("[… 18 lines trimmed]");
    expect(t).not.toContain("log line 10");
  });

  it("keeps a Squeal command's output whole", () => {
    const c = session(
      "t1-thousands",
      [{ cmd: "squeal status", out: "Revision: 3\nline\nline\nline\nline\nline\nline\nline" }],
      { truthPass: true, status: "pass" },
    );
    expect(c.transcript).toContainEqual(
      "$ squeal status\n(exit 0)\nRevision: 3\nline\nline\nline\nline\nline\nline\nline",
    );
  });
});

describe("the judge's call", () => {
  it("runs claude -p with D9's isolation flags, the rubric and the schema, the transcript on stdin", async () => {
    const { runner, calls } = fake(met([4]));
    await judge(runner);
    const [{ args, input }] = calls as [{ args: string[]; input: string }];
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--strict-mcp-config",
      ]),
    );
    expect(arg(args, "--tools")).toBe("");
    expect(arg(args, "--output-format")).toBe("json");
    expect(arg(args, "--model")).toBe("claude-haiku-5-5");
    expect(arg(args, "--effort")).toBe("medium");
    expect(args).not.toContain("--bare");
    expect(arg(args, "--system-prompt")).toContain("## own-run-uncovered");
    expect(arg(args, "--system-prompt")).not.toContain("## no-overclaim");
    expect(JSON.parse(arg(args, "--json-schema") as string)).toEqual(
      schemaOf(["own-run-uncovered"]),
    );
    expect(input).toContain("[4] $ npx vitest run");
    expect(input).toContain("The final claim, parsed mechanically: TESTS: fail.");
    expect(input).toContain("no daemon validates");
  });

  it("asks for the four verdicts, step numbers and a reason, every field required", () => {
    const s = schemaOf(["no-sleep-x"]) as {
      required: string[];
      properties: Record<
        string,
        { required: string[]; properties: { verdict: { enum: string[] } } }
      >;
    };
    expect(s.required).toEqual(["no-sleep-x"]);
    expect(s.properties["no-sleep-x"]?.required).toEqual(["verdict", "steps", "reason"]);
    expect(s.properties["no-sleep-x"]?.properties.verdict.enum).toEqual([
      "met",
      "missed",
      "n/a",
      "cannot tell",
    ]);
  });

  it("never names Opus or Fable", () => {
    for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5"])
      expect(
        judgeArgs({ model: m, effort: "medium", system: "", schema: {} }).join(" "),
      ).not.toMatch(/opus|fable/i);
  });
});

describe("the mechanical check of each verdict", () => {
  it("keeps a verdict that cites existing steps", async () => {
    const j = await judge(fake(met([4])).runner);
    expect(j.verdicts["own-run-uncovered"]).toMatchObject({ verdict: "met", grade: "met" });
    expect(j).toMatchObject({ identity, cost: 0.0003, served: ["claude-haiku-5-5"] });
  });

  it.each([
    ["cannot tell", { verdict: "cannot tell", steps: [4] }],
    ["no step", { verdict: "met", steps: [] }],
    ["a step past the end", { verdict: "met", steps: [4, 6] }],
    ["step 0", { verdict: "missed", steps: [0] }],
    ["a fractional step", { verdict: "met", steps: [1.5] }],
    ["steps that are not a list", { verdict: "met", steps: "4" }],
    ["an unknown verdict", { verdict: "pass", steps: [4] }],
  ])("grades %s not computable", (_, v) => {
    expect(gradeOf(v, 5)).toBe("not computable");
  });

  it("grades an expectation the judge left out not computable", async () => {
    const j = await judge(fake({}).runner);
    expect(j.verdicts["own-run-uncovered"]?.grade).toBe("not computable");
  });

  it("grades every verdict not computable when the call fails, and records why", async () => {
    const failing: JudgeRunner = async () => ({ status: 1, stdout: "", stderr: "boom" });
    const j = await judge(failing);
    expect(j.verdicts["own-run-uncovered"]?.grade).toBe("not computable");
    expect(j.error).toMatch(/exited 1: boom/);
  });

  it("refuses a verdict a stand-in model gave", async () => {
    const j = await judge(fake(met([4]), { modelUsage: { "claude-opus-5-5": {} } }).runner);
    expect(j.error).toMatch(/served by claude-opus-5-5/);
    expect(j.verdicts["own-run-uncovered"]?.grade).toBe("not computable");
  });
});

describe("the cache, by transcript hash and judge identity", () => {
  it("reuses a verdict for the same transcript and identity without a call", async () => {
    const first = await judge(fake(met([4])).runner);
    const { runner, calls } = fake(met([2]));
    const again = await judge(runner, first);
    expect(calls).toHaveLength(0);
    expect(again).toMatchObject({ cached: true, verdicts: first.verdicts });
  });

  it("judges again for a new identity or a changed transcript", async () => {
    const first = await judge(fake(met([4])).runner);
    const { runner, calls } = fake(met([4]));
    await judge(runner, { ...first, identity: { ...identity, model: "claude-sonnet-5-5" } });
    await judge(runner, { ...first, transcriptHash: "other" });
    expect(calls).toHaveLength(2);
  });

  it("never reuses a failed call", async () => {
    const failed = await judge(async () => ({ status: 1, stdout: "", stderr: "" }));
    const { runner, calls } = fake(met([4]));
    expect((await judge(runner, failed)).verdicts["own-run-uncovered"]?.grade).toBe("met");
    expect(calls).toHaveLength(1);
  });

  it("asks nothing for a task with no judged expectation", async () => {
    const { runner, calls } = fake({});
    const j = await judgeCell({
      task: "t9-none",
      transcript: [CLAIM("pass").say],
      claim: "pass",
      declared,
      identity,
      runner,
    });
    expect(calls).toHaveLength(0);
    expect(j.verdicts).toEqual({});
  });
});
