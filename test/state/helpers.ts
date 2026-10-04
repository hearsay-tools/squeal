import { describeFailure } from "../../src/core/state/index.js";
import type {
  CheckError,
  CheckId,
  ResultRecord,
  RunOutcome,
  Store,
  TestCheckId,
  TestFileKeyRecord,
  TestFileRef,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

export const WT = "wt-a";
export const OTHER = "wt-b";
export const FILE: TestFileRef = { project: "", path: "src/a.test.ts" };

export function freshStore(): Store {
  return open(fakeCommonDir());
}

export function check(fullName: string, file: TestFileRef = FILE): TestCheckId {
  return { kind: "test", project: file.project, testPath: file.path, fullName };
}

export function fileOf(c: CheckId): TestFileRef {
  return { project: c.project, path: c.testPath };
}

/** A failure whose fingerprint is determined by `message`. */
export function failure(message: string, line = 3): CheckError {
  return {
    name: "AssertionError",
    message,
    stack: null,
    location: { path: "src/a.ts", line, column: 5 },
    diff: null,
  };
}

export interface ResultOptions {
  readonly key?: string;
  readonly message?: string;
  readonly worktreeId?: string;
  readonly revision?: number;
  readonly commit?: string | null;
}

/** A result with fingerprint and summary from `describeFailure`, as the scheduler builds them. */
export function result(c: CheckId, outcome: RunOutcome, options: ResultOptions = {}): ResultRecord {
  const errors = outcome === "fail" ? [failure(options.message ?? "expected 1 to be 2")] : [];
  const location = { path: c.testPath, line: 1, column: 1 };
  const described = outcome === "fail" ? describeFailure(errors, location) : null;
  return {
    check: c,
    key: options.key ?? "k1",
    outcome,
    durationMs: 5,
    location,
    fingerprint: described?.fingerprint ?? null,
    summary: described?.summary ?? null,
    errors,
    provenance: {
      worktreeId: options.worktreeId ?? WT,
      revision: options.revision ?? 1,
      commit: options.commit ?? "c0ffee",
      dirty: false,
      runId: "run-1",
      recordedAt: 1_000,
    },
  };
}

export function setKey(
  store: Store,
  key: string,
  options: { file?: TestFileRef; pending?: TestFileKeyRecord["pending"]; worktreeId?: string } = {},
): void {
  store.testFileKeys.upsertMany([
    {
      worktreeId: options.worktreeId ?? WT,
      testFile: options.file ?? FILE,
      key,
      revision: 1,
      pending: options.pending ?? null,
    },
  ]);
}
