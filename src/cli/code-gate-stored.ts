import { coverageOn, coverageProvider } from "../core/code/coverage/runtime.js";
import { type CollectOptions, collectEvidence } from "../core/code/gate/collect.js";
import { openStored, type StoredFiles } from "../core/code/gate/stored.js";
import type { ChangedSet, Evidence } from "../core/code/gate/types.js";
import { readPolicy } from "../core/daemon/policy.js";
import { vitestDetected } from "../core/daemon/runner.js";
import { squealVersion } from "../core/daemon/version.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { Policy } from "../core/types/policy.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { createNodeTestAdapter } from "../runners/node-test/adapter.js";
import { createVitestAdapter } from "../runners/vitest/index.js";

/*
 * Spec 020 D11.7 (row 020-07c): what `squeal code --base` reads of the
 * stores, keyed by the adapters a daemon builds in this worktree
 * (`daemon.ts`). They are not the gate's own run adapters: a daemon's Vitest
 * observes runtime inputs, and its adapter version, which keys every file,
 * says so.
 */

/**
 * D3's evidence of `changed`, each selected file with results and a record
 * at its key read from the stores instead of run; how many were is told
 * through `options.note`. The keys hold `options.children`, the base's
 * `coverage.children`, so a record collected otherwise is never read. The
 * stores close before it resolves.
 */
export async function collectWithStores(
  root: AbsolutePath,
  env: NodeJS.ProcessEnv,
  changed: ChangedSet,
  options: CollectOptions,
): Promise<Evidence> {
  const note = options.note ?? (() => {});
  const stored = storedFiles(root, env, note, options.children === true);
  try {
    const evidence = await collectEvidence(root, changed, {
      ...options,
      ...(stored === null ? {} : { stored: stored.stored }),
    });
    const fromStore = evidence.testFiles.filter((f) => f.fromStore === true).length;
    if (fromStore > 0) {
      note(`${fromStore} of ${evidence.testFiles.length} selected test files read from the stores`);
    }
    return evidence;
  } finally {
    await stored?.close();
  }
}

/**
 * The stores of `root`'s repository, read-only, keyed as its daemon keys
 * with `coverage.children` as `children` says; `null` when there is none,
 * or when the worktree's policy has coverage off, so no daemon here stored
 * a record. Spec 020 D12.5: the key's coverage marker holds the key, so a
 * branch that turns children on in its own config cannot have its records
 * read where the base keeps them off (the coordinator, request 35b31f66).
 */
export function storedFiles(
  root: AbsolutePath,
  env: NodeJS.ProcessEnv,
  note: (text: string) => void,
  children = false,
): StoredFiles | null {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  const worktree = readPolicy(root);
  if (!coverageOn(worktree)) return null;
  const policy: Policy = { ...worktree, coverage: { ...worktree.coverage, children } };
  return openStored({
    root,
    commonDir,
    policy,
    squealVersion: squealVersion(),
    env,
    adapters: (tempDir) => daemonAdapters(root, policy, tempDir),
    note,
  });
}

/**
 * The adapters a daemon builds in `root` under `policy`, as far as they key:
 * Vitest's when it would run Vitest, observing as policy says, with Squeal's
 * coverage provider; then one per `nodeTest` project. Neither runs a test
 * here, and Vitest writes no results cache.
 */
export async function daemonAdapters(
  root: AbsolutePath,
  policy: Policy,
  tempDir: AbsolutePath,
): Promise<RunnerAdapter[]> {
  const provider = coverageProvider();
  const coverage = {
    enabled: () => coverageOn(policy),
    children: () => policy.coverage.children,
    collected: () => {},
  };
  const adapters: RunnerAdapter[] = [];
  try {
    if (policy.nodeTest.length + policy.pytest.length === 0 || vitestDetected(root)) {
      const vitest = await createVitestAdapter({
        root,
        observe: () => policy.observe.runtimeInputs,
        excludeProjects: () => policy.vitest.excludeProjects,
        exclude: () => policy.vitest.exclude,
        cache: false,
        ...(provider === null ? {} : { coverage: { ...coverage, provider, tempDir } }),
      });
      adapters.push(vitest);
    }
    for (const project of policy.nodeTest) {
      const nodeTest = await createNodeTestAdapter(project, {
        root,
        concurrency: () => policy.runner.tierSize,
        inputs: () => policy.inputs,
        tempDir,
        coverage,
      });
      adapters.push(nodeTest);
    }
    return adapters;
  } catch (error) {
    await Promise.allSettled(adapters.map((a) => a.close()));
    throw error;
  }
}
