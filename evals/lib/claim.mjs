// The final `TESTS: pass | fail | unknown, evidence: ...` line every task asks for (spec 006 D2).

const WORD = /^(pass|fail|unknown)\b/i;
/** What may stand between two claim words of an echoed template: `|`, `/`, `,`, `or` and spaces. */
const BETWEEN = /^(?:[\s|/,;]|or\b)*/i;

/**
 * The last `TESTS:` line in `text`: `{ claim, evidence, line }`, `claim` one of `pass`, `fail`,
 * `unknown`, or `null` when no line names exactly one of them (absent, or the template echoed
 * back as `pass | fail | unknown`). One claim word followed by `|` and its evidence is a claim
 * (006-12). Markdown emphasis and code quotes around it are ignored.
 */
export function parseClaim(text) {
  const lines = String(text ?? "")
    .split("\n")
    .filter((l) => /TESTS\s*:/i.test(l));
  const line = lines.at(-1);
  if (line === undefined) return { claim: null, evidence: null, line: null };
  const plain = line.replace(/[*_`]/g, "").trim();
  const m = /TESTS\s*:\s*(pass|fail|unknown)\b(.*)$/i.exec(plain);
  const rest = m?.[2] ?? "";
  if (!m || WORD.test(rest.replace(BETWEEN, "")))
    return { claim: null, evidence: null, line: plain.slice(0, 300) };
  const evidence = rest.replace(/^[\s|,;:.–—-]*(?:evidence\s*:\s*)?/i, "").trim();
  return { claim: m[1].toLowerCase(), evidence: evidence || null, line: plain.slice(0, 300) };
}
