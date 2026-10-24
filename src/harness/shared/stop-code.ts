import { lineOf } from "../../core/delivery/code-deliver.js";
import { functionName, whereOf } from "../../core/delivery/code-format.js";
import { consumerSince, wentOverSince } from "../../core/delivery/code-since.js";
import { codeSource, withCode } from "../../core/delivery/code-source.js";
import { SQUEAL_COMMAND } from "../../core/delivery/index.js";
import { listPaths, plural } from "../../core/text.js";
import type { Policy } from "../../core/types/index.js";
import type { HookContext } from "./context.js";

/**
 * Spec 015 D7: with `complexity.blocking` on, Stop's completion check
 * (011 C8) also counts each function that went to `fail` since the
 * consumer registered; one already failing at registration never blocks.
 * `null` while the policy or the key is off, or none went over. Without
 * the key a code failure never blocks Stop.
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
      wentOverSince(store, worktreeId, since).map(
        (s) => `${functionName(s.check)} (${whereOf(s.check, lineOf(store, worktreeId, s.check))})`,
      ),
    ),
  );
  if (over === null || over === "missing" || over.length === 0) return null;
  return (
    `Squeal policy complexity.blocking is on and ${plural(over.length, "function")} ` +
    `went over the complexity threshold ${complexity.threshold} since this session started: ` +
    `${listPaths(over)}. \`${command} code --changed\` lists them.`
  );
}
