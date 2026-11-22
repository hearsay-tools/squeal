import { shellWord } from "../core/text.js";
import type { CommitAskState } from "../core/types/commit-ask.js";

/*
 * Rows 023-53 and 023-51 (dogfood round 6, V8 and V4): what a call that
 * names paths covers. Its counts are of the files its paths select, not of
 * what the change selects: "0 pass -> fail, 0 fail -> pass, 1 unchanged, 0
 * unknown" for one named file read as "no test file changed" (s2-08,
 * s2-10). So its summary line says so, with the change's whole selection
 * at the commit when the commit daemon told it, and the call without paths
 * that compares them.
 */

/** A call narrowed by paths: the report's `scope` in JSON; absent (`null`) without paths. */
export interface NarrowScope {
  /** The paths as the call gave them. */
  readonly paths: readonly string[];
  /** The test files they select, at the commit or now: the files the counts cover. */
  readonly files: number;
  /**
   * How many test files the change selects at the commit (D4.5), with a
   * result or not, as the commit daemon counted them; `null` when no
   * commit daemon told it (no `--run` or `--wait`, or an older daemon).
   */
  readonly selects: number | null;
  /** The same call without paths: it compares every file. */
  readonly command: string;
}

/** The scope of a call with `paths`; `undefined` without paths. */
export function scopeOf(
  given: string,
  paths: readonly string[],
  files: number,
  selects: number | null,
): NarrowScope | undefined {
  if (paths.length === 0) return undefined;
  return { paths, files, selects, command: `squeal status --at ${shellWord(given)}` };
}

/** The change's whole selection as the newest ask that counted it says; `null` when none did. */
export function selectsOf(asks: readonly CommitAskState[]): number | null {
  for (let i = asks.length - 1; i >= 0; i--) {
    const selects = asks[i]?.selects;
    if (selects !== undefined) return selects;
  }
  return null;
}

/**
 * V8: the summary line's tail for a narrowed call, after its counts:
 * `, of 1 named test file; the change selects 1338 at <c> (`squeal status
 * --at HEAD~1`, without paths, compares them)`.
 */
export function scopeText(scope: NarrowScope | undefined, at: string): string {
  if (scope === undefined) return "";
  const named = `of ${scope.files} named test file${scope.files === 1 ? "" : "s"}`;
  const { selects } = scope;
  const change =
    selects === null
      ? "the change may select more"
      : `the change selects ${selects} test file${selects === 1 ? "" : "s"} at ${at}`;
  const them = selects === 1 ? "it" : "them";
  return `, ${named}; ${change} (\`${scope.command}\`, without paths, compares ${them})`;
}
