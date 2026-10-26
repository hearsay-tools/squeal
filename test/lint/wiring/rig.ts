import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { main } from "../../../src/cli/main.js";
import { createDelivery } from "../../../src/core/delivery/index.js";
import type { LintPassOptions } from "../../../src/core/lint/pass/index.js";
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

/**
 * The real lint pass over `tree` with the fake provider (each line `bad
 * <rule>` is a finding of `<rule>`, message `<rule> found`), closed after the
 * test; `settle` runs it to its end. `over` sets the pass's other options.
 */
export async function lintOver(
  tree: FakeWorktree,
  provider = new FakeProvider(),
  over: Partial<LintPassOptions> = {},
) {
  const run = lintPass(tree, provider, over);
  passes.push(run.pass);
  const settle = async () => {
    run.pass.nudge();
    await run.pass.idle();
  };
  await settle();
  return { provider, settle };
}

/** The policy a rig writes: lint on, every other feature as `seed` leaves it. */
export const LINT_POLICY = { lint: { enabled: true } };

export interface WiredRig extends Seeded {
  readonly tree: FakeWorktree;
  readonly provider: FakeProvider;
  /** Writes `files` with no revision yet: an edit the daemon has not recorded. */
  write(path: string, text: string): void;
  /** Writes `files`, stores one revision of them in both stores, and runs the lint pass to its end. */
  edit(files: Record<string, string>): Promise<number>;
  /** Runs the lint pass to its end with no new revision. */
  settle(): Promise<void>;
  consumer(sessionId?: string): Consumer;
}

/**
 * A repository with an ESLint config and `files`, its first lint pass run
 * at revision 1 (`lintOver`). `policy` is `squeal.config.json`;
 * `alive` false leaves no daemon record; `provider` is set before the first pass;
 * `idleIn` is the pass's wait for the agent to be idle.
 */
export async function wiredRig(
  files: Record<string, string>,
  {
    policy = LINT_POLICY as object,
    alive = true,
    provider: fake = new FakeProvider(),
    idleIn,
  }: {
    readonly policy?: object;
    readonly alive?: boolean;
    readonly provider?: FakeProvider;
    readonly idleIn?: () => number;
  } = {},
): Promise<WiredRig> {
  const s = seed(policy, { revisions: 1, changes: Object.keys(files), alive });
  const tree = new FakeWorktree(s.repo.mainId, s.repo.commonDir).write(
    "eslint.config.js",
    "export default [];\n",
  );
  // The pass reads the tree's root; `squeal lint` reads the worktree's: both hold each write.
  const write = (path: string, text: string) => {
    tree.write(path, text);
    mkdirSync(dirname(join(s.repo.main, path)), { recursive: true });
    writeFileSync(join(s.repo.main, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  tree.revise();
  const { provider, settle } = await lintOver(tree, fake, idleIn === undefined ? {} : { idleIn });
  return {
    ...s,
    tree,
    provider,
    settle,
    write,
    async edit(changed) {
      for (const [path, text] of Object.entries(changed)) write(path, text);
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

/** `squeal lint` with `args` in `cwd`: its exit code, stdout and stderr. */
export async function runLint(cwd: string, args: string[], env: Record<string, string> = {}) {
  let out = "";
  let err = "";
  const code = await main(["lint", ...args], {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    cwd,
    env,
    now: () => NOW,
  });
  return { code, out, err };
}
