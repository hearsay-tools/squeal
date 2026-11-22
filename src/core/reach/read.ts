import { COVERAGE_RECORD_VERSION, decodeRecord } from "../code/coverage/record.js";
import { coverageOn } from "../code/coverage/runtime.js";
import type { CoverageRecord } from "../code/coverage/types.js";
import type { CodeStore } from "../code/store/types.js";
import { readPolicy } from "../daemon/policy.js";
import { closureFor } from "../delivery/closure.js";
import { compare } from "../fs/compare.js";
import { worktreeIdFor } from "../fs/git-layout.js";
import { createDeclaredInputs, type DeclaredInputs } from "../keys/closure.js";
import { createInputMatcher } from "../keys/glob.js";
import { ObservedSets } from "../keys/observed.js";
import { durationOf } from "../scheduler/files.js";
import { groupView, runnerOf } from "../scheduler/slow.js";
import { hasImportGraphTables } from "../store/import-edges.js";
import { readImportGraph, type TestWalk } from "../store/import-graph.js";
import { readEdits } from "../store/repos/edits.js";
import { connectionOf } from "../store/store.js";
import type { FunctionCount } from "../types/code.js";
import type { RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { Store } from "../types/store.js";
import { sourceCalls } from "./called.js";
import { moduleFacts } from "./modules.js";
import { staleReader } from "./stale.js";
import type { CoverageView, DeclaredPattern, ReachSnapshot, ReachTestFile } from "./types.js";

/*
 * Spec 015 D11: the snapshot `squeal impact` analyses, read from one read
 * transaction of each store. It runs no test and writes nothing: result
 * reads pass `usedAt` 0, and the observed maps are read, never merged. A
 * test file with no closure or walk at its current key reads its newest
 * stored ones, and the snapshot counts them (row 015-128, `stale.ts`).
 */

export interface SnapshotSource {
  readonly store: Store;
  readonly root: string;
  /** The open code store; `null` with complexity off or no code store. */
  readonly code: CodeStore | null;
}

/** The snapshot, and how many test files the daemon listed (`null` when none yet). */
export function readSnapshot({ store, root, code }: SnapshotSource): {
  readonly snapshot: ReachSnapshot;
  readonly listed: number | null;
} {
  const policy = readPolicy(root);
  const id = worktreeIdFor(root);
  const rows = store.testFileKeys.list(id);
  const closure = closureFor(store, id);
  // Row 015-108's edges: a store no daemon of that version wrote has no tables, and import reads unsplit.
  const strict = hasImportGraphTables(connectionOf(store)) ? readImportGraph(store, id) : null;
  const stale = staleReader(store, strict);
  const graph = stale.graph;
  const observed = new ObservedSets(store);
  const groups = groupView(policy);
  const on = coverageOn(policy);
  const counted = countedFunctions(code, id);
  const walkPaths = closureOfWalk(store, id, policy);
  const testFiles = rows.map(({ testFile: ref, key }): ReachTestFile => {
    const runner = runnerOf(policy, ref.project);
    // `usedAt` 0: reading a duration is not a lookup hit (spec 001 D8) and writes nothing.
    const atKey = store.results.byKey(key, 0);
    const ms = durationOf(atKey) ?? durationOf(store.results.newestForTestFile(ref));
    // Row 015-128: `observedModules.` holds the worker's own loads too, so only `observedDirect.` is a child's.
    const inSuite = groups.of(ref).at !== "manual";
    const childProcess = new Set(observed.directOf(ref));
    const runtimeRead = new Set(observed.of(ref));
    const reads = [...childProcess, ...runtimeRead];
    let fileClosure: readonly RelativePath[] | null = null;
    if (inSuite) {
      const exact = strict?.walk(ref);
      // Counts a stale walk now for suite files only, so manual groups never trigger a stale notice.
      graph?.walk(ref);
      fileClosure =
        closure(ref) ??
        (exact === undefined ? null : walkPaths(ref, exact, reads)) ??
        stale.closure(ref, (walk) => walkPaths(ref, walk, reads));
    }
    return {
      ref,
      runner,
      inSuite,
      seconds: ms === null ? null : ms / 1000,
      current: atKey.length > 0,
      closure: fileClosure,
      childProcess,
      runtimeRead,
      coverage: !on || runner === "pytest" ? { kind: "unknown" } : coverageView(code, key, counted),
    };
  });
  const snapshot: ReachSnapshot = {
    testFiles,
    edits: readEdits(store),
    coverage: {
      on,
      coverageEnabled: policy.coverage.enabled,
      complexityEnabled: policy.complexity.enabled,
    },
    graph,
    modules: moduleFacts(root, graph),
    declared: declaredPatterns(policy.inputs),
    onStart: policy.baseline.onStart,
    stale: stale.summary(),
  };
  return { snapshot, listed: rows.length === 0 ? null : rows.length };
}

/**
 * R1 0.1.416 (review 0.1.416 B1): a test file's closure from a stored
 * walk, when `closureFor` gives none: a peer wrote the shared closure last,
 * at its own key. The walk at this worktree's current key was written with
 * the closure the key was set from (spec 015 D11's one rule), so it is
 * trusted evidence of the closure, as valid as the result; a newer one is
 * the stale fallback's (row 015-128). Its paths are the test file, every
 * walked file and its targets, and what the key's closure adds to the
 * runner's: the declared inputs and the observed paths.
 */
function closureOfWalk(
  store: Store,
  id: WorktreeId,
  policy: Policy,
): (
  ref: TestFileRef,
  walk: TestWalk,
  observed: readonly RelativePath[],
) => readonly RelativePath[] {
  let declared: DeclaredInputs | undefined;
  return (ref, walk, observed) => {
    declared ??= createDeclaredInputs(
      policy.inputs,
      store.fileHashes.list(id).map((row) => row.path),
    );
    const paths = new Set<RelativePath>([ref.path, ...declared.for(ref.path), ...observed]);
    for (const [path, targets] of walk.imports) {
      paths.add(path);
      for (const target of [...targets.static, ...targets.dynamic]) paths.add(target);
    }
    return [...paths].sort(compare);
  };
}

/** The record at the test file's current key, as D11 reads it. */
function coverageView(
  code: CodeStore | null,
  key: CheckKey | null,
  counted: Counted,
): CoverageView {
  if (code === null || key === null) return { kind: "none" };
  const bytes = code.coverage.get({ resultKey: key, providerVersion: COVERAGE_RECORD_VERSION });
  if (bytes === null) return { kind: "none" };
  let record: CoverageRecord;
  try {
    record = decodeRecord(bytes);
  } catch {
    return { kind: "none" };
  }
  const called = new Set<RelativePath>();
  const loaded = new Set<RelativePath>();
  // Review 0.1.415 B1: a source whose record cannot tell its top level from a function reads unread.
  const unread = new Set<RelativePath>(record.unread);
  for (const source of record.sources) {
    const firstLine = counted(source.path)?.some((f) => f.range.startLine === 1) ?? null;
    const calls = sourceCalls(source, firstLine);
    if (calls === "uncertain") unread.add(source.path);
    else loaded.add(source.path);
    if (calls === "called") called.add(source.path);
  }
  return { kind: "record", called, loaded, unread };
}

/** The counter's functions of a file at its current bytes (D3); `null` without a count. */
type Counted = (path: RelativePath) => readonly FunctionCount[] | null;

function countedFunctions(code: CodeStore | null, id: WorktreeId): Counted {
  const known = new Map<RelativePath, readonly FunctionCount[] | null>();
  return (path) => {
    if (code === null) return null;
    if (known.has(path)) return known.get(path) ?? null;
    const [file] = code.files.list(id, [path]);
    const count =
      file === undefined ? null : code.counts.get(file.blob, file.language, file.counterVersion);
    known.set(path, count?.functions ?? null);
    return count?.functions ?? null;
  };
}

/**
 * The `inputs` entry that gives `path` to a test file, as `createDeclaredInputs`
 * selects them: a list for every test file, a map entry for the test files
 * its glob matches. Its globs name the pattern a suggestion quotes.
 */
function declaredPatterns(inputs: Policy["inputs"]) {
  const rules = (
    Array.isArray(inputs)
      ? inputs.map((input) => ({ tests: null, input }))
      : Object.entries(inputs).flatMap(([tests, globs]) =>
          (globs as readonly string[]).map((input) => ({ tests, input })),
        )
  ).map((rule) => ({
    rule: rule as DeclaredPattern,
    applies: rule.tests === null ? () => true : createInputMatcher([rule.tests]),
    matches: createInputMatcher([rule.input]),
  }));
  return (testPath: RelativePath, path: RelativePath): DeclaredPattern | null =>
    rules.find((r) => r.applies(testPath) && r.matches(path))?.rule ?? null;
}
