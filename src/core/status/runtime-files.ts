import { loadPolicy } from "../daemon/policy.js";
import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/reverse-index.js";
import {
  type AppliedRuntimeFiles,
  runtimeFilesMetaKey,
  runtimePolicySignature,
} from "../keys/runtime-applied.js";
import type { RuntimeFilesStatus } from "../types/policy.js";
import type { Store } from "../types/store.js";

export function runtimeFilesStatus(
  store: Store,
  worktreeId: string,
  root: string,
): RuntimeFilesStatus | undefined {
  const policy = loadPolicy(root).policy;
  let applied: AppliedRuntimeFiles | undefined;
  try {
    const raw = store.meta.get(runtimeFilesMetaKey(worktreeId));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        isRecord(parsed) &&
        typeof parsed.signature === "string" &&
        Array.isArray(parsed.readers) &&
        Array.isArray(parsed.notes)
      )
        applied = parsed as unknown as AppliedRuntimeFiles;
    }
  } catch {
    /* A missing applied snapshot cannot establish a verified exclusion. */
  }
  if (policy.runtimeFiles.length === 0 && !applied?.readers.length) return undefined;
  const rows = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row.key]),
  );
  const readers = applied?.readers ?? [];
  return {
    pending:
      applied?.signature !== runtimePolicySignature(policy) ||
      readers.some(
        (reader) => !reader.verified || rows.get(testFileId(reader.testFile)) !== reader.key,
      ),
    readers,
    notes: applied?.notes ?? [],
  };
}

export function runtimeFilesLines(status: RuntimeFilesStatus | undefined): string[] {
  if (status === undefined) return [];
  return [
    ...(status.pending ? ["Runtime files: pending policy; classification is unverified"] : []),
    ...status.readers.flatMap((reader) => [
      ...reader.paths.map(
        (path) =>
          `${status.pending ? "Last applied runtime file" : "Runtime file"}: ${path} (observed bytes excluded by policy) [${reader.testFile.project}:${reader.testFile.path}]`,
      ),
      ...reader.conflicts.map(
        (conflict) =>
          `Runtime file conflict: ${conflict.path} (${conflict.reason}) [${reader.testFile.project}:${reader.testFile.path}]`,
      ),
    ]),
    ...status.notes,
    "Cached test results do not prove a runtime server is alive.",
  ];
}
