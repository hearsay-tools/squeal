import { testFileId } from "../keys/index.js";
import {
  type CheckKey,
  type RunReport,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { type Tier, unfinishedFiles } from "./tiers.js";

/*
 * Rows 011-66 and 011-106 (spec 011 C4, C9, C11; D12's no-loop rule): a
 * tier its daemon could not finish is an interrupted run, not a result:
 * one that crashed after the daemon's stop began, or one that ran while
 * the daemon's own runtime went, whose children then load a recorder that
 * is gone (gh-72, gh-70). Its files are queued again for the successor
 * once per key, as C11 queues a tier an install change overlapped; a
 * second interruption of a file at the same key records the run as usual,
 * so a run that stops its own daemon cannot loop. The second is usually
 * the successor's, so the key of each file's last re-queue outlives the
 * daemon, in `meta`. One entry per test file, the latest.
 */

/** One test file and the key its interrupted run was queued again at. */
interface Interrupted {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
}

/** `meta` key of a worktree's interrupted runs, a JSON array of `Interrupted`. */
export function interruptedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("interrupted", worktreeId);
}

/** How the daemon stood when a tier's record began. */
export interface Interruption {
  /** Its stop began (`SchedulerOptions.stopping`), and no stop's cancel cut the tier short. */
  readonly stopping: boolean;
  /** Its own runtime is gone (`SchedulerOptions.runtimeDir`): the run stores nothing. */
  readonly runtimeGone: boolean;
}

/**
 * The ids of `tier`'s files its record queues again as interrupted, and
 * remembers at the key each ran under: every file when the runtime went,
 * those a run that crashed while the daemon stopped did not complete;
 * each unless interrupted at that key before. In the record's transaction.
 */
export function interruptedFiles(
  context: Pick<SchedulerContext, "store" | "worktreeId">,
  ledger: Ledger,
  tier: Tier,
  report: RunReport,
  { stopping, runtimeGone }: Interruption,
): string[] {
  const crashed = stopping && report.end === "crashed";
  if (!runtimeGone && !crashed) return [];
  const unfinished = new Set(unfinishedFiles(tier, report));
  const entries = tier.files.filter(({ file }) => runtimeGone || unfinished.has(file.id));
  if (entries.length === 0) return [];
  const { store, worktreeId } = context;
  const memory = readInterrupted(store, worktreeId);
  const again: string[] = [];
  for (const { file, key } of entries) {
    if (memory.get(file.id)?.key === key) continue;
    memory.set(file.id, { testFile: file.ref, key });
    again.push(file.id);
  }
  const kept = [...memory].filter(([id]) => ledger.files.has(id)).map(([, entry]) => entry);
  store.meta.set(interruptedMetaKey(worktreeId), JSON.stringify(kept));
  return again;
}

/** The worktree's interrupted runs by `testFileId`; empty when the row is absent or does not parse. */
function readInterrupted(store: Store, worktreeId: WorktreeId): Map<string, Interrupted> {
  const raw = store.meta.get(interruptedMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return new Map();
    return new Map(value.filter(isInterrupted).map((e) => [testFileId(e.testFile), e]));
  } catch {
    return new Map();
  }
}

function isInterrupted(value: unknown): value is Interrupted {
  if (typeof value !== "object" || value === null) return false;
  const { testFile, key } = value as Record<string, unknown>;
  if (typeof key !== "string" || typeof testFile !== "object" || testFile === null) return false;
  const { project, path } = testFile as Record<string, unknown>;
  return typeof project === "string" && typeof path === "string";
}
