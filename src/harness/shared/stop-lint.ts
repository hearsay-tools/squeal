import { codeSeenUpTo } from "../../core/delivery/code-since.js";
import { SQUEAL_COMMAND } from "../../core/delivery/index.js";
import { lintStop } from "../../core/lint/surface/report.js";
import { lintStoreSource } from "../../core/lint/surface/source.js";
import { listPaths, plural } from "../../core/text.js";
import type { HookContext } from "./context.js";

/**
 * Spec 017 D8 Blocking: with `lint.blocking` on, Stop's completion check
 * (011 C8) also counts each file that went to `fail` in the consumer's own
 * revisions and fails at its current key, as 015 D7 does for complexity;
 * one failing at registration, pending, stale or unknown never blocks.
 * A lint failure never denies a tool call and never counts in `Known
 * failures`. No reason while lint or its key is off, or none went to fail.
 */
export function lintStopReasons(context: HookContext, command: string = SQUEAL_COMMAND): string[] {
  const source = context.lint ?? lintStoreSource(context.commonDir, context.root);
  const since = codeSeenUpTo(context.store, context.consumer);
  const evidence = lintStop(source, context.consumer.worktreeId, since);
  if (evidence === null || evidence.files.length === 0) return [];
  const files = evidence.files.map((f) =>
    f.findings === null ? f.path : `${f.path} (${plural(f.findings, "finding")})`,
  );
  return [
    `Squeal policy lint.blocking is on and ${plural(files.length, "file")} went to fail lint ` +
      `since this session started: ${listPaths(files)}. \`${command} lint --changed\` lists them.`,
  ];
}
