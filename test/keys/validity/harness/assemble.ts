import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import { readHead } from "../../../../src/core/daemon-loop/head.js";
import { createFsHasher, StatCache, seedStatCache } from "../../../../src/core/hash/index.js";
import { WorktreeKeys } from "../../../../src/core/scheduler/keying.js";
import type { WorktreeId } from "../../../../src/core/types/index.js";
import type { AssembleInput, CaseOutput } from "../case.js";
import { git, scratchStore, writeTree } from "./shared.js";

const WORKTREE = "validity-a" as WorktreeId;

/**
 * Each test file's closure and key as a daemon assembles them (011 C3): a
 * fixture repository with the case's policy, committed and untracked files,
 * keyed by the tree's `WorktreeKeys` over a store of its own schema, the
 * runner's closures given and one environment hash for the project. With
 * `after`, the keys after it too.
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
    const keys = new WorktreeKeys({
      root,
      worktreeId: WORKTREE,
      store,
      hasher: createFsHasher(root, "sha1"),
      objectFormat: "sha1",
      policy: loadPolicy(root).policy,
      squealVersion: "0.0.0-validity",
      env: {},
      onExtraFiles: () => {},
    });
    await keys.bootstrap(() => readHead(root));
    if (input.environment === undefined) keys.index.setEnvironment("", "environment");
    else await keys.setEnvironments([input.environment]);
    for (const { path, imports } of input.closures) {
      keys.setClosure({ testFile: { project: "", path }, paths: [...imports] });
    }
    await keys.trackUntracked();
    const paths = input.closures.map(({ path }) => path);
    const first = keysOf(keys, paths);
    if (input.after === undefined) return { keys: first };
    for (const { path, imports } of input.after.closures) {
      keys.setClosure({ testFile: { project: "", path }, paths: [...imports] });
    }
    for (const path of input.after.removed) keys.removeTestFile({ project: "", path });
    await keys.trackUntracked();
    return { keys: { first, after: keysOf(keys, paths) } };
  } finally {
    store.close();
  }
}

function keysOf(keys: WorktreeKeys, paths: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const testFile = { project: "", path };
    out[path] = { closure: keys.index.closure(testFile)?.paths, key: keys.index.key(testFile) };
  }
  return out;
}
