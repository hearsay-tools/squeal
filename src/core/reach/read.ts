import { COVERAGE_PROVIDER_VERSION, decodeRecord } from "../code/coverage/record.js";
import { coverageOn } from "../code/coverage/runtime.js";
import type { CoverageRecord } from "../code/coverage/types.js";
import type { CodeStore } from "../code/store/types.js";
import { readPolicy } from "../daemon/policy.js";
import { closureFor } from "../delivery/closure.js";
import { worktreeIdFor } from "../fs/git-layout.js";
import { createInputMatcher } from "../keys/glob.js";
import { ModuleSets } from "../keys/modules.js";
import { ObservedSets } from "../keys/observed.js";
import { durationOf } from "../scheduler/files.js";
import { groupView, runnerOf } from "../scheduler/slow.js";
import { hasImportGraphTables } from "../store/import-edges.js";
import { readImportGraph } from "../store/import-graph.js";
import { readEdits } from "../store/repos/edits.js";
import { connectionOf } from "../store/store.js";
import type { FunctionCount } from "../types/code.js";
import type { RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { Store } from "../types/store.js";
import { sourceCalls } from "./called.js";
import { moduleFacts } from "./modules.js";
import type { CoverageView, DeclaredPattern, ReachSnapshot, ReachTestFile } from "./types.js";

/*
 * Spec 015 D11: the snapshot `squeal reach` analyses, read from one read
 * transaction of each store. It runs no test and writes nothing: result
 * reads pass `usedAt` 0, and the observed maps are read, never merged.
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
  const graph = hasImportGraphTables(connectionOf(store)) ? readImportGraph(store, id) : null;
  const observed = new ObservedSets(store);
  const modules = new ModuleSets(store);
  const groups = groupView(policy);
  const on = coverageOn(policy);
  const counted = countedFunctions(code, id);
  const testFiles = rows.map(({ testFile: ref, key }): ReachTestFile => {
    const runner = runnerOf(policy, ref.project);
    // `usedAt` 0: reading a duration is not a lookup hit (spec 001 D8) and writes nothing.
    const ms =
      durationOf(store.results.byKey(key, 0)) ?? durationOf(store.results.newestForTestFile(ref));
    return {
      ref,
      runner,
      inSuite: groups.of(ref).at !== "manual",
      seconds: ms === null ? null : ms / 1000,
      closure: closure(ref) ?? null,
      childProcess: new Set([...modules.of(ref), ...observed.directOf(ref)]),
      runtimeRead: new Set(observed.of(ref)),
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
    modules: moduleFacts(root, graph, (path) => counted(path)?.length ?? null),
    declared: declaredPatterns(policy.inputs),
  };
  return { snapshot, listed: rows.length === 0 ? null : rows.length };
}

/** The record at the test file's current key, as D11 reads it. */
function coverageView(
  code: CodeStore | null,
  key: CheckKey | null,
  counted: Counted,
): CoverageView {
  if (code === null || key === null) return { kind: "none" };
  const bytes = code.coverage.get({ resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION });
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
