import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import { readHead } from "../../../../src/core/daemon-loop/head.js";
import { createFsHasher, StatCache, seedStatCache } from "../../../../src/core/hash/index.js";
import * as keyIndex from "../../../../src/core/keys/index.js";
import { WorktreeKeys } from "../../../../src/core/scheduler/keying.js";
import type { Store, WorktreeId } from "../../../../src/core/types/index.js";
import type { AssembleInput, CaseOutput } from "../case.js";
import { git, scratchStore, writeTree } from "./shared.js";

const WORKTREE = "validity-a" as WorktreeId;
const OTHER = "validity-b" as WorktreeId;

/**
 * Each test file's closure and key as a daemon assembles them (011 C3): a
 * fixture repository with the case's policy, committed and untracked files,
 * keyed by the tree's `WorktreeKeys` over a store of its own schema, the
 * runner's closures given and one environment hash for the project. With
 * `after`, the keys after it too; with `elsewhere`, after this worktree
 * read back what a second one stored (016 D4).
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
    const keys = await keyed(root, store, WORKTREE, input);
    // Spec 016 D3: the runner the keys name is the environment's. A tree before
    // `runnerOf` gives the environment's name, so both trees agree.
    const runner = keys.runnerOf?.("") ?? input.environment?.runnerName ?? null;
    // 016 D4, O8: whether runs grow the closures. A tree before `observes` reads the policy alone.
    const observes = keys.observes?.("") ?? (keys as unknown as { observing: boolean }).observing;
    const outputs = { runner, observes };
    const paths = input.closures.map(({ path }) => path);
    const first = keysOf(keys, paths);
    if (input.elsewhere !== undefined) {
      storeObserved(await keyed(root, store, OTHER, input), store, input.elsewhere);
      await readBack(keys, input);
      return { keys: { first, elsewhere: keysOf(keys, paths) }, outputs };
    }
    if (input.after === undefined) return { keys: first, outputs };
    for (const { path, imports } of input.after.closures) {
      keys.setClosure({ testFile: { project: "", path }, paths: [...imports] });
    }
    for (const path of input.after.removed) keys.removeTestFile({ project: "", path });
    await keys.trackUntracked();
    return { keys: { first, after: keysOf(keys, paths) }, outputs };
  } finally {
    store.close();
  }
}

/** Worktree `id`'s keys over `root` and `store`: bootstrapped, its environment read, the runner's closures set. */
async function keyed(
  root: string,
  store: Store,
  id: WorktreeId,
  input: AssembleInput,
): Promise<WorktreeKeys> {
  const keys = new WorktreeKeys({
    root,
    worktreeId: id,
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
  return keys;
}

/**
 * What the other worktree's runs observed, stored through its keys as a
 * record stores it. A tree before D4 stores the observed paths only, and
 * has no start-up entry to leave malformed.
 */
function storeObserved(
  keys: WorktreeKeys,
  store: Store,
  elsewhere: NonNullable<AssembleInput["elsewhere"]>,
) {
  for (const { path, paths, direct } of elsewhere.observed) {
    const testFile = { project: "", path };
    keys.addObserved(testFile, [...paths]);
    if (direct !== undefined) keys.markDirect?.(testFile, [...direct]);
  }
  if (elsewhere.startup !== undefined) keys.seeStartup?.("", [...elsewhere.startup]);
  keys.writeSeen?.();
  const startup = keyIndex.observedStartupMetaKey?.("");
  if (elsewhere.malformed === true && startup !== undefined) {
    store.transaction(() => store.meta.set(startup, "{"));
  }
}

/**
 * This worktree reads back what others stored, as a refinement does: the
 * start-up paths and the grown observed sets of module-load projects, then
 * each runner closure again. A tree before D4 reads the observed sets
 * before it assembles a closure again.
 */
async function readBack(keys: WorktreeKeys, input: AssembleInput): Promise<void> {
  await keys.regrowStartup?.();
  keys.regrowObserved?.();
  keys.refreshObserved([""]);
  for (const { path, imports } of input.closures) {
    keys.setClosure({ testFile: { project: "", path }, paths: [...imports] });
  }
  await keys.trackUntracked();
  // For coverage only: direct marks decide which file runs first after an edit, no stored row.
  for (const { path } of input.closures) keys.directOf?.({ project: "", path });
}

function keysOf(keys: WorktreeKeys, paths: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const testFile = { project: "", path };
    out[path] = { closure: keys.index.closure(testFile)?.paths, key: keys.index.key(testFile) };
  }
  return out;
}
