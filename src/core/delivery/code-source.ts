import { isCodeStoreOpenFailure, openCodeStore } from "../code/store/index.js";
import type { CodeStore } from "../code/store/types.js";
import { readPolicy } from "../daemon/policy.js";
import type { AbsolutePath, Policy } from "../types/index.js";
import { notMeasuredNames } from "./code-runners.js";
import { HoldingConnection } from "./held-connection.js";
import type { CodeHolds } from "./prepared.js";

/*
 * Spec 015 D4, D6: where a delivery, status and `squeal code` read the code
 * store from. Readers never create it, and while `complexity.enabled` is off
 * nothing is opened or read, so every payload stays as it was (goal 1).
 */

/** An open code store with the complexity keys it is judged by. The caller closes it. */
export interface CodeAccess {
  readonly store: CodeStore;
  readonly complexity: Policy["complexity"];
  /** Row 011-288: the store's connection, when the source opens it to hold a delivery's write. */
  readonly connection?: HoldingConnection;
}

/** Opens the code store per call; `null` while the policy is off or the store cannot be opened. */
export interface CodeSource {
  /** The complexity keys now; `null` while `complexity.enabled` is off. */
  policy(): Policy["complexity"] | null;
  /** `missing` while the policy is on and no daemon has made the store yet. */
  open(): CodeAccess | "missing" | null;
  /**
   * Row 015-75: while coverage is on, the names of the configured runners
   * whose runs give no coverage records (`notMeasuredNames`); absent, none.
   */
  notMeasured?(): readonly string[];
}

/**
 * The code store of the repository at `commonDir`, by the policy of the
 * worktree at `root`; `busyTimeoutMs` as the caller's main store, so a hook
 * keeps its budget. With `holding`, each store opens on a
 * `HoldingConnection`, so a delivery can hold its code write until its
 * report's verdict (row 011-288).
 */
export function codeSource(
  commonDir: AbsolutePath,
  root: AbsolutePath,
  {
    busyTimeoutMs,
    holding = false,
  }: { readonly busyTimeoutMs?: number; readonly holding?: boolean } = {},
): CodeSource {
  const policy = () => {
    const { complexity } = readPolicy(root);
    return complexity.enabled ? complexity : null;
  };
  return {
    policy,
    notMeasured: () => notMeasuredNames(readPolicy(root)),
    open() {
      const complexity = policy();
      if (complexity === null) return null;
      let connection: HoldingConnection | undefined;
      const store = openCodeStore(
        commonDir,
        { complexity },
        {
          create: false,
          ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs }),
          ...(holding ? { connection: (db) => (connection = new HoldingConnection(db)) } : {}),
        },
      );
      if (!isCodeStoreOpenFailure(store)) {
        return { store, complexity, ...(connection === undefined ? {} : { connection }) };
      }
      return store.reason === "missing" ? "missing" : null;
    },
  };
}

/**
 * Runs `fn` on the open code store and closes it; `missing` and `null` as
 * `CodeSource.open`. Any failure in the operation is `null` too: a store
 * busy past its timeout, a page corrupt past a successful open, a damaged
 * row. Only the code part is lost, so the test channel's status,
 * registration, delivery and Stop stay as they are without code (011 C8,
 * C13; review 0.1.283 B1). A write `fn` makes in a transaction is rolled
 * back with it; no integrity scan runs here. A store whose write `fn` left
 * held (`heldWrite`) stays open: the hold's end closes it (row 011-288).
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
  } catch {
    return null;
  } finally {
    if (access !== null && access !== "missing" && access.connection?.held !== true) {
      access.store.close();
    }
  }
}

/**
 * Row 011-288: `fn` in `access.store.transaction`, or, given `holds` and a
 * holding connection, in a transaction left open and added to `holds`, so
 * the code a report tells is recorded as told only with the report. The
 * hold's end closes the store.
 */
export function heldWrite<T>(access: CodeAccess, fn: () => T, holds: CodeHolds | undefined): T {
  const held = holds === undefined ? null : (access.connection?.hold() ?? null);
  if (held === null || holds === undefined) return access.store.transaction(fn);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    held.rollback();
    throw error;
  }
  const close = () => access.store.close();
  holds.push({
    commit: () => {
      try {
        held.commit();
      } finally {
        close();
      }
    },
    rollback: () => {
      try {
        held.rollback();
      } finally {
        close();
      }
    },
  });
  return result;
}
