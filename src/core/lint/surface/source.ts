import { readPolicy } from "../../daemon/policy.js";
import type { AbsolutePath, Policy } from "../../types/index.js";
import { isLintStoreOpenFailure, openLintStore } from "../store/index.js";
import type { LintStore, LintStoreOpenFailure } from "../store/types.js";

/*
 * Spec 017 D6, D8: where a delivery, status and `squeal lint` read the
 * lint store from, after 015's `code-source.ts`. Readers never create it,
 * and while `lint.enabled` is off nothing is opened or read, so every
 * payload stays as it was (goal 1).
 */

/** An open lint store with the lint keys it is read by. The caller closes it. */
export interface LintAccess {
  readonly store: LintStore;
  readonly lint: Policy["lint"];
}

/** The store cannot be read: why, in words for status. */
export interface LintUnreadable {
  readonly unreadable: string;
}

/** Opens the lint store per call. */
export interface LintStoreSource {
  /** The lint keys now; `null` while `lint.enabled` is off. */
  policy(): Policy["lint"] | null;
  /** `missing` while the policy is on and no daemon has made the store yet; `null` while it is off. */
  open(): LintAccess | "missing" | LintUnreadable | null;
}

/** What a failed open says in status. */
export function unreadableOf(failure: LintStoreOpenFailure): LintUnreadable | "missing" | null {
  switch (failure.reason) {
    case "off":
      return null;
    case "missing":
      return "missing";
    case "newer-schema":
      return {
        unreadable: `a newer Squeal made it (schema ${failure.found}; this one reads ${failure.supported})`,
      };
    case "corrupt":
      return { unreadable: `the file is damaged (${failure.error})` };
  }
}

/** The lint store at `commonDir` as `lint` reads it, opened for reading only. */
export function openForReading(
  commonDir: AbsolutePath,
  lint: Policy["lint"],
  busyTimeoutMs?: number,
): LintAccess | "missing" | LintUnreadable | null {
  if (!lint.enabled) return null;
  const store = openLintStore(
    commonDir,
    { lint },
    { create: false, ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs }) },
  );
  return isLintStoreOpenFailure(store) ? unreadableOf(store) : { store, lint };
}

/**
 * The lint store of the repository at `commonDir`, by the policy of the
 * worktree at `root`; `busyTimeoutMs` as the caller's main store, so a hook
 * keeps its budget.
 */
export function lintStoreSource(
  commonDir: AbsolutePath,
  root: AbsolutePath,
  { busyTimeoutMs }: { readonly busyTimeoutMs?: number } = {},
): LintStoreSource {
  const policy = () => {
    const { lint } = readPolicy(root);
    return lint.enabled ? lint : null;
  };
  return {
    policy,
    open() {
      const lint = policy();
      return lint === null ? null : openForReading(commonDir, lint, busyTimeoutMs);
    },
  };
}

/**
 * What `withLint` gave: `fn`'s value, or why the store was not read.
 * `missing`: the policy is on and no daemon has made the store yet. `off`:
 * the policy is off or no source is given. `failed`: the operation failed,
 * as a store busy past its timeout or a damaged row.
 */
export type LintRead<T> =
  | { readonly read: T }
  | { readonly closed: "missing" | "off" | "failed" }
  | { readonly closed: "unreadable"; readonly reason: string };

/**
 * Runs `fn` on the open lint store and closes it. A failure in the
 * operation loses only the lint part, so the test channel's status,
 * registration, delivery and Stop stay as they are without lint (011 C8,
 * C13; as `withCode`). A write `fn` makes in a transaction is rolled back
 * with it.
 */
export function withLint<T>(
  source: LintStoreSource | undefined,
  fn: (access: LintAccess) => T,
): LintRead<T> {
  let access: ReturnType<LintStoreSource["open"]> = null;
  try {
    access = source?.open() ?? null;
    if (access === null) return { closed: "off" };
    if (access === "missing") return { closed: "missing" };
    if ("unreadable" in access) return { closed: "unreadable", reason: access.unreadable };
    return { read: fn(access) };
  } catch {
    return { closed: "failed" };
  } finally {
    if (access !== null && access !== "missing" && "store" in access) access.store.close();
  }
}

/** `fn`'s value, or `null` when the store was not read. */
export const readOrNull = <T>(read: LintRead<T>): T | null => ("read" in read ? read.read : null);
