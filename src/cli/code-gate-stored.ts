import type { NamedPart } from "../core/ci/export-check.js";
import { coverageOn, coverageProvider } from "../core/code/coverage/runtime.js";
import {
  type CollectOptions,
  collectEvidence,
  type StoredEvidence,
} from "../core/code/gate/collect.js";
import { partsEvidence } from "../core/code/gate/parts.js";
import { openStored, type StoredFiles } from "../core/code/gate/stored.js";
import type { ChangedSet, Evidence, TestFileEvidence } from "../core/code/gate/types.js";
import { readPolicy } from "../core/daemon/policy.js";
import { runsVitest } from "../core/daemon/runner.js";
import { squealVersion } from "../core/daemon/version.js";
import { daemonVitestOptions } from "../core/daemon/vitest-options.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { createNodeTestAdapter } from "../runners/node-test/adapter.js";
import { createVitestAdapter } from "../runners/vitest/index.js";
import { OBSERVED_ADAPTER_SUFFIX } from "../runners/vitest/observe.js";

/*
 * Spec 020 D11.7 (row 020-07c): what `squeal code --base` reads of the
 * stores, after what it takes from `--parts` (D13.2, row 020-08b). The
 * stores are keyed by the adapters a daemon builds in this worktree
 * (`daemon.ts`). They are not the gate's own run adapters: a daemon's
 * Vitest observes runtime inputs, and its adapter version, which keys
 * every file, says so.
 */

/**
 * D3's evidence of `changed`: each selected file `parts` certify taken
 * from them, in the environment the gate's runner has (D13.2), then each
 * with results and a record at its key read from the stores (D11.7), and
 * every other file run, each it completes kept in the stores at its key
 * (D17.3); how many came from each is told through `options.note`. The keys hold
 * `options.children`, the base's `coverage.children`, so a record
 * collected otherwise is never read. The stores close before it resolves.
 */
export async function collectWithStores(
  root: AbsolutePath,
  env: NodeJS.ProcessEnv,
  changed: ChangedSet,
  options: CollectOptions,
  parts: readonly NamedPart[] = [],
): Promise<Evidence> {
  const note = options.note ?? (() => {});
  const children = options.children === true;
  const fromParts =
    parts.length === 0
      ? undefined
      : partsEvidence({
          root,
          parts,
          changed: changed.paths,
          children,
          // D13.2: the gate's runs see `env`; the allow-list is this worktree's, as `ci record` reads it.
          environment: {
            env,
            allowlist: readPolicy(root).env.allowlist,
            observedSuffix: OBSERVED_ADAPTER_SUFFIX,
          },
          note,
        });
  const stored = storedFiles(root, env, note, children);
  try {
    const known = inOrder([fromParts, stored?.stored]);
    const evidence = await collectEvidence(root, changed, {
      ...options,
      ...(known === null ? {} : { stored: known }),
      // D17.3: each file a run completes is kept at its key, for the next run and a daemon.
      ...(stored === null ? {} : { ran: stored.ran }),
    });
    const selected = evidence.testFiles.length;
    for (const [from, where] of [
      ["parts", "the parts"],
      ["store", "the stores"],
    ] as const) {
      const read = evidence.testFiles.filter((f) => f.from === from).length;
      if (read > 0) note(`${read} of ${selected} selected test files read from ${where}`);
    }
    return evidence;
  } finally {
    await stored?.close();
  }
}

/**
 * D13.2's order: each file from the first of `sources` that gives its
 * evidence, the parts before the stores; `null` when none is given.
 */
function inOrder(sources: readonly (StoredEvidence | undefined)[]): StoredEvidence | null {
  const given = sources.filter((s): s is StoredEvidence => s !== undefined);
  if (given.length === 0) return null;
  return async (runner, files, closure, environment) => {
    const found = new Map<TestFileRef, TestFileEvidence>();
    for (const source of given) {
      const left = files.filter((ref) => !found.has(ref));
      if (left.length === 0) break;
      const known = await source(runner, left, closure, environment);
      for (const [ref, evidence] of known) found.set(ref, evidence);
    }
    return found;
  };
}

/**
 * The stores of `root`'s repository, keyed as its daemon keys with
 * `coverage.children` as `children` says, read-only until a run is kept
 * (D17.3); `null` outside a repository, when a store cannot be read as
 * this Squeal's, or when the worktree's policy has coverage off, so no
 * daemon here stores a record and the gate's runs are not its runs. Spec 020 D12.5: the key's coverage marker holds the key, so a
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
 * Vitest's when it would run Vitest (`runsVitest`), with the daemon's options;
 * then one per `nodeTest` project. Neither runs a test here, and Vitest writes
 * no results cache.
 */
export async function daemonAdapters(
  root: AbsolutePath,
  policy: Policy,
  tempDir: AbsolutePath,
): Promise<RunnerAdapter[]> {
  const coverage = {
    enabled: () => coverageOn(policy),
    children: () => policy.coverage.children,
    collected: () => {},
  };
  const adapters: RunnerAdapter[] = [];
  try {
    if (runsVitest(root, policy)) {
      const options = daemonVitestOptions({
        root,
        policy: () => policy,
        provider: coverageProvider(),
        tempDir,
      });
      adapters.push(await createVitestAdapter({ ...options, cache: false }));
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
