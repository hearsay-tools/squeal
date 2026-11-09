import { join } from "node:path";
import { onTestFinished } from "vitest";
import { publishExport } from "../../src/core/ci/publish.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { createSharedReader, type SharedReaderOptions } from "../../src/core/shared/reader.js";
import { listImports } from "../../src/core/store/imports.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { exportOf, type Scratch, scratchRemote } from "./remote.js";

/*
 * Spec 018 D14 (row 018-20): what the reader's tests share. Each test's
 * scratch remote, store and reader close when it finishes, the last made
 * first.
 */

/** A scratch bare repository, removed when the test finishes. */
export function scratch(): Scratch {
  const s = scratchRemote();
  onTestFinished(s.cleanup);
  return s;
}

export const shared = (ref: string | null): (() => Policy) => {
  const policy = { ...DEFAULT_POLICY, shared: { ref } };
  return () => policy;
};

/** Publishes `commit`'s export from the checkout `ci` under `refs/squeal`: the results commit. */
export async function publish(
  ci: string,
  commit: string,
  bytes = exportOf(commit),
): Promise<string> {
  const done = await publishExport({
    root: ci,
    bytes,
    keep: 100,
    remote: "origin",
    prefix: "refs/squeal",
  });
  if ("refused" in done) throw new Error(done.refused);
  return done.result;
}

export function storeOf(root: string): Store {
  const store = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  onTestFinished(() => store.close());
  return store;
}

/** A reader of `root` with `shared.ref` `refs/squeal` unless `options` say otherwise. */
export function readerOf(root: string, options: Partial<SharedReaderOptions> = {}) {
  const notes: string[] = [];
  let imported = 0;
  const store = options.store ?? storeOf(root);
  const reader = createSharedReader({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    policy: shared("refs/squeal"),
    now: () => 1_762_100_000_000,
    note: (text) => notes.push(text),
    log: () => {},
    imported: () => {
      imported += 1;
    },
    ...options,
  });
  onTestFinished(() => reader.close());
  const run = async () => {
    reader.nudge();
    await reader.idle();
  };
  const commits = () => listImports(store).map((i) => i.header.commit);
  return { reader, run, notes, store, commits, imported: () => imported };
}
