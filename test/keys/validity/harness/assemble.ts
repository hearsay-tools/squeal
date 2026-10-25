import { appendFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import { readHead } from "../../../../src/core/daemon-loop/head.js";
import {
  createFsHasher,
  type Hasher,
  StatCache,
  seedStatCache,
} from "../../../../src/core/hash/index.js";
import { WorktreeKeys } from "../../../../src/core/scheduler/keying.js";
import { changedSince, snapshotInputs } from "../../../../src/core/scheduler/stability.js";
import type { RelativePath, WorktreeId } from "../../../../src/core/types/index.js";
import type { AssembleInput, CaseOutput } from "../case.js";
import { git, scratchStore, writeTree } from "./shared.js";

const WORKTREE = "validity-a" as WorktreeId;

/**
 * Each test file's closure and key as a daemon assembles them (011 C3): a
 * fixture repository with the case's policy, committed and untracked files,
 * keyed by the tree's `WorktreeKeys` over a store of its own schema, the
 * runner's closures given and one environment hash for the project. With
 * `after`, the keys after it too; with `stability`, what the stability check
 * then finds as outputs.
 */
export async function assemble(input: AssembleInput, scratch: string): Promise<CaseOutput> {
  const root = writeTree(join(scratch, "repo"), input.files);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  writeTree(root, input.untracked ?? {});
  const store = scratchStore(join(root, ".git"));
  try {
    if (input.cached !== undefined) {
      const cache = new StatCache();
      await seedStatCache(cache, root, input.cached, { objectFormat: "sha1" });
      store.transaction(() => cache.flush(store.fileHashes, WORKTREE));
    }
    rewrite(root, input.rewritten ?? {}, 60_000);
    const keys = new WorktreeKeys({
      root,
      worktreeId: WORKTREE,
      store,
      hasher: appending(createFsHasher(root, "sha1"), root, input.appendedAfterRead ?? {}),
      objectFormat: "sha1",
      policy: loadPolicy(root).policy,
      squealVersion: "0.0.0-validity",
      env: {},
      onExtraFiles: () => {},
    });
    await keys.bootstrap(() => readHead(root));
    if (input.environment === undefined) keys.index.setEnvironment("", "environment");
    else await keys.setEnvironments([input.environment]);
    // Spec 016 D3: the runner the keys name is the environment's. A tree before
    // `runnerOf` gives the environment's name, so both trees agree.
    const outputs = { runner: keys.runnerOf?.("") ?? input.environment?.runnerName ?? null };
    for (const { path, imports } of input.closures) {
      keys.setClosure({ testFile: { project: "", path }, paths: [...imports] });
    }
    await keys.trackUntracked();
    const paths = input.closures.map(({ path }) => path);
    const first = keysOf(keys, paths);
    const stable =
      input.stability === undefined
        ? {}
        : await stability(keys, root, input.closures, input.stability);
    if (input.after === undefined) return { keys: first, outputs: { ...outputs, ...stable } };
    for (const { path, imports } of input.after.closures) {
      keys.setClosure({ testFile: { project: "", path }, paths: [...imports] });
    }
    for (const path of input.after.removed) keys.removeTestFile({ project: "", path });
    await keys.trackUntracked();
    return { keys: { first, after: keysOf(keys, paths) }, outputs: { ...outputs, ...stable } };
  } finally {
    store.close();
  }
}

/** Writes `files` with an `mtime` `aheadMs` ahead, so each stat moves even where the bytes do not. */
function rewrite(root: string, files: Readonly<Record<string, string>>, aheadMs: number): void {
  writeTree(root, files);
  const later = new Date(Date.now() + aheadMs);
  for (const path of Object.keys(files)) utimesSync(join(root, path), later, later);
}

/** `hasher`, appending each of `appended` to its file once, right after the file's first read. */
function appending(
  hasher: Hasher,
  root: string,
  appended: Readonly<Record<string, string>>,
): Hasher {
  const pending = new Map(Object.entries(appended));
  return {
    ...hasher,
    hash: async (path) => {
      const hash = await hasher.hash(path);
      const text = pending.get(path);
      pending.delete(path);
      if (text !== undefined) appendFileSync(join(root, path), text);
      return hash;
    },
  };
}

/** The closures' paths snapshotted as keyed, `writes` made, then the stability check's findings. */
async function stability(
  keys: WorktreeKeys,
  root: string,
  closures: AssembleInput["closures"],
  writes: Readonly<Record<string, string>>,
): Promise<{ changed: string[]; touched: string[] }> {
  const paths = [...new Set(closures.flatMap((c) => [c.path, ...c.imports]))] as RelativePath[];
  const snapshot = snapshotInputs(keys.cache, paths);
  rewrite(root, writes, 120_000);
  const moved = await changedSince(snapshot, paths, createFsHasher(root, "sha1"));
  return { changed: [...moved.changed].sort(), touched: [...moved.touched].sort() };
}

function keysOf(keys: WorktreeKeys, paths: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const testFile = { project: "", path };
    out[path] = { closure: keys.index.closure(testFile)?.paths, key: keys.index.key(testFile) };
  }
  return out;
}
