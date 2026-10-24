import { coverageMeasures, NOT_REACHED_SHORT } from "../../core/delivery/code-coverage.js";
import { lineOf } from "../../core/delivery/code-deliver.js";
import { functionName, whereOf } from "../../core/delivery/code-format.js";
import { consumerSince, wentOverSince } from "../../core/delivery/code-since.js";
import { codeSource, withCode } from "../../core/delivery/code-source.js";
import { SQUEAL_COMMAND } from "../../core/delivery/index.js";
import { listPaths, plural } from "../../core/text.js";
import type { CodeKnownState } from "../../core/types/code.js";
import type { Policy } from "../../core/types/index.js";
import type { HookContext } from "./context.js";

/** Row 015-40: what a function went to `fail` on, as Stop names it. */
function measureWords(s: CodeKnownState): string {
  if (s.measure === "uncovered") return NOT_REACHED_SHORT;
  return `over ${s.measure === "crap" ? "CRAP" : "complexity"} ${s.threshold}`;
}

/**
 * The functions of `over`, each once in the order it first comes, with
 * where it is; with `measures`, what it went to `fail` on.
 */
function functionsText(
  over: readonly (CodeKnownState & { readonly line: number | null })[],
  measures: boolean,
): string[] {
  const by = new Map<string, { at: string; words: string[] }>();
  for (const s of over) {
    const key = JSON.stringify([s.check.path, s.check.qualifiedName, s.check.occurrence]);
    const fn = by.get(key) ?? {
      at: `${functionName(s.check)} (${whereOf(s.check, s.line)})`,
      words: [],
    };
    fn.words.push(measureWords(s));
    by.set(key, fn);
  }
  return [...by.values()].map(({ at, words }) => (measures ? `${at} ${words.join(" and ")}` : at));
}

/**
 * Spec 015 D7: with `complexity.blocking` on, Stop's completion check
 * (011 C8) also counts each function that went to `fail` since the
 * consumer registered; one already failing at registration never blocks.
 * Row 015-40: `crap` and `uncovered` too, while the coverage step judges
 * here, and then each function's measures are named; with complexity only,
 * the text is as before. `null` while the policy or the key is off, or none
 * went over. Without the key a code failure never blocks Stop.
 */
export function codeStopReason(
  context: HookContext,
  complexity: Policy["complexity"],
  command: string = SQUEAL_COMMAND,
): string | null {
  if (!complexity.enabled || !complexity.blocking) return null;
  const since = consumerSince(context.store, context.consumer);
  if (since === null) return null;
  const { worktreeId } = context.consumer;
  const source = context.code ?? codeSource(context.commonDir, context.root);
  const over = withCode(source, ({ store }) =>
    store.read(() =>
      wentOverSince(store, worktreeId, since, [
        "complexity",
        ...coverageMeasures(store, worktreeId),
      ]).map((s) => ({ ...s, line: lineOf(store, worktreeId, s.check) })),
    ),
  );
  if (over === null || over === "missing" || over.length === 0) return null;
  const coverage = over.some((s) => s.measure !== "complexity");
  const functions = functionsText(over, coverage);
  const what = coverage
    ? "went to fail"
    : `went over the complexity threshold ${complexity.threshold}`;
  return (
    `Squeal policy complexity.blocking is on and ${plural(functions.length, "function")} ` +
    `${what} since this session started: ` +
    `${listPaths(functions)}. \`${command} code --changed\` lists them.`
  );
}
