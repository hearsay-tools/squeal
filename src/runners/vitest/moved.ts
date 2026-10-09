import type { Vitest } from "vitest/node";
import type { AbsolutePath, RunReport, TestFileRef } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { refKey } from "./results.js";

/*
 * Task 001-146: what a run's report keeps once `SourceStamps` found bytes
 * the run read moved since it read them.
 */

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
 * `report` without `dropped`: their results, errors, durations and observed
 * inputs go, and `failure` says which files moved, so the scheduler records
 * them `unknown` with that reason (D5) instead of storing what they ran.
 */
export function withoutFiles(
  report: RunReport,
  dropped: readonly TestFileRef[],
  stale: readonly AbsolutePath[],
  paths: WorktreePaths,
): RunReport {
  if (dropped.length === 0) return report;
  const gone = new Set(dropped.map(refKey));
  const kept = (ref: TestFileRef) => !gone.has(refKey(ref));
  const moved = stale.map((file) => paths.toRelative(file) ?? file).join(", ");
  const reason = `vitest adapter: ${moved} changed on disk after this run loaded it; the run may have executed bytes no check key names (task 001-146)`;
  const { fileDurations, observed } = report;
  return {
    ...report,
    completedFiles: report.completedFiles.filter(kept),
    results: report.results.filter((r) =>
      kept({ project: r.check.project, path: r.check.testPath }),
    ),
    fileErrors: report.fileErrors.filter((e) => kept(e.testFile)),
    failure: report.failure === null ? reason : `${report.failure}\n${reason}`,
    ...(fileDurations ? { fileDurations: fileDurations.filter((d) => kept(d.testFile)) } : {}),
    ...(observed ? { observed: observed.filter((o) => kept(o.testFile)) } : {}),
  };
}
