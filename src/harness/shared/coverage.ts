import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { readPolicy } from "../../core/daemon/policy.js";
import { slowPolicyView } from "../../core/state/index.js";
import type { HookContext } from "./context.js";

/**
 * What Squeal covers in one worktree, for the primer to list (task 001-234):
 * read from `squeal.config.json` and the runner's own discovery, the test
 * files the daemon listed into the store.
 */
export interface Coverage {
  /** The config file Vitest finds at the root, as Vitest looks for it; `null` without one. */
  readonly vitestConfig: string | null;
  /** Named Vitest projects among the listed test files, sorted; empty for one unnamed project. */
  readonly vitestProjects: readonly string[];
  /** Each `nodeTest` project: its name and its include globs, relative to the root. */
  readonly nodeTest: readonly { readonly name: string; readonly include: readonly string[] }[];
  /**
   * `null` without slow files declared (spec 004 D1); otherwise how many
   * listed test files are slow, `null` while no test file is listed yet.
   */
  readonly slow: { readonly files: number | null } | null;
}

/** A Vitest-only repository whose files are not listed yet: what `PRIMER` says. */
export const VITEST_ONLY: Coverage = {
  vitestConfig: null,
  vitestProjects: [],
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
  const vitestProjects = new Set<string>();
  for (const { testFile } of keys) {
    if (testFile.project !== "" && !nodeTestNames.has(testFile.project)) {
      vitestProjects.add(testFile.project);
    }
  }
  const view = slowPolicyView(policy);
  return {
    vitestConfig: vitestConfig(context.root),
    vitestProjects: [...vitestProjects].sort(),
    nodeTest: policy.nodeTest.map(({ name, cwd, include }) => ({
      name,
      include: include.map((glob) => (cwd === undefined ? glob : posix.join(cwd, glob))),
    })),
    slow:
      view === null
        ? null
        : {
            files:
              keys.length === 0 ? null : keys.filter((row) => view.isSlow(row.testFile)).length,
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
