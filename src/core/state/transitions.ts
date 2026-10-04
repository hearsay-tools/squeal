import type { DiagnosticFingerprint, KnownOutcome, TransitionKind } from "../types/index.js";

/** What one side of a comparison says about a check: a known state or a view entry. */
export interface Observation {
  readonly outcome: KnownOutcome;
  readonly fingerprint: DiagnosticFingerprint | null;
}

/**
 * The notable kind of a change from `from` to `to`, or `null` when the change
 * is not news. Used for the transition log (known state before and after a
 * result) and for deltas (what a consumer was told and what is known now).
 *
 * Spec 001 D6: "first-seen fail, `pass -> fail`, `fail -> pass`, `fail ->
 * fail` with a changed fingerprint, runner-crash to `unknown`". `skip` is
 * "never notable in a delta". A fail after `unknown` or `skip` is first-seen:
 * no pass was observed before it. `unknown` is notable only after a pass or a
 * fail, and a pass after `unknown` is not, like any first pass.
 */
export function transitionKind(from: Observation | null, to: Observation): TransitionKind | null {
  const before = from?.outcome ?? null;
  switch (to.outcome) {
    case "fail":
      if (before === "pass") return "pass-to-fail";
      if (before === "fail") return from?.fingerprint === to.fingerprint ? null : "fail-changed";
      return "first-seen-fail";
    case "pass":
      return before === "fail" ? "fail-to-pass" : null;
    case "unknown":
      return before === "pass" || before === "fail" ? "to-unknown" : null;
    case "skip":
      return null;
  }
}
