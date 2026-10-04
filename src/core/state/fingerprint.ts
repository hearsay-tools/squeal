import type { CheckError, DiagnosticFingerprint, SourceLocation } from "../types/index.js";

/** Longest `summary`, in characters. Deltas show it whole; full text stays in the run log. */
export const SUMMARY_MAX_CHARS = 300;

// Colour codes from the runner's formatter (CSI sequences).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the point of this pattern.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/*
 * Parts of a first line that change between runs of the same failure. Values
 * of an assertion are kept: "expected 1 to be 2" and "expected 1 to be 3" are
 * different failures (vision: "FAIL -> FAIL: quiet, unless the failure itself
 * changed").
 */
const VOLATILE: readonly [RegExp, string][] = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
  [/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms"],
  [/\b0x[0-9a-f]+\b/gi, "0x<addr>"],
];

function firstLine(text: string): string {
  const line = text
    .replace(ANSI, "")
    .split(/\r?\n/)
    .find((l) => l.trim() !== "");
  return (line ?? "").trim().replace(/\s+/g, " ");
}

function normalize(line: string): string {
  return VOLATILE.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    line,
  );
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function where(location: SourceLocation | null): string {
  return location === null ? "?" : `${location.path}:${location.line}:${location.column}`;
}

/**
 * Fingerprint and concise summary of a failed check.
 *
 * Spec 001 D6: "a **diagnostic fingerprint** (normalized first error line plus
 * source location)". The line is the first non-empty line of
 * `errors[0].message`, prefixed with the error name; the location is
 * `errors[0].location`, else `fallback` (the test's own location). Later
 * errors and lines are left out, so a changed stack or diff alone is not a
 * changed failure.
 */
export function describeFailure(
  errors: readonly CheckError[],
  fallback: SourceLocation | null,
): { readonly fingerprint: DiagnosticFingerprint; readonly summary: string } {
  const first = errors[0];
  if (first === undefined) {
    return { fingerprint: `fail @ ${where(fallback)}`, summary: "failed without an error message" };
  }
  const line = firstLine(first.message);
  const location = first.location ?? fallback;
  const more = errors.length - 1;
  const text = line === "" ? first.name : line;
  const summary = more > 0 ? `${text} (${more} more error${more === 1 ? "" : "s"})` : text;
  return {
    fingerprint: `${first.name}: ${normalize(line)} @ ${where(location)}`,
    summary: cap(summary, SUMMARY_MAX_CHARS),
  };
}
