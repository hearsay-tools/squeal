// The final `TESTS: pass | fail | unknown, evidence: ...` line every task asks for (spec 006 D2).

/**
 * The last `TESTS:` line in `text`: `{ claim, evidence, line }`, `claim` one of `pass`, `fail`,
 * `unknown`, or `null` when no line names exactly one of them (absent, or the template echoed
 * back as `pass | fail | unknown`). Markdown emphasis and code quotes around it are ignored.
 */
export function parseClaim(text) {
  const lines = String(text ?? "")
    .split("\n")
    .filter((l) => /TESTS\s*:/i.test(l));
  const line = lines.at(-1);
  if (line === undefined) return { claim: null, evidence: null, line: null };
  const plain = line.replace(/[*_`]/g, "").trim();
  const m =
    /TESTS\s*:\s*(pass|fail|unknown)\b\s*(\|?)[\s,;:.\u2013\u2014-]*(?:evidence\s*:\s*)?(.*)$/i.exec(
      plain,
    );
  if (!m || m[2] === "|") return { claim: null, evidence: null, line: plain.slice(0, 300) };
  return { claim: m[1].toLowerCase(), evidence: m[3].trim() || null, line: plain.slice(0, 300) };
}
