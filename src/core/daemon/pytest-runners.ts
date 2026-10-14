import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createPytestAdapter,
  type ObservedPaths,
  type ObservedStore,
  PYTEST_ADAPTER_VERSION,
} from "../../runners/pytest/adapter.js";
import { compare, isRecord } from "../fs/index.js";
import {
  type AbsolutePath,
  type ProjectName,
  type PytestProject,
  pytestObservedMetaKey,
  type Store,
} from "../types/index.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";

export { pytestObservedMetaKey };

/**
 * The adapter's read and write of its project's observed paths (spec 007
 * D4, as 003 D3). A write merges into what the key holds and adds the paths
 * to the test file's stored closure in one transaction, so two worktrees'
 * daemons never drop each other's paths, and a worktree that starts later
 * keys the file from that closure (001 D5 step 3) before its adapter is
 * asked: it must not inherit a result whose observed inputs it never compared.
 */
export function pytestObservedStore(store: Store, project: ProjectName): ObservedStore {
  const key = pytestObservedMetaKey(project);
  let last: { raw: string | null; value: ObservedPaths } | null = null;
  return {
    read() {
      const raw = store.meta.get(key);
      if (last === null || last.raw !== raw) last = { raw, value: parseObserved(raw) };
      return last.value;
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

/**
 * Where one worktree's project keeps pytest's cache and its bytecode
 * (`PYTHONPYCACHEPREFIX`): under Squeal's state directory, so a warm prefix
 * outlives the daemon's temp directory (007 status, open question 3: a cold
 * one costs 0.7 to 0.9 s once per worktree, project and Python).
 */
export function pytestCacheDir(
  stateDir: AbsolutePath,
  root: AbsolutePath,
  project: ProjectName,
): AbsolutePath {
  const id = createHash("sha256").update(`${root}\0${project}`).digest("hex").slice(0, 16);
  return join(stateDir, "pytest", id);
}

export interface PytestRunnersOptions {
  readonly root: AbsolutePath;
  readonly store: Store;
  /** Squeal's state directory, `<common-dir>/squeal/`: pytest's cache and bytecode go under it. */
  readonly stateDir: AbsolutePath;
  /** Spec 001 D10: the daemon's temp directory, the children's `TMPDIR`. */
  readonly tempDir: AbsolutePath;
  /** Spec 001 D12: the mark the daemon's sweep finds a test's leftovers by. */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Policy `runner.tierSize`, read per run. */
  readonly tierSize: () => number;
  readonly note: (text: string) => void;
}

/**
 * One runner per `pytest` entry (spec 007 D8, 003 D7), each behind
 * `createRecoveringRunner` as node:test's are: building the graph waits for
 * the first call or `open()`. D2's states, a missing `cwd` and a graph that
 * cannot be built are handled inside the adapter, so each costs that
 * project's checks only and never rejects a composite call.
 */
export function createPytestRunners(
  projects: readonly PytestProject[],
  options: PytestRunnersOptions,
): RecoveringRunner[] {
  return projects.map((project) =>
    createRecoveringRunner({
      name: "pytest",
      adapterVersion: PYTEST_ADAPTER_VERSION,
      create: () =>
        createPytestAdapter(project, {
          root: options.root,
          observed: pytestObservedStore(options.store, project.name),
          note: options.note,
          concurrency: options.tierSize,
          tempDir: options.tempDir,
          cacheDir: pytestCacheDir(options.stateDir, options.root, project.name),
          ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
        }),
      onFailure: (text) => options.note(`${text} (pytest project ${JSON.stringify(project.name)})`),
      onRecovered: () => options.note(`pytest project ${JSON.stringify(project.name)} started`),
    }),
  );
}
