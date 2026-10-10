import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { readPolicy } from "../../core/daemon/policy.js";
import { vitestDetected } from "../../core/daemon/runner.js";
import { slowPolicyView } from "../../core/state/index.js";
import type { HookContext } from "./context.js";

/**
 * What Squeal covers in one worktree, for the primer to list (task 001-234):
 * the runners the daemon builds, read from `squeal.config.json` and the root
 * as the daemon reads them, and the slow files among the test files the
 * daemon last listed into the store.
 *
 * Review wave 13aa, B2: a key row does not say which runner listed it, and a
 * restarted daemon's previous rows stay until its own listing commits, so no
 * runner's project is named from the rows.
 */
export interface Coverage {
  /**
   * Whether the daemon builds a Vitest runner here, by its own rule (spec 003
   * D7): Vitest detected at the root, or no node:test project configured.
   */
  readonly vitest: boolean;
  /** The config file Vitest finds at the root, as Vitest looks for it; `null` without one. */
  readonly vitestConfig: string | null;
  /** Each `nodeTest` project: its name and its include globs, relative to the root. */
  readonly nodeTest: readonly { readonly name: string; readonly include: readonly string[] }[];
  /**
   * `null` without slow files declared (spec 004 D1); otherwise how many test
   * files the daemon last listed are slow, `null` while it has listed none.
   */
  readonly slow: { readonly files: number | null } | null;
}

/** A Vitest-only repository whose files are not listed yet: what `PRIMER` says. */
export const VITEST_ONLY: Coverage = {
  vitest: true,
  vitestConfig: null,
  nodeTest: [],
  slow: null,
};

/** Vitest's own config lookup at the root: these names, in this order, each with these extensions. */
const CONFIG_NAMES = ["vitest.config", "vite.config"];
const CONFIG_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** The coverage of the worktree `context` hooks into. One read of its key rows, none of its files. */
export function coverageOf(context: HookContext): Coverage {
  const policy = readPolicy(context.root);
  const keys = context.store.testFileKeys.list(context.consumer.worktreeId);
  const nodeTestNames = new Set(policy.nodeTest.map((project) => project.name));
  const vitest = policy.nodeTest.length === 0 || vitestDetected(context.root);
  // A row no runner built here could have listed is not counted: without Vitest, only node:test's.
  const listed = vitest ? keys : keys.filter((row) => nodeTestNames.has(row.testFile.project));
  const view = slowPolicyView(policy);
  return {
    vitest,
    vitestConfig: vitest ? vitestConfig(context.root) : null,
    nodeTest: policy.nodeTest.map(({ name, cwd, include }) => ({
      name,
      include: include.map((glob) => (cwd === undefined ? glob : posix.join(cwd, glob))),
    })),
    slow:
      view === null
        ? null
        : {
            files:
              keys.length === 0 ? null : listed.filter((row) => view.isSlow(row.testFile)).length,
          },
  };
}

function vitestConfig(root: string): string | null {
  for (const name of CONFIG_NAMES) {
    for (const extension of CONFIG_EXTENSIONS) {
      if (existsSync(join(root, `${name}${extension}`))) return `${name}${extension}`;
    }
  }
  return null;
}
