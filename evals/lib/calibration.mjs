// The judge's calibration gate (spec 006 D9): before a judge identity grades a baseline, it
// judges every reference session in both harnesses twice and must give each session's expected
// verdict both times. The run is committed as evals/results/judge-calibration-<identity>.json;
// only an identity with a passing file there grades a cell.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expectationsOf, parserOf } from "./behaviours.mjs";
import {
  claudeVersion,
  identityKey,
  JUDGE,
  JUDGED,
  judgeCell,
  judgeIdentity,
  transcriptHash,
} from "./judge.mjs";

/** The models D9 allows, in the order they are tried: Haiku 5.5, then Sonnet 5.5. Never Opus or Fable. */
export const JUDGE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"];

/** A calibration file's name for `identity`. */
export const calibrationName = (identity) => `judge-calibration-${identityKey(identity)}.json`;

/** Conditions whose knobs are the declared ones, so every reference session is graded. */
export const declaredConditions = (declared) => ({
  tasks: Object.fromEntries(Object.entries(declared.tasks).map(([t, knobs]) => [t, { knobs }])),
});

/** The judged grades of `cell` with `judge`'s verdicts, as the grade of record reads them. */
function judgedGrades(cell, judge, declared) {
  const all = expectationsOf({ ...cell, judge }, declaredConditions(declared), declared) ?? {};
  return Object.fromEntries(Object.entries(all).filter(([id]) => JUDGED.includes(id)));
}

/** Runs `tasks` with at most `n` at once, in order of completion; resolves their results in order. */
async function pooled(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

/**
 * Judges each of `references` (`{ name, task, harness, cell, expected }`, `expected` the judged
 * grades the session must get) `rounds` times with `identity` through `runner`, never cached.
 * Returns the calibration record: `passed` only when every reference got its expected grades in
 * every round. Each reference keeps its transcript's hash, so the record names what it covered;
 * `parser` is the frozen parser's grade of each, for comparison.
 */
export async function calibrate({
  references,
  declared,
  identity,
  runner,
  rounds = 2,
  parallel = 4,
}) {
  const calls = references.flatMap((ref) =>
    Array.from({ length: rounds }, (_, round) => async () => {
      const j = await judgeCell({
        task: ref.task,
        transcript: ref.cell.transcript,
        claim: ref.cell.claim,
        declared,
        identity,
        runner,
      });
      return { ref, round, j, grades: judgedGrades(ref.cell, j, declared) };
    }),
  );
  const done = await pooled(calls, parallel);
  const records = references.map((ref) => {
    const runs = done
      .filter((d) => d.ref === ref)
      .map(({ j, grades }) => ({
        grades,
        verdicts: Object.fromEntries(
          Object.entries(j.verdicts).map(([id, v]) => [
            id,
            { verdict: v.verdict, steps: v.steps, reason: v.reason },
          ]),
        ),
        cost: j.cost,
        ...(j.error ? { error: j.error } : {}),
      }));
    const pass = runs.every((r) =>
      Object.entries(ref.expected).every(([id, v]) => r.grades[id] === v),
    );
    return {
      name: ref.name,
      task: ref.task,
      harness: ref.harness,
      transcriptHash: transcriptHash(ref.task, ref.cell.transcript),
      expected: ref.expected,
      parser: parserOf(ref.cell, declaredConditions(declared), declared),
      pass,
      runs,
    };
  });
  const cost = done.reduce((s, d) => s + (d.j.cost ?? 0), 0);
  return {
    kind: "judge-calibration",
    identity,
    rounds,
    passed: records.every((r) => r.pass),
    sessions: records.length,
    failed: records.filter((r) => !r.pass).map((r) => r.name),
    costUsd: Number(cost.toFixed(6)),
    references: records,
  };
}

/**
 * How `calibration` differs from `references` (006-30): each reference it lacks, each it holds
 * that is not one of them, and each whose transcript hash or expected grades changed. A
 * calibration counts only while this is empty, since a reference set is not part of the identity.
 */
export function coverageGaps(calibration, references) {
  const key = (r) => JSON.stringify({ hash: r.transcriptHash ?? null, expected: r.expected });
  const held = new Map((calibration.references ?? []).map((r) => [r.name, key(r)]));
  const want = new Map(
    references.map((r) => [
      r.name,
      key({ transcriptHash: transcriptHash(r.task, r.cell.transcript), expected: r.expected }),
    ]),
  );
  return [
    ...[...want.keys()].filter((n) => !held.has(n)).map((n) => `missing: ${n}`),
    ...[...held.keys()].filter((n) => !want.has(n)).map((n) => `not a reference: ${n}`),
    ...[...want]
      .filter(([n, k]) => held.has(n) && held.get(n) !== k)
      .map(([n]) => `changed transcript or expected grades: ${n}`),
  ];
}

/**
 * The identity that grades now: the first of `JUDGE_MODELS` at `JUDGE`'s effort, under this
 * Claude Code version and rubric, whose calibration file in `dir` passed; `null` when none has.
 */
export async function calibratedIdentity({ dir, declared, runner }) {
  const claudeCode = await claudeVersion(runner);
  for (const model of JUDGE_MODELS) {
    const identity = judgeIdentity({ model, effort: JUDGE.effort, claudeCode, declared });
    const file = join(dir, calibrationName(identity));
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).passed === true) return identity;
  }
  return null;
}

/**
 * Calibration as a step of every eval run (spec 006 D9, the human 2026-10-11): the identity that
 * grades now, calibrating first when no file in `dir` passed for this Claude Code version and
 * rubric. Each of `JUDGE_MODELS` without a calibration file yet is calibrated in turn by
 * `calibrateModel(model)`, which writes its file into `dir`, until one passes; a model already
 * calibrated and failed for this identity is not tried again. `null` when none passes, so the run
 * stops before any subject session.
 */
export async function ensureCalibrated({ dir, declared, runner, calibrateModel, log = () => {} }) {
  const found = await calibratedIdentity({ dir, declared, runner });
  if (found) return found;
  const claudeCode = await claudeVersion(runner);
  for (const model of JUDGE_MODELS) {
    const identity = judgeIdentity({ model, effort: JUDGE.effort, claudeCode, declared });
    if (existsSync(join(dir, calibrationName(identity)))) continue;
    log(`judge: no passing calibration for ${identityKey(identity)}; calibrating it first`);
    await calibrateModel(model);
    const now = await calibratedIdentity({ dir, declared, runner });
    if (now) return now;
  }
  return null;
}

/**
 * `cell`'s judge record and the parser's cross-check beside it (D9), judged by `identity` through
 * `runner`, reusing `cell.judge` when its transcript hash and identity match: `{ judge, parser }`.
 * `conditions` holds the cell's run's knobs, as the grade of record reads them.
 */
export async function judgeRecord(cell, { identity, runner, declared, conditions }) {
  const { cached: _, ...judge } = await judgeCell({
    task: cell.task,
    transcript: cell.transcript,
    claim: cell.claim,
    declared,
    identity,
    runner,
    cache: cell.judge,
  });
  return { judge, parser: parserOf(cell, conditions, declared) };
}
