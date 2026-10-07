import {
  createNodeTestAdapter,
  NODE_TEST_ADAPTER_VERSION,
  type ObservedPaths,
  type ObservedStore,
} from "../../runners/node-test/adapter.js";
import { compare, isRecord } from "../fs/index.js";
import type { AbsolutePath, NodeTestProject, ProjectName, Store } from "../types/index.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";

/**
 * Spec 003 D3 as amended: the observed-only paths of one node:test project,
 * a map from test path to paths, shared by every worktree of the repository.
 */
export function nodeTestObservedMetaKey(project: ProjectName): string {
  return `nodeTest.observed.${project}`;
}

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
  return {
    read: () => parseObserved(store.meta.get(key)),
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
  /** Policy `runner.tierSize`, read per run. */
  readonly tierSize: () => number;
  readonly note: (text: string) => void;
}

/**
 * One runner per `nodeTest` entry (spec 003 D7), each behind
 * `createRecoveringRunner` as Vitest is: building the graph waits for the
 * first call or `open()`, and an adapter that cannot be built is a note and
 * a retry on the next batch. A missing Node is handled inside the adapter,
 * so it costs that project's checks only.
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
        }),
      onFailure: (text) =>
        options.note(`${text} (node-test project ${JSON.stringify(project.name)})`),
      onRecovered: () => options.note(`node-test project ${JSON.stringify(project.name)} started`),
    }),
  );
}
