import { compare } from "../fs/compare.js";
import type { EpochMs, RelativePath } from "../types/common.js";
import type { Analysis, TestReach } from "./analyze.js";
import { IMPORT_KINDS } from "./pairs.js";
import type {
  NarrowingEstimate,
  NarrowingFile,
  NoList,
  NoListDetail,
  NoListReason,
} from "./report-types.js";
import type { LoadedList, ReachCoverage, ReachEdit } from "./types.js";

/*
 * Spec 022 D4: per project, the re-run seconds that narrowing each test
 * file's import closure to the modules it loaded would save, over D11's
 * window of edits. An upper bound on phase 2's saving, not proof of waste.
 *
 * Decisions of row 022-04 (the coordinator, 2026-11-14): the store keeps no
 * past keys, so the list of an edit is the newest recorded at or before the
 * edit's time. The reasons a file has no list are read from its current key,
 * in `reasonOf`'s order.
 */

interface ProjectSums {
  readonly runner: TestReach["test"]["runner"];
  readonly tests: TestReach[];
  rerun: number;
  avoidable: number;
  readonly files: Map<RelativePath, number>;
  readonly noList: Map<string, NoList & { testFiles: number; readonly seen: Set<RelativePath> }>;
}

export function narrowingEstimates(
  analysis: Analysis,
  coverage: ReachCoverage,
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
    };
    sums.tests.push(reach);
    projects.set(project, sums);
  }
  return [...projects.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([project, sums]) => estimateOf(project, sums, analysis.kept, coverage, limit));
}

function estimateOf(
  project: string,
  sums: ProjectSums,
  edits: readonly ReachEdit[],
  coverage: ReachCoverage,
  limit: number,
): NarrowingEstimate {
  const lists = "lists: the newest recorded at or before each edit";
  if (sums.runner !== "vitest") {
    return { project, status: "not Vitest", lists, ...EMPTY };
  }
  const facts = projectFacts(sums.tests, coverage);
  // The paths whose edit re-keys each test file: itself, its closure, its setup files.
  const keyedBy = sums.tests
    .filter((reach) => reach.test.closure !== null)
    .map((reach) => {
      const paths = new Set([
        reach.test.ref.path,
        ...(reach.test.closure ?? []),
        ...reach.kinds.keys(),
      ]);
      return [reach, paths] as const;
    });
  for (const edit of edits) {
    for (const [reach, keyed] of keyedBy) addPair(sums, reach, keyed, edit, facts);
  }
  const withoutList = [...sums.noList.values()]
    .map(({ reason, detail, testFiles, seconds }) => ({ reason, detail, testFiles, seconds }))
    .sort(
      (a, b) =>
        b.testFiles - a.testFiles ||
        compare(a.reason, b.reason) ||
        compare(a.detail ?? "", b.detail ?? ""),
    );
  if (facts.first === null) {
    return {
      project,
      status: "no lists",
      lists,
      ...EMPTY,
      reason: noListsReason(facts),
      withoutList,
    };
  }
  const ranked = [...sums.files.entries()].sort(([a, x], [b, y]) => y - x || compare(a, b));
  const files = ranked.slice(0, limit).map(
    ([path, seconds]): NarrowingFile => ({
      path,
      avoidableSeconds: seconds,
      importedBy: sums.tests.filter((t) => IMPORT_KINDS.has(t.kinds.get(path) ?? "setup")).length,
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
  };
}

const EMPTY = {
  rerunSeconds: 0,
  avoidableSeconds: 0,
  share: 0,
  files: [],
  moreFiles: 0,
  withoutList: [],
} as const;

/** One (edit, test file) pair: re-run seconds, and avoidable or why no list tells. */
function addPair(
  sums: ProjectSums,
  reach: TestReach,
  keyedBy: ReadonlySet<RelativePath>,
  edit: ReachEdit,
  facts: ProjectFacts,
) {
  const { test } = reach;
  const changed = edit.paths.filter((p) => keyedBy.has(p));
  if (changed.length === 0) return;
  const seconds = test.seconds ?? 0;
  sums.rerun += seconds;
  const list = listAt(test.loaded.lists, edit.at);
  if (list === null) {
    const { reason, detail } = reasonOf(reach, facts);
    const id = `${reason}\0${detail ?? ""}`;
    const entry = sums.noList.get(id) ?? {
      reason,
      detail,
      testFiles: 0,
      seconds: 0,
      seen: new Set(),
    };
    entry.seconds += seconds;
    if (!entry.seen.has(test.ref.path)) {
      entry.seen.add(test.ref.path);
      entry.testFiles++;
    }
    sums.noList.set(id, entry);
    return;
  }
  // D4: a change through any input other than an import-graph path the list does not hold is never avoidable.
  const avoidable = changed.every((p) => {
    const kind = reach.kinds.get(p);
    return kind !== undefined && IMPORT_KINDS.has(kind) && !list.paths.has(p);
  });
  if (!avoidable) return;
  sums.avoidable += seconds;
  // Decision (3), 2026-11-14: a pair re-keyed by several files splits its seconds evenly among them.
  for (const path of changed) {
    sums.files.set(path, (sums.files.get(path) ?? 0) + seconds / changed.length);
  }
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
