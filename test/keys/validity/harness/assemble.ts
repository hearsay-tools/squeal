import { rmSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import { readHead } from "../../../../src/core/daemon-loop/head.js";
import {
  createFsHasher,
  type Hasher,
  StatCache,
  seedStatCache,
} from "../../../../src/core/hash/index.js";
import * as keyIndex from "../../../../src/core/keys/index.js";
import { WorktreeKeys } from "../../../../src/core/scheduler/keying.js";
import { observedGrowth } from "../../../../src/core/scheduler/observed.js";
import { changedSince, snapshotInputs } from "../../../../src/core/scheduler/stability.js";
import type { RelativePath, Store, WorktreeId } from "../../../../src/core/types/index.js";
import type { AssembleInput, CaseOutput } from "../case.js";
import { git, REPORT, scratchStore, writeTree } from "./shared.js";

const WORKTREE = "validity-a" as WorktreeId;
const OTHER = "validity-b" as WorktreeId;

/**
 * Each test file's closure and key as a daemon assembles them (011 C3): a
 * fixture repository with the case's policy, committed and untracked files,
 * keyed by the tree's `WorktreeKeys` over a store of its own schema, the
 * runner's closures given and one environment hash for the project. With
 * `after`, the keys after it too; with `elsewhere`, after this worktree
 * read back what a second one stored (016 D4), and with `relisted` after a
 * revision too (row 016-24); with `stability`, what the stability check then
 * finds as outputs (011-204).
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
    for (const [path, target] of Object.entries(input.runtime?.links ?? {}))
      symlinkSync(target, join(root, path));
    const hasher = moving(createFsHasher(root, "sha1"), root, input.movedAfterReads ?? {});
    if (input.runtime?.observed !== undefined) {
      store.meta.set(
        "observed.",
        JSON.stringify(Object.fromEntries(input.runtime.observed.map((o) => [o.path, o.paths]))),
      );
    }
    const keys = await keyed(root, store, WORKTREE, input, hasher);
    // Spec 016 D3: the runner the keys name is the environment's. A tree before
    // `runnerOf` gives the environment's name, so both trees agree.
    const runner = keys.runnerOf?.("") ?? input.environment?.runnerName ?? null;
    // 016 D4, O8: whether runs grow the closures. A tree before `observes` reads the policy alone.
    const observes = keys.observes?.("") ?? (keys as unknown as { observing: boolean }).observing;
    const paths = input.closures.map(({ path }) => path);
    const first = keysOf(keys, paths);
    if (input.runtime !== undefined) {
      const stages: unknown[] = [first];
      let freshGrowth: unknown = null;
      let rolledBack: string | null = null;
      for (const restored of input.runtime.restored ?? []) {
        const testFile = { project: "", path: restored.path };
        keys.setClosure({ testFile, paths: [...restored.imports] }, true);
        const fresh = input.closures.find((c) => c.path === restored.path);
        keys.setClosure({ testFile, paths: [...(fresh?.imports ?? [])] });
      }
      await keys.trackUntracked();
      if (input.runtime.freshObserved !== undefined) {
        const report = {
          ...REPORT,
          completedFiles: input.runtime.freshObserved.map(({ path }) => ({ project: "", path })),
          observed: input.runtime.freshObserved.map(({ path, paths, modules }) => ({
            testFile: { project: "", path },
            paths,
            directories: [],
            ...(modules === undefined ? {} : { modules }),
          })),
        };
        const growth = await observedGrowth({ root, keys }, report, keys.beginRun());
        freshGrowth = [...growth];
        for (const [id, addition] of growth) {
          const ref = report.completedFiles.find((ref) => keyIndex.testFileId(ref) === id);
          if (ref !== undefined) keys.addObserved(ref, addition.add);
        }
        try {
          store.transaction(() => {
            keys.writeSeen();
            throw new Error("rollback");
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "rollback") throw error;
        }
        rolledBack = store.meta.get("observed.");
        store.transaction(() => keys.writeSeen());
      }
      for (const o of input.runtime.observed ?? []) {
        const ref = { project: "", path: o.path };
        keys.markModules?.(ref, [...(o.modules ?? [])]);
        keys.markDirect(ref, [...(o.direct ?? [])]);
        keys.addObserved(ref, [...o.paths]);
      }
      keys.writeSeen();
      keys.refreshObserved([""]);
      keys.regrowObserved();
      await keys.trackUntracked();
      for (const policy of input.runtime.policies ?? []) {
        writeTree(root, { "squeal.config.json": JSON.stringify(policy) });
        keys.setPolicy(loadPolicy(root).policy);
        keys.unverifyRuntime?.(["not-this-project"]);
        keys.runtimeUnresolved?.();
        for (const path of [...Object.keys(input.files), ...Object.keys(input.untracked ?? {})]) {
          keys.updateDeclaredInputs([{ path, oldHash: null, newHash: "validity-added" }]);
        }
        await keys.trackUntracked();
        stages.push(keysOf(keys, paths));
      }
      keys.writeRuntimeApplications?.(input.closures.map(({ path }) => ({ project: "", path })));
      await keys.reconcileRuntime?.(() => readHead(root));
      for (const { path } of input.closures) {
        const ref = { project: "", path };
        keys.runtimeApplication?.(ref);
        keys.runtimeIdentity?.(ref);
        const key = keys.index.key(ref);
        if (key !== null) keys.index.keysReadAsOne(key);
      }
      stages.push(keysOf(keys, paths));
      keys.unverifyRuntime?.([null]);
      await keys.trackUntracked();
      stages.push(keysOf(keys, paths));
      return {
        keys: stages,
        outputs: { raw: store.meta.get("observed."), rolledBack, freshGrowth },
      };
    }
    const stable =
      input.stability === undefined
        ? {}
        : await stability(keys, root, input.closures, input.stability);
    const outputs = { runner, observes, ...stable };
    if (input.elsewhere !== undefined) {
      storeObserved(await keyed(root, store, OTHER, input), store, input.elsewhere);
      await readBack(keys, input);
      const elsewhere = keysOf(keys, paths);
      if (input.relisted === undefined) return { keys: { first, elsewhere }, outputs };
      relist(keys, root, input.relisted);
      return { keys: { first, elsewhere, relisted: keysOf(keys, paths) }, outputs };
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
  hasher: Hasher = createFsHasher(root, "sha1"),
): Promise<WorktreeKeys> {
  const keys = new WorktreeKeys({
    root,
    worktreeId: id,
    store,
    hasher,
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
    keys.setClosure(
      { testFile: { project: "", path }, paths: [...imports] },
      input.runtime?.saved === true,
    );
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
    keys.setClosure(
      { testFile: { project: "", path }, paths: [...imports] },
      input.runtime?.saved === true,
    );
  }
  await keys.trackUntracked();
  // For coverage only: direct marks decide which file runs first after an edit, no stored row.
  for (const { path } of input.closures) keys.directOf?.({ project: "", path });
}

/** `relisted`'s writes and removals, the runs that end, then a revision that reports no change. */
function relist(
  keys: WorktreeKeys,
  root: string,
  relisted: NonNullable<AssembleInput["relisted"]>,
): void {
  for (const [path, text] of Object.entries(relisted.files)) {
    if (text === null) rmSync(join(root, path), { force: true });
    else writeTree(root, { [path]: text });
  }
  for (const { path, directories } of relisted.ran ?? []) {
    keys.listedByRun?.({ project: "", path }, [...directories]);
  }
  keys.rekeyListings([]);
}

/** Writes `files` with an `mtime` `aheadMs` ahead, so each stat moves even where the bytes do not. */
function rewrite(root: string, files: Readonly<Record<string, string>>, aheadMs: number): void {
  writeTree(root, files);
  const later = new Date(Date.now() + aheadMs);
  for (const path of Object.keys(files)) utimesSync(join(root, path), later, later);
}

/** `hasher`, moving each of `moved`'s files' `mtime` after each of its first `n` reads, each time later. */
function moving(hasher: Hasher, root: string, moved: Readonly<Record<string, number>>): Hasher {
  const reads = new Map<string, number>();
  return {
    ...hasher,
    hash: async (path) => {
      const hash = await hasher.hash(path);
      const read = (reads.get(path) ?? 0) + 1;
      reads.set(path, read);
      if (read <= (moved[path] ?? 0)) {
        const later = new Date(Date.now() + 60_000 + read * 1_000);
        utimesSync(join(root, path), later, later);
      }
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
