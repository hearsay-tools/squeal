import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  calibrationName,
  declarations,
  ensureCalibrated,
  JUDGE_MODELS,
  type JudgeRunner,
  judgeIdentity,
} from "../../evals/lib/index.mjs";

// Spec 006 D9 as amended 2026-10-11 (row 006-25): calibration is a step of every eval run. With
// fake runners, no model: a known identity skips calibration, an unknown one calibrates first,
// Haiku before Sonnet, and a run with no passing model gets null and stops before any session.
const root = mkdtempSync(join(tmpdir(), "squeal-evals-ensure-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const declared = declarations();
const runner: JudgeRunner = async () => ({
  status: 0,
  stdout: "2.1.296 (Claude Code)",
  stderr: "",
});
const id = (model: string) =>
  judgeIdentity({ model, effort: "medium", claudeCode: "2.1.296", declared });
const [haiku, sonnet] = JUDGE_MODELS.map(id) as [ReturnType<typeof id>, ReturnType<typeof id>];

/** A calibrateModel that writes each model's file with the given outcome, recording each call. */
const calibrator = (dir: string, passes: Record<string, boolean>) => {
  const calls: string[] = [];
  return {
    calls,
    calibrateModel: async (model: string) => {
      calls.push(model);
      writeFileSync(
        join(dir, calibrationName(id(model))),
        JSON.stringify({ passed: passes[model] }),
      );
    },
  };
};

describe("ensureCalibrated", () => {
  it("skips calibration for an identity with a passing file", async () => {
    const dir = mkdtempSync(join(root, "known-"));
    writeFileSync(join(dir, calibrationName(haiku)), JSON.stringify({ passed: true }));
    const c = calibrator(dir, {});
    expect(
      await ensureCalibrated({ dir, declared, runner, calibrateModel: c.calibrateModel }),
    ).toEqual(haiku);
    expect(c.calls).toEqual([]);
  });

  it("calibrates Haiku first when nothing matches this Claude Code and rubric", async () => {
    const dir = mkdtempSync(join(root, "new-"));
    const c = calibrator(dir, { "claude-haiku-5-5": true });
    expect(
      await ensureCalibrated({ dir, declared, runner, calibrateModel: c.calibrateModel }),
    ).toEqual(haiku);
    expect(c.calls).toEqual(["claude-haiku-5-5"]);
  });

  it("tries Sonnet when Haiku fails", async () => {
    const dir = mkdtempSync(join(root, "sonnet-"));
    const c = calibrator(dir, { "claude-haiku-5-5": false, "claude-sonnet-5-5": true });
    expect(
      await ensureCalibrated({ dir, declared, runner, calibrateModel: c.calibrateModel }),
    ).toEqual(sonnet);
    expect(c.calls).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  it("returns null when no model passes, so the run stops before any session", async () => {
    const dir = mkdtempSync(join(root, "none-"));
    const c = calibrator(dir, { "claude-haiku-5-5": false, "claude-sonnet-5-5": false });
    expect(
      await ensureCalibrated({ dir, declared, runner, calibrateModel: c.calibrateModel }),
    ).toBeNull();
    expect(c.calls).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  it("does not recalibrate a model that already failed for this identity", async () => {
    const dir = mkdtempSync(join(root, "failed-"));
    writeFileSync(join(dir, calibrationName(haiku)), JSON.stringify({ passed: false }));
    const c = calibrator(dir, { "claude-sonnet-5-5": true });
    expect(
      await ensureCalibrated({ dir, declared, runner, calibrateModel: c.calibrateModel }),
    ).toEqual(sonnet);
    expect(c.calls).toEqual(["claude-sonnet-5-5"]);
  });

  it("calibrates again after a Claude Code update", async () => {
    const dir = mkdtempSync(join(root, "update-"));
    writeFileSync(join(dir, calibrationName(haiku)), JSON.stringify({ passed: true }));
    const newer: JudgeRunner = async () => ({ status: 0, stdout: "2.1.297", stderr: "" });
    const calls: string[] = [];
    const got = await ensureCalibrated({
      dir,
      declared,
      runner: newer,
      calibrateModel: async (model) => {
        calls.push(model);
        writeFileSync(
          join(
            dir,
            calibrationName(
              judgeIdentity({ model, effort: "medium", claudeCode: "2.1.297", declared }),
            ),
          ),
          JSON.stringify({ passed: true }),
        );
      },
    });
    expect(calls).toEqual(["claude-haiku-5-5"]);
    expect(got?.claudeCode).toBe("2.1.297");
  });
});
