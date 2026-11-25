import { testFileId } from "../keys/reverse-index.js";
import type { TestFileRef } from "../types/keys.js";
import type { RunReport } from "../types/runner.js";
import type { Store } from "../types/store.js";

/*
 * Spec 026 D12 with spec 001 D6 (row 026-28): a failure a remote machine
 * produced names that machine. As the load per CPU (`load.ts`), the remote
 * is kept per run, only for runs that stored a failure, and within a run
 * per test file: a split runs some files here, and those keep none, so
 * their failures read as before.
 */

/** `meta` key of the remote that ran each failing file, by run id; shared. */
export const RUN_REMOTES_META_KEY = "failed-run-remotes";

/** The newest runs whose remotes are kept. */
export const RUN_REMOTES_KEPT = 1_024;

/** Each kept run's remotes, by test file id (`testFileId`). */
export type RunRemotes = ReadonlyMap<string, Readonly<Record<string, string>>>;

/** The remote that ran `testFile` in `report`; `undefined` when it ran here. */
export function remoteOf(report: RunReport, testFile: TestFileRef): string | undefined {
  if (report.fileRemotes === undefined) return report.remote;
  const id = testFileId(testFile);
  return report.fileRemotes.find((f) => testFileId(f.testFile) === id)?.remote;
}

/** The remote that ran `testFile` in run `runId`, as kept; `undefined` when none is. */
export function keptRemote(
  remotes: RunRemotes,
  runId: string,
  testFile: TestFileRef,
): string | undefined {
  return remotes.get(runId)?.[testFileId(testFile)];
}

/** Every kept run's remotes, oldest run first; empty when none parses. */
export function readRunRemotes(store: Store): Map<string, Readonly<Record<string, string>>> {
  const raw = store.meta.get(RUN_REMOTES_META_KEY);
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return new Map();
    return new Map(
      Object.entries(value).flatMap(([runId, files]) => {
        if (!isRecord(files)) return [];
        const kept = Object.entries(files).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        );
        return [[runId, Object.fromEntries(kept)]];
      }),
    );
  } catch {
    return new Map();
  }
}

/** Keeps the remote that ran `testFile` in run `runId`. */
export function recordRunRemote(
  store: Store,
  runId: string,
  testFile: TestFileRef,
  remote: string,
): void {
  store.transaction(() => {
    const remotes = readRunRemotes(store);
    const files = { ...remotes.get(runId), [testFileId(testFile)]: remote };
    remotes.delete(runId);
    remotes.set(runId, files);
    const newest = [...remotes].slice(-RUN_REMOTES_KEPT);
    store.meta.set(RUN_REMOTES_META_KEY, JSON.stringify(Object.fromEntries(newest)));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
