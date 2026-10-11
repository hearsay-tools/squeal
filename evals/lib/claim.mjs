// The final `TESTS: pass | fail | unknown, evidence: ...` line every task asks for (spec 006 D2).

/** What may stand between two claim words of an echoed template (review wave 2.5, S2). */
const SEPARATOR = /^(?:\s*[|/,;]\s*|\s+or\s+|\s+[-–—]\s+)/i;
/** A bare claim word: one followed by a separator or the end, never by a `:` or more text. */
const BARE = /^(pass|fail|unknown)(?=\s*$|\s*[|/,;]|\s+or\s|\s+[-–—]\s)/i;

/**
 * The last `TESTS:` line in `text`: `{ claim, evidence, line }`, `claim` one of `pass`, `fail`,
 * `unknown`, or `null` when no line names exactly one of them. The claim is the segment before
 * the evidence boundary (review wave 2.5, S2): the first word and any bare claim words after it,
 * apart only by `|`, `/`, `,`, `;`, `or` or a spaced `-`, `–` or `—`. A segment with two claim
 * words is the template echoed back (`pass | fail | unknown`). The boundary is the first other
 * text, `evidence:` or any `label:`, so `pass | fail: 0` is a pass, and the evidence after it may
 * name any claim word. Markdown emphasis and code quotes around the line are ignored.
 */
export function parseClaim(text) {
  const lines = String(text ?? "")
    .split("\n")
    .filter((l) => /TESTS\s*:/i.test(l));
  const line = lines.at(-1);
  if (line === undefined) return { claim: null, evidence: null, line: null };
  const plain = line.replace(/[*_`]/g, "").trim();
  const m = /TESTS\s*:\s*(pass|fail|unknown)\b(.*)$/i.exec(plain);
  const none = { claim: null, evidence: null, line: plain.slice(0, 300) };
  if (!m) return none;
  for (let rest = m[2]; SEPARATOR.test(rest); ) {
    rest = rest.replace(SEPARATOR, "");
    if (BARE.test(rest)) return none;
  }
  const evidence = m[2].replace(/^[\s|/,;:.–—-]*(?:evidence\s*:\s*)?/i, "").trim();
  return { claim: m[1].toLowerCase(), evidence: evidence || null, line: plain.slice(0, 300) };
}

/**
 * A final claim's grades (spec 006 D7; 006-12), from the claim, whether ground truth passed
 * (`null` when it is unavailable) and Squeal's end state (`{ verdict, supported }`, `null`
 * without the plugin). `claimTrue` is `true`, `false`, `"hedged"` for `unknown`, or `null` with
 * no claim or no truth. A false claim is one of two: `falsePass`, `pass` while ground truth
 * fails, the dangerous one; `falseFail`, `fail` while it passes, as when an agent reports a
 * flake Squeal still holds. Both are `null` where `claimTrue` is. An unsupported status
 * matches no claim: Squeal's state there is unavailable.
 */
export function gradeClaim({ claim, truthPass, squeal }) {
  const graded = claim !== null && typeof truthPass === "boolean";
  return {
    claimTrue: !graded ? null : claim === "unknown" ? "hedged" : (claim === "pass") === truthPass,
    falsePass: graded ? claim === "pass" && !truthPass : null,
    falseFail: graded ? claim === "fail" && truthPass : null,
    claimMatchesSqueal:
      claim === null || !squeal ? null : claim === squeal.verdict && squeal.supported === true,
  };
}
