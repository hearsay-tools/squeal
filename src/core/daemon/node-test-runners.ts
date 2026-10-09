import {
  createNodeTestAdapter,
  NODE_TEST_ADAPTER_VERSION,
  type ObservedPaths,
  type ObservedStore,
} from "../../runners/node-test/adapter.js";
import { compare, isRecord } from "../fs/index.js";
import {
  type AbsolutePath,
  type NodeTestProject,
  nodeTestObservedMetaKey,
  nodeTestObservedPreloadsMetaKey,
  type ProjectName,
  type RelativePath,
  type Store,
} from "../types/index.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";

// The key names live in the types, so the daemon's timers read them without this module (task 003-26).
export { nodeTestObservedMetaKey, nodeTestObservedPreloadsMetaKey };

/**
 * The adapter's read and write of its project's observed paths. A write
 * merges into what the key holds in one transaction, so two worktrees'
 * daemons never drop each other's paths, and adds the paths to the test
 * file's stored closure: a worktree that starts later keys the file from
 * that closure (001 D5 step 3) before its adapter is asked, and must not
 * inherit a result whose observed inputs it never compared.
 */
export function observedStore(store: Store, project: ProjectName): ObservedStore {
  const key = nodeTestObservedMetaKey(project);
  const preloadKey = nodeTestObservedPreloadsMetaKey(project);
  // Read at every refinement (review wave 2, S2): one point query, parsed only when it changed.
  const read = cachedRead(store, key, parseObserved);
  const readPreloads = cachedRead(store, preloadKey, parsePaths);
  return {
    read,
    readPreloads,
    writePreloads(additions) {
      store.transaction(() => {
        const merged = new Set([...parsePaths(store.meta.get(preloadKey)), ...additions]);
        store.meta.set(preloadKey, JSON.stringify([...merged].sort(compare)));
      });
    },
    write(additions) {
      store.transaction(() => {
        const merged = new Map(
          Object.entries(parseObserved(store.meta.get(key))).map(([f, p]) => [f, new Set(p)]),
        );
        for (const [testFile, paths] of Object.entries(additions)) {
          const known = merged.get(testFile) ?? new Set<string>();
          for (const path of paths) known.add(path);
          merged.set(testFile, known);
          const stored = store.testFiles.get({ project, path: testFile });
          if (stored === null) continue;
          const union = [...new Set([...stored.closure.paths, ...paths])].sort(compare);
          if (union.length === stored.closure.paths.length) continue;
          store.testFiles.put({ ...stored, closure: { ...stored.closure, paths: union } });
        }
        const value = Object.fromEntries(
          [...merged]
            .sort(([a], [b]) => compare(a, b))
            .map(([testFile, paths]) => [testFile, [...paths].sort(compare)]),
        );
        store.meta.set(key, JSON.stringify(value));
      });
    },
  };
}

function cachedRead<T>(store: Store, key: string, parse: (raw: string | null) => T): () => T {
  let last: { raw: string | null; value: T } | null = null;
  return () => {
    const raw = store.meta.get(key);
    if (last === null || last.raw !== raw) last = { raw, value: parse(raw) };
    return last.value;
  };
}

/** A missing or malformed key reads as no paths. */
function parsePaths(raw: string | null): RelativePath[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** A missing or malformed key reads as nothing observed. */
function parseObserved(raw: string | null): ObservedPaths {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([testFile, paths]) =>
      Array.isArray(paths) ? [[testFile, paths.filter((p) => typeof p === "string")]] : [],
    ),
  );
}

export interface NodeTestRunnersOptions {
  readonly root: AbsolutePath;
  readonly store: Store;
  /** Spec 001 D10: the daemon's temp directory, the children's `TMPDIR`. */
  readonly tempDir: AbsolutePath;
  /** Spec 001 D12: the mark the daemon's sweep finds a test's leftovers by (task 003-38). */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Policy `runner.tierSize`, read per run. */
  readonly tierSize: () => number;
  readonly note: (text: string) => void;
}

/**
 * One runner per `nodeTest` entry (spec 003 D7), each behind
 * `createRecoveringRunner` as Vitest is: building the graph waits for the
 * first call or `open()`. A missing Node, a missing `cwd` and a graph that
 * cannot be built are handled inside the adapter (review wave 2, S1), so
 * each costs that project's checks only and never rejects a composite call.
 */
export function createNodeTestRunners(
  projects: readonly NodeTestProject[],
  options: NodeTestRunnersOptions,
): RecoveringRunner[] {
  return projects.map((project) =>
    createRecoveringRunner({
      name: "node-test",
      adapterVersion: NODE_TEST_ADAPTER_VERSION,
      create: () =>
        createNodeTestAdapter(project, {
          root: options.root,
          observed: observedStore(options.store, project.name),
          note: options.note,
          concurrency: options.tierSize,
          tempDir: options.tempDir,
          ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
        }),
      onFailure: (text) =>
        options.note(`${text} (node-test project ${JSON.stringify(project.name)})`),
      onRecovered: () => options.note(`node-test project ${JSON.stringify(project.name)} started`),
    }),
  );
}
