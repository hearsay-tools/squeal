import { describe, expect, it } from "vitest";
import { type Observation, transitionKind } from "../../src/core/state/index.js";
import type { KnownOutcome, TransitionKind } from "../../src/core/types/index.js";

const obs = (outcome: KnownOutcome, fingerprint: string | null = null): Observation => ({
  outcome,
  fingerprint: outcome === "fail" ? (fingerprint ?? "A") : null,
});

describe("transitionKind", () => {
  const cases: [Observation | null, Observation, TransitionKind | null][] = [
    [null, obs("fail"), "first-seen-fail"],
    [obs("unknown"), obs("fail"), "first-seen-fail"],
    [obs("skip"), obs("fail"), "first-seen-fail"],
    [obs("pass"), obs("fail"), "pass-to-fail"],
    [obs("fail", "A"), obs("fail", "B"), "fail-changed"],
    [obs("fail", "A"), obs("fail", "A"), null],
    [obs("fail"), obs("pass"), "fail-to-pass"],
    [obs("pass"), obs("unknown"), "to-unknown"],
    [obs("fail"), obs("unknown"), "to-unknown"],
    [null, obs("pass"), null],
    [obs("pass"), obs("pass"), null],
    [obs("unknown"), obs("pass"), null],
    [obs("skip"), obs("pass"), null],
    [null, obs("skip"), null],
    [obs("pass"), obs("skip"), null],
    [obs("fail"), obs("skip"), null],
    [null, obs("unknown"), null],
    [obs("skip"), obs("unknown"), null],
    [obs("unknown"), obs("unknown"), null],
  ];

  it.each(cases)("%j -> %j is %s", (from, to, kind) => {
    expect(transitionKind(from, to)).toBe(kind);
  });
});
