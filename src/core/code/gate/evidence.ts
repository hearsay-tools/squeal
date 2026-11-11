import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunnerAdapter, RunReport } from "../../types/runner.js";
import type { Picked } from "./prerun.js";
import type { Mapped } from "./records.js";
import type { Runner } from "./runners.js";
import type { LeftOutFile } from "./scope.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D3: what the collector knows of one selected test file, from
 * its run's report and its mapped record, and from its runner's closure
 * when it did not run (D14.2, D15.3).
 */

/** The failed name of a completed file's import or syntax failure, which has no test name. */
export const FILE_ERROR = "(file-level error)";

/** The sources `ref`'s closure loads, sorted; `null` when the runner cannot give its closure. */
export function loadsOf(adapter: RunnerAdapter, ref: TestFileRef): Promise<RelativePath[] | null> {
  return adapter.closure(ref).then(
    (closure) => [...closure.paths].sort(compare),
    () => null,
  );
}

/**
 * One selected file's evidence; a file that did not complete keeps no
 * failure, no skip and no record. A skipped test is D11.3's: its record
 * proves a pass and never a violation. With `children`, its child files
 * are counted, none when it has no record.
 */
export async function evidenceOf(
  runner: Runner,
  ref: TestFileRef,
  report: RunReport | null,
  records: ReadonlyMap<string, Mapped>,
  children: boolean,
): Promise<TestFileEvidence> {
  const key = testFileId(ref);
  const completed = report?.completedFiles.some((done) => testFileId(done) === key) === true;
  const own = (r: { testFile: TestFileRef }) => testFileId(r.testFile) === key;
  const results = !completed
    ? []
    : (report?.results ?? []).filter(
        (r) => r.check.project === ref.project && r.check.testPath === ref.path,
      );
  const failed = [
    ...(completed && report?.fileErrors.some(own) === true ? [FILE_ERROR] : []),
    ...results.filter((r) => r.outcome === "fail").map((r) => r.check.fullName),
  ];
  const skipped = results.some((r) => r.outcome === "skip");
  const loads = await loadsOf(runner.adapter, ref);
  const mapped = completed ? records.get(key) : undefined;
  const record = mapped?.record ?? null;
  const counts = children ? { children: mapped?.children ?? { read: 0, dropped: 0 } } : {};
  return {
    runner: runner.kind,
    path: ref.path,
    completed,
    failed,
    skipped,
    loads,
    record,
    ...counts,
  };
}

/**
 * D14.2: each file the scope left out with its closure, read with no run
 * and no setup; `null` when the runner cannot give it. None with no scope.
 */
export async function leftOutFiles(picked: readonly Picked[]): Promise<LeftOutFile[]> {
  const files: LeftOutFile[] = [];
  for (const { kind, adapter, leftOut } of picked) {
    for (const { ref, group } of leftOut) {
      files.push({ runner: kind, path: ref.path, group, loads: await loadsOf(adapter, ref) });
    }
  }
  return files;
}
