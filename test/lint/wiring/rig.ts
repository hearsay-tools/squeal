import { afterEach } from "vitest";
import { createDelivery } from "../../../src/core/delivery/index.js";
import { lintStoreSource } from "../../../src/core/lint/surface/source.js";
import type { Consumer } from "../../../src/core/types/index.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { NOW, revise, type Seeded, seed } from "../../status/slow-tier-seed.js";
import { FakeProvider, lintPass } from "../pass/helpers.js";

/*
 * Spec 017 D8: the real lint pass (017-05) over a fake provider, writing the
 * lint store of a repository whose main store `seed` made, so the shared
 * delivery, status and Stop read both as a session does. The tree's and the
 * main store's revisions move together.
 */

const passes: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const pass of passes.splice(0)) await pass.close();
});

/** The policy a rig writes: lint on, every other feature as `seed` leaves it. */
export const LINT_POLICY = { lint: { enabled: true } };

export interface WiredRig extends Seeded {
  readonly tree: FakeWorktree;
  readonly provider: FakeProvider;
  /** Writes `files`, stores one revision of them in both stores, and runs the lint pass to its end. */
  edit(files: Record<string, string>): Promise<number>;
  /** Runs the lint pass to its end with no new revision. */
  settle(): Promise<void>;
  consumer(sessionId?: string): Consumer;
}

/**
 * A repository with an ESLint config and `files`, its first lint pass run
 * at revision 1 (the fake provider: each line `bad <rule>` is a finding of
 * `<rule>`, message `<rule> found`). `policy` is `squeal.config.json`.
 */
export async function wiredRig(
  files: Record<string, string>,
  { policy = LINT_POLICY as object }: { readonly policy?: object } = {},
): Promise<WiredRig> {
  const s = seed(policy, { revisions: 1, changes: Object.keys(files) });
  const tree = new FakeWorktree(s.repo.mainId, s.repo.commonDir).write(
    "eslint.config.js",
    "export default [];\n",
  );
  for (const [path, text] of Object.entries(files)) tree.write(path, text);
  tree.revise();
  const provider = new FakeProvider();
  const run = lintPass(tree, provider);
  passes.push(run.pass);
  const settle = async () => {
    run.pass.nudge();
    await run.pass.idle();
  };
  await settle();
  return {
    ...s,
    tree,
    provider,
    settle,
    async edit(changed) {
      for (const [path, text] of Object.entries(changed)) tree.write(path, text);
      const revision = tree.revise();
      revise(s.store, s.repo, Object.keys(changed));
      await settle();
      return revision;
    },
    consumer: (sessionId = "s1") => ({ worktreeId: s.repo.mainId, sessionId, agentId: "main" }),
  };
}

/** The delivery a hook makes: the lint store read by the worktree's own policy. */
export function deliveryOf(rig: Seeded, { lint = true } = {}) {
  return createDelivery(rig.store, {
    status: fixedStatus(),
    now: () => NOW,
    ...(lint ? { lint: lintStoreSource(rig.repo.commonDir, rig.repo.main) } : {}),
  });
}
