import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  calibrationName,
  claudeRunner,
  declarations,
  ensureCalibrated,
  JUDGE_MODELS,
  judgeIdentity,
  transcriptOf,
  trimOutput,
} from "../../evals/lib/index.mjs";

// Review 006-24 (reviews/wave-3.md), fixed by the coordinator. B1: the judge's runner makes its
// base directory, so calibration starts on a fresh eval root. S1: Squeal's evidence lines and a
// runner's summary lines stay whole past the caps that trim incidental output.
const root = mkdtempSync(join(tmpdir(), "squeal-judge-r3-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("B1: a fresh eval root", () => {
  it("runs a judge call whose base directory does not exist yet", async () => {
    const base = join(root, "fresh", "squeal-evals");
    expect(existsSync(base)).toBe(false);
    const run = claudeRunner({
      base,
      parent: { PATH: process.env.PATH ?? "" },
      command: process.execPath,
      prefix: ["-e", "process.stdout.write('2.1.296 (Claude Code)')"],
    });
    const r = await run({ args: [] });
    expect([r.status, r.stdout]).toEqual([0, "2.1.296 (Claude Code)"]);
  });

  // The review's case: ensureCalibrated through the real runner, its base genuinely absent.
  const declared = declarations();
  const fakeClaude = (base: string, version: string) =>
    claudeRunner({
      base,
      parent: { PATH: process.env.PATH ?? "" },
      command: process.execPath,
      prefix: ["-e", `process.stdout.write(${JSON.stringify(`${version} (Claude Code)`)})`, "--"],
    });

  it("finds a known passing identity without calibrating", async () => {
    const dir = join(root, "known-results");
    mkdirSync(dir);
    const haiku = judgeIdentity({
      model: JUDGE_MODELS[0] as string,
      effort: "medium",
      claudeCode: "2.1.296",
      declared,
    });
    writeFileSync(join(dir, calibrationName(haiku)), JSON.stringify({ passed: true }));
    const base = join(root, "known-root");
    const found = await ensureCalibrated({
      dir,
      declared,
      runner: fakeClaude(base, "2.1.296"),
      calibrateModel: () => {
        throw new Error("must not calibrate a known identity");
      },
    });
    expect(found).toMatchObject({ model: JUDGE_MODELS[0], claudeCode: "2.1.296" });
  });

  it("reaches the calibrator for an unknown identity", async () => {
    const dir = join(root, "unknown-results");
    mkdirSync(dir);
    const calls: string[] = [];
    const found = await ensureCalibrated({
      dir,
      declared,
      runner: fakeClaude(join(root, "unknown-root"), "9.9.9"),
      calibrateModel: async (model: string) => {
        calls.push(model);
      },
    });
    expect([found, calls]).toEqual([null, [...JUDGE_MODELS]]);
  });
});

describe("S1: evidence survives the caps", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `note ${i}: ${"x".repeat(60)}`);

  it("keeps a long Squeal output's evidence lines, the trailing slow tier included", () => {
    const out = [
      "Revision: 12",
      "Known failures: 0",
      ...filler(200),
      "Affected checks: 30 passed, 0 running, 0 queued",
      "Full-suite checkpoint: completed at revision 12",
      "Slow tier: current against plugins/** at revision 12",
    ].join("\n");
    expect(out.length).toBeGreaterThan(8000);
    const t = trimOutput(out, true);
    for (const line of [
      "Revision: 12",
      "Known failures: 0",
      "Affected checks: 30 passed, 0 running, 0 queued",
      "Full-suite checkpoint: completed at revision 12",
      "Slow tier: current against plugins/** at revision 12",
    ])
      expect(t).toContain(line);
    expect(t).toMatch(/\[… \d+ lines trimmed\]/);
    expect(t.length).toBeLessThan(out.length);
  });

  it("keeps a runner's summary in a long output that counts as Squeal's by its path (006-27)", () => {
    const summary = ` Test Files  1 passed (1) ${"·".repeat(450)} 1 passed (1)`;
    const out = [
      " RUN  v5.0.3 /tmp/squeal-evals/cell/work",
      "",
      ...filler(10),
      summary,
      ...filler(200),
      "      Tests  12 passed (12)",
      "   Duration  1.20s",
    ].join("\n");
    expect(out.length).toBeGreaterThan(8000);
    const t = trimOutput(out, true);
    for (const line of [summary, "      Tests  12 passed (12)", "   Duration  1.20s"])
      expect(t).toContain(line);
  });

  // Review 006-27's reproduction through transcriptOf: the RUN header's path names squeal, so
  // the output counts as Squeal's, alone and chained with `squeal status`.
  for (const [cmd, tail] of [
    ["npx vitest run", []],
    ["npx vitest run && squeal status", ["SQUEAL · revision 4", "Known failures: 0"]],
  ] as const) {
    it(`keeps a central runner summary in a long \`${cmd}\` (006-27)`, () => {
      const lines = Array.from({ length: 200 }, (_, i) => `incidental ${i} ${"x".repeat(60)}`);
      const summary = ` Test Files  1 passed (1) ${"·".repeat(436)} 1 passed (1)`;
      const out = [
        " RUN  v5.0.3 /tmp/squeal-evals/cell/work",
        ...lines.slice(0, 10),
        summary,
        ...lines.slice(10),
        ...tail,
      ].join("\n");
      expect([summary.length, out.length > 8000]).toEqual([475, true]);
      const [step] = transcriptOf({
        items: [{ t: 0, kind: "cmd", cmd, out, exit: 0 }],
        final: "",
        cost: null,
        usage: null,
        turns: null,
        reachedModel: true,
      });
      expect(step).toContain(summary);
      for (const line of tail) expect(step).toContain(line);
    });
  }

  it("keeps a short Squeal output whole", () => {
    const out = ["Revision: 3", "Known failures: 0", ...filler(5)].join("\n");
    expect(trimOutput(out, true)).toBe(out);
  });

  it("keeps a runner summary line whole past the incidental line cap", () => {
    const summary = ` Test Files  1 passed (1) ${"·".repeat(450)} 1 passed (1)`;
    expect(summary.length).toBeGreaterThan(400);
    const t = trimOutput(["RUN v5.0.3", ...filler(20), summary, "done"].join("\n"), false);
    expect(t).toContain(summary);
  });

  it("still caps an incidental long line, and says so", () => {
    const long = `noise ${"y".repeat(500)}`;
    const t = trimOutput([long, ...filler(10)].join("\n"), false);
    expect(t).toContain("[… trimmed]");
    expect(t).not.toContain(long);
  });
});
