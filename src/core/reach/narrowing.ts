import { compare } from "../fs/compare.js";
import type { EpochMs, RelativePath } from "../types/common.js";
import type { Analysis, TestReach } from "./analyze.js";
import { type InputFacts, inputFacts } from "./inputs.js";
import type {
  NarrowingEstimate,
  NarrowingFile,
  NoList,
  NoListDetail,
  NoListReason,
  Unproved,
} from "./report-types.js";
import type { LoadedList, ReachCoverage, ReachEdit, ReachSnapshot } from "./types.js";

/*
 * Spec 022 D4: per project, the re-run seconds that narrowing each test
 * file's import closure to the modules it loaded would save, over D11's
 * window of edits. An upper bound on phase 2's saving, not proof of waste.
 *
 * Decisions of row 022-04 (the coordinator, 2026-11-14): the store keeps no
 * past keys, so the list of an edit is the newest recorded at or before the
 * edit's time. The reasons a file has no list are read from its current key,
 * in `reasonOf`'s order.
 *
 * Review 0.1.493 B2: avoidance and importer counts come from `inputs.ts`'s
 * graph and input facts, not from the display routes.
 */

interface ProjectSums {
  readonly runner: TestReach["test"]["runner"];
  readonly tests: TestReach[];
  rerun: number;
  avoidable: number;
  readonly files: Map<RelativePath, number>;
  readonly noList: Map<string, NoList & Counted>;
  readonly unproved: Map<string, Unproved & Counted>;
}

/** A bucket's test files, each counted once. */
interface Counted {
  testFiles: number;
  readonly seen: Set<RelativePath>;
}

/** A test file whose closure is known, with its input facts. */
interface Keyed {
  readonly reach: TestReach;
  readonly facts: InputFacts;
}

export function narrowingEstimates(
  analysis: Analysis,
  snapshot: ReachSnapshot,
  /** Source files listed per project; the text gives D4's ten (`REACH_LIMIT`). */
  limit: number,
): NarrowingEstimate[] {
  const projects = new Map<string, ProjectSums>();
  for (const reach of analysis.tests) {
    const { project } = reach.test.ref;
    const sums: ProjectSums = projects.get(project) ?? {
      runner: reach.test.runner,
      tests: [],
      rerun: 0,
      avoidable: 0,
      files: new Map(),
      noList: new Map(),
      unproved: new Map(),
    };
    sums.tests.push(reach);
    projects.set(project, sums);
  }
  return [...projects.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([project, sums]) => estimateOf(project, sums, analysis.kept, snapshot, limit));
}

function estimateOf(
  project: string,
  sums: ProjectSums,
  edits: readonly ReachEdit[],
  snapshot: ReachSnapshot,
  limit: number,
): NarrowingEstimate {
  const lists = "lists: the newest recorded at or before each edit";
  if (sums.runner !== "vitest") {
    return { project, status: "not Vitest", lists, ...EMPTY };
  }
  const facts = projectFacts(sums.tests, snapshot.coverage);
  const keyed: Keyed[] = sums.tests
    .filter((reach) => reach.test.closure !== null)
    .map((reach) => ({ reach, facts: inputFacts(reach.test, snapshot) }));
  for (const edit of edits) {
    for (const test of keyed) addPair(sums, test, edit, facts);
  }
  const withoutList = [...sums.noList.values()]
    .map(({ reason, detail, testFiles, seconds }) => ({ reason, detail, testFiles, seconds }))
    .sort(
      (a, b) =>
        b.testFiles - a.testFiles ||
        compare(a.reason, b.reason) ||
        compare(a.detail ?? "", b.detail ?? ""),
    );
  const unproved = [...sums.unproved.values()]
    .map(({ reason, testFiles, seconds }) => ({ reason, testFiles, seconds }))
    .sort((a, b) => b.testFiles - a.testFiles || compare(a.reason, b.reason));
  if (facts.first === null) {
    return {
      project,
      status: "no lists",
      lists,
      ...EMPTY,
      reason: noListsReason(facts),
      withoutList,
      unproved,
    };
  }
  const ranked = [...sums.files.entries()].sort(([a, x], [b, y]) => y - x || compare(a, b));
  const files = ranked.slice(0, limit).map(
    ([path, seconds]): NarrowingFile => ({
      path,
      avoidableSeconds: seconds,
      // Review 0.1.493 B2: importers by stored edges, whatever route the report displays.
      importedBy: keyed.filter((t) => t.facts.imports(path)).length,
      loadedBy: sums.tests.filter((t) => t.test.loaded.lists.at(-1)?.paths.has(path) === true)
        .length,
    }),
  );
  return {
    project,
    status: "estimate",
    lists,
    rerunSeconds: sums.rerun,
    avoidableSeconds: sums.avoidable,
    share: sums.rerun > 0 ? sums.avoidable / sums.rerun : 0,
    files,
    moreFiles: Math.max(0, ranked.length - limit),
    withoutList,
    unproved,
  };
}

const EMPTY = {
  rerunSeconds: 0,
  avoidableSeconds: 0,
  share: 0,
  files: [],
  moreFiles: 0,
  withoutList: [],
  unproved: [],
} as const;

/** One (edit, test file) pair: re-run seconds, and avoidable, or why no list or no proof tells. */
function addPair(
  sums: ProjectSums,
  { reach, facts: inputs }: Keyed,
  edit: ReachEdit,
  facts: ProjectFacts,
) {
  const { test } = reach;
  const changed = edit.paths.filter((p) => inputs.keyedBy.has(p));
  if (changed.length === 0) return;
  const seconds = test.seconds ?? 0;
  sums.rerun += seconds;
  const list = listAt(test.loaded.lists, edit.at);
  if (list === null) {
    const { reason, detail } = reasonOf(reach, facts);
    count(
      sums.noList,
      `${reason}\0${detail ?? ""}`,
      { reason, detail, testFiles: 0, seconds: 0 },
      test.ref.path,
      seconds,
    );
    return;
  }
  // D4: a change through any input other than an import-graph path the list does not hold is never avoidable.
  const kinds = changed.map((p) => inputs.kindOf(p));
  const held = changed.some((p, at) => kinds[at]?.kind === "kept" || list.paths.has(p));
  if (held) return;
  const unproved = kinds.find((k) => k.kind === "unproved");
  if (unproved !== undefined) {
    // An input kind not proved: the pair re-runs and is not estimated.
    const { reason } = unproved;
    count(sums.unproved, reason, { reason, testFiles: 0, seconds: 0 }, test.ref.path, seconds);
    return;
  }
  sums.avoidable += seconds;
  // Decision (3), 2026-11-14: a pair re-keyed by several files splits its seconds evenly among them.
  for (const path of changed) {
    sums.files.set(path, (sums.files.get(path) ?? 0) + seconds / changed.length);
  }
}

/** Adds `seconds` of `testFile` to the bucket `id`, made from `entry` when new. */
function count<T extends { seconds: number; testFiles: number }>(
  buckets: Map<string, T & Counted>,
  id: string,
  entry: T,
  testFile: RelativePath,
  seconds: number,
) {
  const bucket = buckets.get(id) ?? { ...entry, seen: new Set<RelativePath>() };
  bucket.seconds += seconds;
  if (!bucket.seen.has(testFile)) {
    bucket.seen.add(testFile);
    bucket.testFiles++;
  }
  buckets.set(id, bucket);
}

/** The newest list recorded at or before `at`; `null` with none. Lists are oldest first. */
function listAt(lists: readonly LoadedList[], at: EpochMs): LoadedList | null {
  let found: LoadedList | null = null;
  for (const list of lists) if (list.at <= at) found = list;
  return found;
}

interface ProjectFacts {
  readonly coverageOn: boolean;
  /** When the project's first list was recorded; `null` with none. */
  readonly first: EpochMs | null;
  /** Results but no coverage record at any current key: read as `isolate: false` (the store does not keep it). */
  readonly unisolated: boolean;
}

function projectFacts(tests: readonly TestReach[], coverage: ReachCoverage): ProjectFacts {
  const firsts = tests.flatMap((t) => t.test.loaded.lists.slice(0, 1).map((l) => l.at));
  const ran = tests.some((t) => t.test.current);
  const recorded = tests.some((t) => t.test.loaded.recordAt !== null);
  return {
    coverageOn: coverage.on,
    first: firsts.length === 0 ? null : Math.min(...firsts),
    unisolated: ran && !recorded,
  };
}

/**
 * Why no list applies, from the file's current key (decision (2),
 * 2026-11-14), in this order: coverage off; `isolate: false`; a failed run
 * with no coverage record (a failed load; a timeout stores no result); a
 * coverage record stored after the project's first list but no list (lost);
 * else never recorded.
 */
function reasonOf(reach: TestReach, facts: ProjectFacts): NoListDetail {
  const { loaded } = reach.test;
  if (!facts.coverageOn) return { reason: "coverage off", detail: null };
  if (loaded.lists.length > 0) {
    return { reason: "never recorded", detail: "edited before its first list" };
  }
  if (facts.unisolated) return { reason: "isolate: false", detail: null };
  if (loaded.failed && loaded.recordAt === null) return { reason: "incomplete run", detail: null };
  if (loaded.recordAt !== null && facts.first !== null) {
    if (loaded.recordAt >= facts.first) return { reason: "list lost", detail: null };
    return { reason: "never recorded", detail: "ran before lists were recorded" };
  }
  return { reason: "never recorded", detail: null };
}

/** With no list in the project, the one reason the section names. */
function noListsReason(facts: ProjectFacts): NoListReason {
  if (!facts.coverageOn) return "coverage off";
  return facts.unisolated ? "isolate: false" : "never recorded";
}
