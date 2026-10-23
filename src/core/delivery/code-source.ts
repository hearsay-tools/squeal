import { isCodeStoreOpenFailure, openCodeStore } from "../code/store/index.js";
import type { CodeStore } from "../code/store/types.js";
import { readPolicy } from "../daemon/policy.js";
import type { AbsolutePath, Policy } from "../types/index.js";

/*
 * Spec 015 D4, D6: where a delivery, status and `squeal code` read the code
 * store from. Readers never create it, and while `complexity.enabled` is off
 * nothing is opened or read, so every payload stays as it was (goal 1).
 */

/** An open code store with the complexity keys it is judged by. The caller closes it. */
export interface CodeAccess {
  readonly store: CodeStore;
  readonly complexity: Policy["complexity"];
}

/** Opens the code store per call; `null` while the policy is off or the store cannot be opened. */
export interface CodeSource {
  /** The complexity keys now; `null` while `complexity.enabled` is off. */
  policy(): Policy["complexity"] | null;
  /** `missing` while the policy is on and no daemon has made the store yet. */
  open(): CodeAccess | "missing" | null;
}

/** The code store of the repository at `commonDir`, by the policy of the worktree at `root`. */
export function codeSource(commonDir: AbsolutePath, root: AbsolutePath): CodeSource {
  const policy = () => {
    const { complexity } = readPolicy(root);
    return complexity.enabled ? complexity : null;
  };
  return {
    policy,
    open() {
      const complexity = policy();
      if (complexity === null) return null;
      const store = openCodeStore(commonDir, { complexity }, { create: false });
      if (!isCodeStoreOpenFailure(store)) return { store, complexity };
      return store.reason === "missing" ? "missing" : null;
    },
  };
}

/** Runs `fn` on the open code store and closes it; `missing` and `null` as `CodeSource.open`. */
export function withCode<T>(
  source: CodeSource | undefined,
  fn: (access: CodeAccess) => T,
): T | "missing" | null {
  const access = source?.open() ?? null;
  if (access === null || access === "missing") return access;
  try {
    return fn(access);
  } finally {
    access.store.close();
  }
}
