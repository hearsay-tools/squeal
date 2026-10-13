import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPolicy } from "../../core/daemon/policy.js";
import { tellUncovered } from "../../core/delivery/uncovered.js";
import type { RelativePath } from "../../core/types/index.js";
import type { HookContext } from "./context.js";

/** The most paths the line names before ` and N more`. */
const SHOWN = 3;

/**
 * The most characters the line takes, with the `SQUEAL · ` it starts with
 * when it is said alone: the rest of the 10,000-character cap (D6) is the
 * delta's (review wave 13as, B3). Three paths of 300 characters fit.
 */
export const UNCOVERED_LINE_CAP_CHARS = 1_000;

const PREFIX = "SQUEAL · ";

/** Marks the start of a path cut to fit the line: its end, the file name, is kept. */
const CUT = "…";

/**
 * Spec 001 D9 as amended (task 001-292): after an edit, one line naming the
 * changed code files no test Squeal runs reads, each once per consumer
 * (`tellUncovered`); `null` when there is none or policy
 * `delivery.uncoveredEdits` is off, which then records nothing. The wording
 * is what the eval measured (`status.md`, 2026-10-13); 005-15 owns any other.
 * The line fits `UNCOVERED_LINE_CAP_CHARS` (`fitUncovered`).
 */
export function uncoveredEditLine(context: HookContext): string | null {
  if (!readPolicy(context.root).delivery.uncoveredEdits) return null;
  const paths = tellUncovered(context.store, context.consumer, (path) =>
    existsSync(join(context.root, path)),
  );
  return paths.length === 0 ? null : fitUncovered(paths);
}

/**
 * The line naming `paths`: the first three and ` and N more`, as measured.
 * When those do not fit `UNCOVERED_LINE_CAP_CHARS`, fewer are named and
 * counted in ` and N more`; when not even the first fits, it is named by its
 * end after `…`. Every path told is named or counted.
 */
export function fitUncovered(paths: readonly RelativePath[]): string {
  const it = paths.length === 1 ? "it" : "them";
  const line = (shown: readonly string[]) => {
    const more = paths.length - shown.length;
    const rest = more > 0 ? ` and ${more} more` : "";
    return `No result for ${shown.join(", ")}${rest}: no test Squeal runs reads ${it}. Run whatever tests ${it} yourself.`;
  };
  const fits = (text: string) => PREFIX.length + text.length <= UNCOVERED_LINE_CAP_CHARS;
  for (let n = Math.min(SHOWN, paths.length); n > 0; n--) {
    const text = line(paths.slice(0, n));
    if (fits(text)) return text;
  }
  const first = paths[0] ?? "";
  const room = UNCOVERED_LINE_CAP_CHARS - PREFIX.length - line([""]).length - CUT.length;
  return line([`${CUT}${first.slice(first.length - room)}`]);
}
