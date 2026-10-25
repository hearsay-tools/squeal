/*
 * Spec 016 D1: the kit's verdicts. A scenario a runner is documented not
 * to meet is a gap with the spec line that documents it, and the
 * assertions it may fail.
 */

/** A scenario a runner is documented not to meet (spec 016 D1). */
export interface Gap {
  /** The spec line that documents it. */
  readonly spec: string;
  /**
   * The assertions it fails, each as a text its line holds, such as
   * `step 2 run`. Any other failed assertion, and any error the driver
   * caught, reads FAIL.
   */
  readonly fails: readonly string[];
}

/**
 * PASS: the expected outcome. FAIL: anything else. KNOWN: a listed gap
 * failed only its listed assertions. UNEXPECTED PASS: a listed gap passed.
 */
export type Verdict = "PASS" | "FAIL" | "KNOWN" | "UNEXPECTED PASS";

export interface Played {
  readonly scenario: string;
  readonly pack: string;
  readonly verdict: Verdict;
  /** The spec line of a listed gap. */
  readonly known: string | undefined;
  /** One line per assertion, `ok` or `FAIL`, and notes. */
  readonly lines: readonly string[];
}

/** `failed`: the lines of the failed assertions; `errored`: the driver caught an error. */
export function verdictOf(
  failed: readonly string[],
  errored: boolean,
  gap: Gap | undefined,
): Verdict {
  if (errored) return "FAIL";
  if (gap === undefined) return failed.length === 0 ? "PASS" : "FAIL";
  if (failed.length === 0) return "UNEXPECTED PASS";
  const listed = (line: string) => gap.fails.some((text) => line.includes(text));
  return failed.every(listed) ? "KNOWN" : "FAIL";
}

/** A kit test passes on PASS and KNOWN alone, so a gap that closed fails until it is unlisted. */
export const accepted = (verdict: Verdict): boolean => verdict === "PASS" || verdict === "KNOWN";

/** The played scenario as a failure message reads it. */
export function describePlayed(played: Played): string {
  const gap = played.known === undefined ? "" : ` (listed gap: ${played.known})`;
  return [`${played.verdict} ${played.scenario} × ${played.pack}${gap}`, ...played.lines].join(
    "\n",
  );
}
