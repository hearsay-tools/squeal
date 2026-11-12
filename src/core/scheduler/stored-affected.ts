import { inflateRawSync } from "node:zlib";
import { compare } from "../fs/compare.js";
import { testFileId } from "../keys/reverse-index.js";
import type { Connection } from "../store/connection.js";
import { hasImportGraphTables } from "../store/import-edges.js";
import { connectionOf } from "../store/store.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { FileChange } from "../types/revision.js";
import type { AffectedTestFiles } from "../types/runner.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { ContentRekey } from "./revision.js";

/*
 * Spec 021 D21.3 (row 021-30): a revision's `affected` from the import
 * graph the daemon stored (spec 015 D11), without the runner host. A cold
 * host's first `affected` walks every test file's imports: 9 s on Squeal,
 * 23 to 25 s on cezar (`tasks/021-30-notes.md`, `research/daemon-heap.md`
 * Q3). On 24 content changes of a clone of Squeal the graph gave the same
 * direct and transitive sets as Vitest's walk, 24 of 24.
 *
 * The rule, agreed with the coordinator on 2026-11-12. The graph answers
 * only when all of these hold; otherwise the host walks, as before:
 *
 * 1. Every change of the revision is a content change: no add, no delete,
 *    no `.snap` path. An add or a delete can change what an import resolves
 *    to, and Vitest's walk loses the importers of a deleted file.
 * 2. No changed path is an environment input, and the runner's view did not
 *    move: no project was recreated, the environment and the listing are not
 *    read again, no runner failure is being retried, and no earlier call of
 *    the runner part failed.
 * 3. Every listed test file is a Vitest file with a closure: no other runner
 *    stores walks, and a file without a closure may reach anything.
 * 4. Each test file whose closure names a changed path (the reverse index,
 *    over closure paths) has a stored walk with its own entry, at the key it
 *    held before this revision.
 *
 * Then a test file is affected when it is a changed path or its walk visits
 * one (an importer or a target); it is direct when it is a changed path or
 * its own entry imports one; the rest are transitive, as Vitest's walk
 * splits them (spec 001 D5 step 4).
 *
 * Rule 4 reads a walk at the key the file held before the revision, not at
 * its current key as spec 015 D11 reads it (the coordinator, 2026-11-12, for
 * this one reader). `rekeyContent` moves and commits the key of every file
 * whose closure names a changed path before the runner part asks, so the
 * current key has no walk for exactly the files the graph must judge. The
 * walk at the earlier key describes the files before the revision, and a
 * content change moves no edge out of an unchanged file: a test file
 * reaches a changed path after the revision exactly when it reached one
 * before it.
 */

/** One entry of a stored walk, as `encodeImports` writes it: a file, its static and dynamic targets. */
export type WalkEntry = readonly [RelativePath, readonly RelativePath[], readonly RelativePath[]];

/** What the graph's answer reads of the daemon. */
export interface GraphSource {
  /** The listed test files. */
  readonly testFiles: readonly TestFileRef[];
  /** Test files whose closure names one of `paths`. */
  referencing(paths: readonly RelativePath[]): readonly TestFileRef[];
  hasClosure(ref: TestFileRef): boolean;
  runnerOf(project: ProjectName): string | undefined;
  isEnvironmentInput(path: RelativePath): boolean;
  /** `ref`'s current key. */
  key(ref: TestFileRef): CheckKey | null;
  /** The walk stored for `ref` at `key`; `undefined` when none is stored. */
  walk(ref: TestFileRef, key: CheckKey): readonly WalkEntry[] | undefined;
}

/** What the runner part knows when it would ask the host for `affected`. */
export interface AffectedAsk {
  readonly changes: readonly FileChange[];
  /** `ContentRekey.previous`: the key each re-keyed test file held before the revision. */
  readonly previous?: ReadonlyMap<string, CheckKey | null>;
  /**
   * The runner's view moved: a project was recreated, the environment or the
   * listing is read again or failed, or a runner failure is being retried.
   */
  readonly runnerMoved: boolean;
}

/** What the runner part saw before its `affected` call, as rule 2 reads it. */
export interface RunnerPartSeen {
  readonly recreated: ReadonlySet<ProjectName>;
  readonly retrying: boolean;
  /** `undefined` when the listing was not read again. */
  readonly listed: unknown;
  readonly failures: ReadonlyMap<unknown, unknown>;
}

/** The ask of a revision's runner part, from its content re-key and what the part saw so far. */
export function affectedAsk(
  changes: readonly FileChange[],
  content: Pick<ContentRekey, "previous" | "environment">,
  seen: RunnerPartSeen,
): AffectedAsk {
  return {
    changes,
    ...(content.previous === undefined ? {} : { previous: content.previous }),
    runnerMoved:
      seen.recreated.size > 0 ||
      content.environment ||
      seen.retrying ||
      seen.listed !== undefined ||
      seen.failures.size > 0,
  };
}

/**
 * `affected` for `paths`: the stored graph's answer, or `host`'s when the
 * rule does not hold. `stored` answers a later ask for some of the same
 * paths (the edit cut's bare sources) while the graph answered this one.
 */
export async function askAffected(
  context: SchedulerContext,
  ledger: Ledger,
  ask: AffectedAsk,
  paths: readonly RelativePath[],
  host: () => Promise<AffectedTestFiles | null>,
): Promise<{
  readonly affected: AffectedTestFiles | null;
  readonly stored: ((paths: readonly RelativePath[]) => AffectedTestFiles | null) | undefined;
}> {
  const answer = storedAffected(context, ledger, ask, paths);
  if (answer === null) return { affected: await host(), stored: undefined };
  return { affected: answer, stored: (some) => storedAffected(context, ledger, ask, some) };
}

/**
 * The graph's answer for `paths`, some or all of `ask`'s changed paths;
 * `null` when the rule does not hold, so the host must walk.
 */
export function graphAffected(
  source: GraphSource,
  ask: AffectedAsk,
  paths: readonly RelativePath[],
): AffectedTestFiles | null {
  if (ask.runnerMoved || paths.length === 0) return null;
  for (const change of ask.changes) {
    if (change.oldHash === null || change.newHash === null) return null;
    if (change.path.endsWith(".snap") || source.isEnvironmentInput(change.path)) return null;
  }
  const listed = new Set<string>();
  for (const ref of source.testFiles) {
    if (source.runnerOf(ref.project) !== "vitest" || !source.hasClosure(ref)) return null;
    listed.add(testFileId(ref));
  }
  const changed = new Set(paths);
  const direct: TestFileRef[] = [];
  const transitive: TestFileRef[] = [];
  for (const ref of source.referencing(paths)) {
    if (!listed.has(testFileId(ref))) continue;
    if (changed.has(ref.path)) {
      direct.push(ref);
      continue;
    }
    const key = keyBefore(source, ask, ref);
    const walk = key === null ? undefined : source.walk(ref, key);
    const own = walk?.find(([path]) => path === ref.path);
    if (walk === undefined || own === undefined) return null;
    if ([...own[1], ...own[2]].some((target) => changed.has(target))) direct.push(ref);
    else if (walk.some((entry) => visits(entry, changed))) transitive.push(ref);
  }
  return { direct: direct.sort(byRef), transitive: transitive.sort(byRef) };
}

/** The key `ref` held before the revision: its `previous` one when the revision moved it. */
function keyBefore(source: GraphSource, ask: AffectedAsk, ref: TestFileRef): CheckKey | null {
  const id = testFileId(ref);
  return ask.previous?.has(id) === true ? (ask.previous.get(id) ?? null) : source.key(ref);
}

/** Whether a walk entry is a changed path or imports one. */
function visits([path, statics, dynamics]: WalkEntry, changed: ReadonlySet<RelativePath>): boolean {
  return (
    changed.has(path) || statics.some((p) => changed.has(p)) || dynamics.some((p) => changed.has(p))
  );
}

/** `graphAffected` over the scheduler's keys and store. */
export function storedAffected(
  context: SchedulerContext,
  ledger: Ledger,
  ask: AffectedAsk,
  paths: readonly RelativePath[],
): AffectedTestFiles | null {
  const conn = walkConnection(context);
  if (conn === null) return null;
  const { keys } = context;
  const source: GraphSource = {
    testFiles: [...ledger.files.values()].map((file) => file.ref),
    referencing: (changed) => keys.index.reverse.referencing(changed),
    hasClosure: (ref) => keys.index.closure(ref) !== undefined,
    runnerOf: (project) => keys.runnerOf(project),
    isEnvironmentInput: (path) => keys.isEnvironmentInput(path),
    key: (ref) => keys.index.key(ref),
    walk: (ref, key) => readWalk(conn, ref, key),
  };
  return graphAffected(source, ask, paths);
}

/** The store's connection when it holds the walk tables; `null` for a store `openStore` did not open. */
function walkConnection(context: SchedulerContext): Connection | null {
  try {
    const conn = connectionOf(context.store);
    return hasImportGraphTables(conn) ? conn : null;
  } catch {
    return null;
  }
}

/** The walk stored for `ref` at `key` (`encodeImports`: deflated JSON of `WalkEntry`s). */
function readWalk(conn: Connection, ref: TestFileRef, key: CheckKey): WalkEntry[] | undefined {
  const row = conn.get(
    "SELECT imports FROM test_file_imports WHERE project = ? AND path = ? AND key = ?",
    ref.project,
    ref.path,
    key,
  );
  if (row === null) return undefined;
  return JSON.parse(inflateRawSync(row.imports as Uint8Array).toString("utf8")) as WalkEntry[];
}

function byRef(a: TestFileRef, b: TestFileRef): number {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}
