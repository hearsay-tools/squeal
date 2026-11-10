import type { CodeOutcome } from "../../types/code.js";
import { crapScore } from "../crap/score.js";
import type { GateGap, GateState } from "./types.js";

/*
 * Spec 020 D11.1 (row 020-07a): one function's state from its evidence,
 * the one rule the gate's `evaluate()` and the daemon's coverage step
 * (`crap/judge.ts`) both call. Pure. What is told, and when, stays with
 * each caller: the daemon's transitions, its early pass (015-57), its drop
 * (015-75) and its pass beside a skip (015-78) are outside it.
 */

/**
 * Why a loader's record is not in hand. The gate's: a loader that did not
 * finish, or one that finished with no record of these bytes. The
 * daemon's: a file still `pending`, or `unknown` with a record that cannot
 * come.
 */
export type MissingGap = "not-finished" | "no-record" | "pending" | "unknown";

/** The join over the records in hand, when it resolved the function. */
export interface RuleCoverage {
  /** Its own lines that can run, and of those the ones that ran. */
  readonly lines: number;
  readonly covered: number;
  /** 0 to 1. */
  readonly share: number;
  /** A record in hand ran it. */
  readonly ran: boolean;
}

/** D11.1: what the rule reads of one function. */
export interface RuleInput<M extends MissingGap = MissingGap> {
  readonly complexity: number;
  /** `coverage.exclude` matches its file: it wants no coverage (D6). */
  readonly excluded: boolean;
  /** How many test files load its source, or may, and of those how many records are in hand. */
  readonly loaders: { readonly expected: number; readonly measured: number };
  /** The first gap of a loader whose record is not in hand; `null` when every one is. */
  readonly missing: M | null;
  /** From the records in hand; `null` when none is, or the join did not resolve it. */
  readonly coverage: RuleCoverage | null;
  /** A selected test failed (D5.5). The daemon passes `false`: it tells failures as tests (D11.2). */
  readonly failed: boolean;
  /** A loader skipped a test, so its record cannot prove a violation (015 D9, D11.3). */
  readonly skipped: boolean;
}

/** The limits read at the base (D6), or the daemon's policy. */
export interface RulePolicy {
  readonly complexityThreshold: number;
  readonly crapThreshold: number;
}

/** A gap the rule names: one given as missing, or one of its own. */
export type RuleGap<M extends MissingGap> = M | Exclude<GateGap, "not-counted" | MissingGap>;

/** One outcome per daemon measure: `pass` or `fail` when proven, else why not. */
export type MeasureOutcome = Extract<CodeOutcome, "pass" | "fail" | "pending" | "unknown">;

export interface RuleOutput<M extends MissingGap = MissingGap> {
  /** The gate's state: over the CC limit is a violation whatever the evidence (D5). */
  readonly state: Exclude<GateState, "accepted">;
  /** Set when, and only when, the state is `incomplete`. */
  readonly gap: RuleGap<M> | null;
  /** D5 without the CC rule: what the evidence alone says (D8 reads it). */
  readonly evidence: {
    readonly state: Exclude<GateState, "accepted">;
    readonly gap: RuleGap<M> | null;
  };
  /**
   * D5's completeness: the gap of the first condition of complete evidence
   * that does not hold, `null` when all do or the function wants no
   * coverage. A pass by 015 D9's bound, with a record missing or beside a
   * skipped test, has one, so no D8 exception accepts it (review 0.1.424 B1).
   */
  readonly completeness: RuleGap<M> | null;
  /** From the records in hand; an upper bound while one is missing. */
  readonly crap: number | null;
  /** The daemon's measures: `crap` on CRAP alone, `uncovered` whether a test ran it (D11.4). */
  readonly measures: { readonly crap: MeasureOutcome; readonly uncovered: MeasureOutcome };
}

type Evidence<M extends MissingGap> = RuleOutput<M>["evidence"];

const PASS = { state: "pass", gap: null } as const;
const VIOLATION = { state: "violation", gap: null } as const;
const SKIPPED = { state: "skipped", gap: null } as const;
const incomplete = <G extends string>(gap: G) => ({ state: "incomplete" as const, gap });

/**
 * D5.2 to D5.5 and D11.3: the gap of the first condition of complete
 * evidence that does not hold; `null` when all do.
 */
function completenessOf<M extends MissingGap>(
  input: RuleInput<M>,
  crap: number | null,
): RuleGap<M> | null {
  if (input.loaders.expected === 0) return "no-loader";
  if (input.missing !== null) return input.missing;
  if (crap === null) return "not-joined";
  if (input.failed) return "test-failed";
  if (input.skipped) return "skipped";
  return null;
}

/**
 * D5 and D11 without the CC rule, from the completeness `gap`. A loader
 * that did not finish rules out a pass: its later tests never ran (review
 * 0.1.423 B2). With a record missing, or beside a skipped test, the
 * records in hand prove a pass by 015 D9's bound, never a violation; a
 * failed test rules out the pass.
 */
function evidenceOf<M extends MissingGap>(
  input: RuleInput<M>,
  gap: RuleGap<M> | null,
  crap: number | null,
  policy: RulePolicy,
): Evidence<M> {
  const under = crap !== null && crap <= policy.crapThreshold;
  if (gap === null) return under ? PASS : VIOLATION;
  const bound = gap === "skipped" || (gap === input.missing && gap !== "not-finished");
  return bound && under && !input.failed ? PASS : incomplete(gap);
}

/** An outcome not proven: `pending` while a record may still come, else `unknown`. */
const unproven = (gap: unknown): MeasureOutcome => (gap === "pending" ? "pending" : "unknown");

/**
 * D11.4: `uncovered` passes once a record in hand ran the function, and
 * fails only when every record is in hand, none skipped a test, and none
 * ran it.
 */
function uncoveredOf<M extends MissingGap>(input: RuleInput<M>, ev: Evidence<M>): MeasureOutcome {
  const { coverage } = input;
  if (coverage === null || input.loaders.expected === 0) return unproven(ev.gap);
  if (coverage.ran) return "pass";
  const complete = input.missing === null && !input.skipped && !input.failed;
  return complete ? "fail" : unproven(input.missing);
}

/** D11.1: one function's state, gap, CRAP and daemon measures from its evidence. */
export function judgeFunction<M extends MissingGap>(
  input: RuleInput<M>,
  policy: RulePolicy,
): RuleOutput<M> {
  const over = input.complexity > policy.complexityThreshold;
  if (input.excluded) {
    const state = over ? VIOLATION : SKIPPED;
    return {
      ...state,
      evidence: SKIPPED,
      completeness: null,
      crap: null,
      measures: { crap: "unknown", uncovered: "unknown" },
    };
  }
  const crap = input.coverage === null ? null : crapScore(input.complexity, input.coverage.share);
  const completeness = completenessOf(input, crap);
  const evidence = evidenceOf(input, completeness, crap, policy);
  const measures = {
    crap:
      evidence.state === "pass"
        ? ("pass" as const)
        : evidence.state === "violation"
          ? ("fail" as const)
          : unproven(evidence.gap),
    uncovered: uncoveredOf(input, evidence),
  };
  return { ...(over ? VIOLATION : evidence), evidence, completeness, crap, measures };
}
