import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { main } from "../../../src/cli/main.js";
import { readPolicy } from "../../../src/core/daemon/policy.js";
import { createDelivery } from "../../../src/core/delivery/delivery.js";
import { lintPauseIn } from "../../../src/core/lint/pass/idle.js";
import type { LintPassOptions } from "../../../src/core/lint/pass/types.js";
import { lintStoreSource } from "../../../src/core/lint/surface/source.js";
import type { Consumer } from "../../../src/core/types/delivery.js";
import type { ResultRecord } from "../../../src/core/types/store-records.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { type SquealRepo, squealRepo } from "../../harness/helpers.js";
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

/** A harness test's repository: the hooks read it, the real lint pass writes its lint store. */
export interface HookedRepo {
  readonly r: SquealRepo;
  /** The tree the lint pass reads. */
  readonly tree: FakeWorktree;
  /**
   * Writes `changed`, stores one revision of them with the tests' `results`,
   * and runs the lint pass to its end.
   */
  edit(changed: Record<string, string>, ...results: ResultRecord[]): Promise<void>;
  /** Writes `changed` and stores one revision of them; the lint pass has not run on it. */
  write(changed: Record<string, string>, ...results: ResultRecord[]): void;
  /** Runs the lint pass to its end with no new revision. */
  settle(): Promise<void>;
}

/**
 * A `squealRepo` whose `lint` policy is `lint`, with `files` linted once at
 * revision 1, for the harnesses' hooks: the tree's and the main store's
 * revisions move together. `policy` adds keys to `squeal.config.json`;
 * with it the pass reads that file's policy and the agent's pause from the
 * main store (`lintPauseIn`, row 019-45). `eslint` is the ESLint pass's
 * provider; with `oxlint`, an oxlint pass runs beside it (017 D11).
 */
export async function hookedRepo(
  files: Record<string, string>,
  lint: object,
  policy?: object,
  providers: { readonly eslint?: FakeProvider; readonly oxlint?: FakeProvider } = {},
): Promise<HookedRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  writeFileSync(join(r.root, "squeal.config.json"), JSON.stringify({ lint, ...policy }));
  const tree = new FakeWorktree(r.worktreeId, r.repo.commonDir).write(
    "eslint.config.js",
    "export default [];\n",
  );
  if (providers.oxlint !== undefined) tree.write(".oxlintrc.json", "{}\n");
  for (const [path, text] of Object.entries(files)) tree.write(path, text);
  tree.revise();
  const over: Partial<LintPassOptions> =
    policy === undefined
      ? {}
      : {
          policy: () => readPolicy(r.root),
          pauseIn: lintPauseIn({ store: r.store, worktreeId: r.worktreeId, now: Date.now }),
        };
  const eslint = await lintOver(tree, providers.eslint ?? new FakeProvider(), over);
  const oxlint =
    providers.oxlint === undefined
      ? null
      : await lintOver(tree, providers.oxlint, { ...over, tool: "oxlint" });
  const settle = async () => {
    await eslint.settle();
    await oxlint?.settle();
  };
  const write = (changed: Record<string, string>, ...results: ResultRecord[]) => {
    for (const [path, text] of Object.entries(changed)) tree.write(path, text);
    tree.revise();
    r.apply(...results);
  };
  return {
    r,
    tree,
    write,
    settle,
    async edit(changed, ...results) {
      write(changed, ...results);
      await settle();
    },
  };
}
