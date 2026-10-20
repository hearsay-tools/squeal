import type { Vitest } from "vitest/node";
import { pathsReason } from "../../core/text.js";
import type { AbsolutePath, RunReport, TestFileRef } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { refKey } from "./results.js";
import type { Sorted } from "./touched.js";

/*
 * Task 001-146: what a run's report keeps once `SourceStamps` found bytes
 * the run read moved since it read them.
 */

/** What a dropped run's reason says first (task 011-02): the paths come after it. */
const UNKEYED = "vitest adapter: the run may have executed bytes no check key names";

/**
 * The run's test files that may have executed `stale`, files the run read
 * whose bytes moved since: those whose import graph in their project reaches
 * one. A stale file no test file of the run reaches was loaded by a
 * specifier Vite never saw (a computed `import()`), so every file of the run
 * may have executed it.
 */
export function mayHaveRun(
  vitest: Vitest,
  stale: readonly AbsolutePath[],
  testFiles: readonly TestFileRef[],
  paths: WorktreePaths,
): TestFileRef[] {
  const tainted = new Set<string>();
  for (const file of stale) {
    const reached = testFiles.filter((ref) => reaches(vitest, file, ref, paths));
    for (const ref of reached.length > 0 ? reached : testFiles) tainted.add(refKey(ref));
  }
  return testFiles.filter((ref) => tainted.has(refKey(ref)));
}

/** True when `ref`'s module imports `file`, directly or not, in some environment of its project. */
function reaches(
  vitest: Vitest,
  file: AbsolutePath,
  ref: TestFileRef,
  paths: WorktreePaths,
): boolean {
  const target = paths.toAbsolute(ref.path);
  for (const project of vitest.projects.filter((p) => p.name === ref.project)) {
    for (const environment of Object.values(project.vite.environments)) {
      type Node = NonNullable<ReturnType<typeof environment.moduleGraph.getModuleById>>;
      const queue: Node[] = [...(environment.moduleGraph.getModulesByFile(file) ?? [])];
      const seen = new Set<Node>();
      for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (node.file === target) return true;
        queue.push(...node.importers);
      }
    }
  }
  return false;
}

/**
 * `report` without `dropped`: their results, errors, durations, observed
 * inputs and reads go, and `failure` says which files moved, so the scheduler records
 * them `unknown` with that reason (D5) instead of storing what they ran.
 */
export function withoutFiles(
  report: RunReport,
  dropped: readonly TestFileRef[],
  stale: readonly AbsolutePath[],
  paths: WorktreePaths,
): RunReport {
  const moved = stale.map((file) => paths.toRelative(file) ?? file);
  const reason = pathsReason(
    `${UNKEYED}, since `,
    moved,
    (one) => `changed on disk after this run loaded ${one ? "it" : "them"}`,
    "task 001-146",
  );
  return dropFiles(report, dropped, reason);
}

/**
 * Task 013-02 (V5 as amended 2026-10-20): the run's test files that may have
 * read `touched` through a cache of the instance. An input read once: all
 * of them. A module path, per project of the run whose environments hold a
 * module of it: the files whose importer walk reaches one, or every file of
 * the run in that project when none does (a computed `import()`, a setup
 * file, `vi.importActual`, a `__mocks__` file). A project whose graphs hold
 * no module of it loses nothing: its containers never served those bytes.
 */
export function mayHaveReadTouched(
  vitest: Vitest,
  touched: Sorted,
  testFiles: readonly TestFileRef[],
  paths: WorktreePaths,
): TestFileRef[] {
  if (touched.inputs.length > 0) return [...testFiles];
  const index = touched.index;
  if (index === null || touched.modules.length === 0) return [];
  const tainted = new Set<string>();
  for (const project of vitest.projects) {
    const files = testFiles.filter((ref) => ref.project === project.name);
    if (files.length === 0) continue;
    const environments = Object.values(project.vite.environments);
    for (const file of touched.modules) {
      type Node = ReturnType<typeof index.start>[number];
      const queue: Node[] = environments.flatMap((environment) => index.start(environment, file));
      if (queue.length === 0) continue;
      const reached = new Set<string>();
      const seen = new Set<Node>();
      for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (node.file !== null) reached.add(node.file);
        queue.push(...node.importers);
      }
      const hit = files.filter((ref) => reached.has(paths.toAbsolute(ref.path)));
      for (const ref of hit.length > 0 ? hit : files) tainted.add(refKey(ref));
    }
  }
  return testFiles.filter((ref) => tainted.has(refKey(ref)));
}

/**
 * Task 001-159: `report` without `dropped`, since `touched` were written
 * during the run and ended as they were: a cache the run read may hold
 * their other bytes. Task 013-02: `touched` are the paths that counted.
 */
export function withoutTouched(
  report: RunReport,
  dropped: readonly TestFileRef[],
  touched: readonly string[],
): RunReport {
  const reason = pathsReason(
    `${UNKEYED}, since `,
    touched,
    (one) =>
      `${one ? "was" : "were"} written during this run and ended as ${one ? "it was" : "they were"}`,
    "task 001-159",
  );
  return dropFiles(report, dropped, reason);
}

function dropFiles(report: RunReport, dropped: readonly TestFileRef[], reason: string): RunReport {
  if (dropped.length === 0) return report;
  const gone = new Set(dropped.map(refKey));
  const kept = (ref: TestFileRef) => !gone.has(refKey(ref));
  const { fileDurations, observed, reads } = report;
  // Task 011-06: the completed files among them are withheld, and the scheduler queues them again.
  const withheld = [...(report.withheld ?? []), ...report.completedFiles.filter((f) => !kept(f))];
  return {
    ...report,
    completedFiles: report.completedFiles.filter(kept),
    ...(withheld.length > 0 ? { withheld } : {}),
    results: report.results.filter((r) =>
      kept({ project: r.check.project, path: r.check.testPath }),
    ),
    fileErrors: report.fileErrors.filter((e) => kept(e.testFile)),
    failure: report.failure === null ? reason : `${report.failure}\n${reason}`,
    ...(fileDurations ? { fileDurations: fileDurations.filter((d) => kept(d.testFile)) } : {}),
    ...(observed ? { observed: observed.filter((o) => kept(o.testFile)) } : {}),
    ...(reads ? { reads: reads.filter((o) => kept(o.testFile)) } : {}),
  };
}
