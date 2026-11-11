import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../daemon/policy.js";
import { runGit } from "../../fs/git.js";
import type { AbsolutePath } from "../../types/common.js";
import { type BasePrepares, preparesOf } from "./prepare.js";
import { readScope, type ScopeBase } from "./scope.js";
import type { GatePolicy } from "./types.js";

/*
 * Spec 020 D6: the gate's policy is read at the base commit, so a branch
 * cannot loosen its own gate. The keys are 015's; the `enabled` keys are not
 * read (D1). D12.1: so is `coverage.children`, so a branch cannot change how
 * its own evidence is collected.
 */

/** D6: the gate's policy and the keys D2 counts by, all read at the base commit. */
export interface BasePolicy extends GatePolicy {
  /** `complexity.include`: the files counted. */
  readonly include: readonly string[];
  /** `complexity.exclude`: removed from `include`. */
  readonly exclude: readonly string[];
  /** `complexity.maxFileBytes`: a larger file is not counted. */
  readonly maxFileBytes: number;
  /**
   * D12.1: `coverage.children`, the coverage of the processes and threads
   * the tests start is collected too. Read without `coverage.enabled`, which
   * the gate does not read: it always collects coverage (D1).
   */
  readonly children: boolean;
  /**
   * D14.1: the check groups and `gate.groups` at the base, which the scope
   * resolves from; absent, the default groups with no `gate.groups`.
   */
  readonly scope?: ScopeBase;
  /**
   * D15.2: the `prepare` of each `nodeTest` entry, by name, so a branch
   * cannot add a command and run it in the same change. Absent when no
   * entry has one.
   */
  readonly prepares?: BasePrepares;
}

/** The policy at the base and the loader's problems with that file (001 D11). */
export interface LoadedBasePolicy {
  readonly policy: BasePolicy;
  /** One line per unknown key, wrong type or unreadable file; empty when none. */
  readonly problems: readonly string[];
}

/**
 * Reads `squeal.config.json` as it is at `baseCommit`, relative to `cwd`,
 * with the one policy loader (`loadPolicy`): the defaults apply for a key
 * that is missing or wrong, and for every key when the file is absent there.
 * The working tree's file and the branch's commits are never read.
 */
export async function loadBasePolicy(
  cwd: AbsolutePath,
  baseCommit: string,
): Promise<LoadedBasePolicy> {
  const text = await fileAt(cwd, baseCommit, POLICY_FILE);
  // The loader reads a directory; the text goes to a scratch one under $TMPDIR.
  const scratch = mkdtempSync(join(tmpdir(), "squeal-gate-policy-"));
  try {
    if (text !== null) writeFileSync(join(scratch, POLICY_FILE), text);
    const { policy, problems } = loadPolicy(scratch);
    const { complexity, coverage, crap } = policy;
    const scope = readScope(policy);
    const prepares = preparesOf(policy.nodeTest);
    return {
      policy: {
        complexityThreshold: complexity.threshold,
        crapThreshold: crap.threshold,
        coverageExclude: coverage.exclude,
        include: complexity.include,
        exclude: complexity.exclude,
        maxFileBytes: complexity.maxFileBytes,
        children: coverage.children,
        scope: scope.base,
        ...(prepares.size === 0 ? {} : { prepares }),
      },
      problems: [...problems, ...scope.problems],
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The text of `path` at `commit`, or `null` when no file is there. */
async function fileAt(cwd: AbsolutePath, commit: string, path: string): Promise<string | null> {
  // `./`: relative to `cwd`, which may sit below the repository's top.
  const out = await runGit(cwd, ["cat-file", "--batch"], { input: `${commit}:./${path}\n` });
  const header = out.slice(0, out.indexOf("\n"));
  if (!/^[0-9a-f]+ blob \d+$/.test(header)) return null;
  // One object: its bytes are everything between the header and git's closing line feed.
  return out.slice(header.length + 1, -1);
}
