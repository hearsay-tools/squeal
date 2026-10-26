import { afterEach } from "vitest";
import type { CodeBound } from "../../../src/core/delivery/code-delta.js";
import { type LintStoreSource, openForReading } from "../../../src/core/lint/surface/source.js";
import type { Consumer, Policy } from "../../../src/core/types/index.js";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider, lintPass, lintTree, storeOf } from "../pass/helpers.js";

const passes: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const pass of passes.splice(0)) await pass.close();
});

/** The lint store of `tree` as the surfaces read it, by `policy`; never created by them. */
export function sourceOf(
  tree: FakeWorktree,
  policy: () => Policy = () => LINT_ON,
): LintStoreSource {
  return {
    policy: () => (policy().lint.enabled ? policy().lint : null),
    open: () => openForReading(tree.commonDir, policy().lint, 10_000),
  };
}

export function consumer(tree: FakeWorktree, sessionId = "s1", agentId = "main"): Consumer {
  return { worktreeId: tree.id, sessionId, agentId };
}

/** The revisions after `since` are the consumer's own. */
export const after = (since: number): CodeBound => ({ since, gaps: [] });

/**
 * A worktree with an ESLint config and `files`, the real lint pass over it
 * with the fake provider (each line `bad <rule>` is a finding of `<rule>`,
 * message `<rule> found`), its first pass run. `revise` stores a revision
 * of what was written and runs the pass to its end.
 */
export async function lintRig(
  files: Record<string, string>,
  over: { provider?: FakeProvider } = {},
) {
  const tree = lintTree();
  for (const [path, text] of Object.entries(files)) tree.write(path, text);
  tree.revise();
  const provider = over.provider ?? new FakeProvider();
  const run = lintPass(tree, provider);
  passes.push(run.pass);
  const settle = async () => {
    run.pass.nudge();
    await run.pass.idle();
  };
  await settle();
  const revise = async (): Promise<number> => {
    const revision = tree.revise();
    await settle();
    return revision;
  };
  return { tree, provider, ...run, settle, revise, source: sourceOf(tree), store: storeOf(tree) };
}

/** A news entry as `kind path +rule -rule`. */
export function said(entry: {
  readonly path: string;
  readonly kind: string;
  readonly added: readonly { readonly rule: string | null }[];
  readonly removed: readonly { readonly rule: string | null }[];
}): string {
  const rules = (sign: string, list: readonly { readonly rule: string | null }[]) =>
    list.map((f) => ` ${sign}${f.rule ?? "fatal"}`).join("");
  return `${entry.kind} ${entry.path}${rules("+", entry.added)}${rules("-", entry.removed)}`;
}
