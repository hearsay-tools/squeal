import { describe, expect, it } from "vitest";
import { parseClaim } from "../../evals/lib/index.mjs";

// Review wave 2.5, S2: the claim is the segment before an explicit evidence boundary. Inside it,
// claim words may stand apart only through the separators `|`, `/`, `,`, `;`, `or` and a spaced
// `-`, `–` or `—`; two of them there are the template, not a claim. The boundary is the first
// thing that is not a bare claim word: `evidence:`, any `label:` (a claim word included), or text.
// What follows it is diagnostic and free to name claim words.
describe("parseClaim's claim segment", () => {
  it("reads no claim from a template naming two claim words, whatever the separator", () => {
    for (const line of [
      "TESTS: pass | fail | unknown, evidence: ...",
      "TESTS: pass - fail - unknown, evidence: ...",
      "TESTS: pass – fail – unknown",
      "TESTS: pass — fail",
      "TESTS: pass, fail, unknown",
      "TESTS: pass; fail",
      "TESTS: unknown|pass",
      "TESTS: pass / fail, evidence: Squeal",
      "TESTS: pass or fail",
    ])
      expect(parseClaim(line).claim, line).toBeNull();
  });

  it("reads one claim word followed by a labelled diagnostic as that claim", () => {
    expect(parseClaim("TESTS: pass | fail: 0")).toMatchObject({
      claim: "pass",
      evidence: "fail: 0",
    });
    expect(parseClaim("TESTS: pass - fail: 0, unknown: 0").claim).toBe("pass");
    expect(parseClaim("TESTS: fail | pass: 30, fail: 1").claim).toBe("fail");
  });

  it("reads one claim word followed by free text as that claim", () => {
    expect(parseClaim("TESTS: fail, pass rate unchanged at 30 of 31").claim).toBe("fail");
    expect(parseClaim("TESTS: pass - 31 passed, 0 fail").claim).toBe("pass");
    expect(parseClaim("TESTS: unknown | evidence: pass or fail not yet known").claim).toBe(
      "unknown",
    );
    expect(parseClaim("TESTS: fail — evidence: contract test").evidence).toBe("contract test");
  });

  it("reads no claim when the first word is not a whole claim word", () => {
    expect(parseClaim("TESTS: passing, evidence: Squeal").claim).toBeNull();
    expect(parseClaim("TESTS: see above").claim).toBeNull();
  });
});
