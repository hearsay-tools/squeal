import { isCodeStoreOpenFailure, openCodeStore } from "../code/store/index.js";
import type { CodeStore } from "../code/store/types.js";
import { readPolicy } from "../daemon/policy.js";
import { isBusy } from "../store/connection.js";
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

/**
 * The code store of the repository at `commonDir`, by the policy of the
 * worktree at `root`; `busyTimeoutMs` as the caller's main store, so a hook
 * keeps its budget.
 */
export function codeSource(
  commonDir: AbsolutePath,
  root: AbsolutePath,
  { busyTimeoutMs }: { readonly busyTimeoutMs?: number } = {},
): CodeSource {
  const policy = () => {
    const { complexity } = readPolicy(root);
    return complexity.enabled ? complexity : null;
  };
  return {
    policy,
    open() {
      const complexity = policy();
      if (complexity === null) return null;
      const store = openCodeStore(
        commonDir,
        { complexity },
        { create: false, ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs }) },
      );
      if (!isCodeStoreOpenFailure(store)) return { store, complexity };
      return store.reason === "missing" ? "missing" : null;
    },
  };
}

/**
 * Runs `fn` on the open code store and closes it; `missing` and `null` as
 * `CodeSource.open`. A store busy past its timeout is `null` too: the code
 * part waits for the next delivery rather than fail or stall the caller.
 */
export function withCode<T>(
  source: CodeSource | undefined,
  fn: (access: CodeAccess) => T,
): T | "missing" | null {
  let access: ReturnType<CodeSource["open"]> = null;
  try {
    access = source?.open() ?? null;
    if (access === null || access === "missing") return access;
    return fn(access);
  } catch (error) {
    if (isBusy(error)) return null;
    throw error;
  } finally {
    if (access !== null && access !== "missing") access.store.close();
  }
}
