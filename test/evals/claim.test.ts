import { describe, expect, it } from "vitest";
import { parseClaim } from "../../evals/lib/index.mjs";

describe("parseClaim", () => {
  it("reads the last TESTS: line with its evidence", () => {
    expect(
      parseClaim("Done.\nTESTS: fail, evidence: 1 known failure\nTESTS: pass, evidence: 31 passed"),
    ).toEqual({
      claim: "pass",
      evidence: "31 passed",
      line: "TESTS: pass, evidence: 31 passed",
    });
  });

  it("ignores markdown emphasis, code quotes and case", () => {
    expect(parseClaim("**TESTS: PASS**, evidence: Squeal").claim).toBe("pass");
    expect(parseClaim("`TESTS: unknown` evidence: 2 queued").claim).toBe("unknown");
    expect(parseClaim("TESTS: fail — evidence: contract test").evidence).toBe("contract test");
  });

  it("reads no claim from an absent line or the echoed template", () => {
    expect(parseClaim("All done.").claim).toBeNull();
    expect(parseClaim(undefined).claim).toBeNull();
    expect(parseClaim("TESTS: pass | fail | unknown, evidence: ...").claim).toBeNull();
  });
});
