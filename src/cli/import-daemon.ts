import { setTimeout as sleep } from "node:timers/promises";
import { heartbeatFresh } from "../core/presence/heartbeat.js";
import type { EpochMs, WorktreeId } from "../core/types/common.js";
import type { DaemonResponse } from "../core/types/daemon.js";
import type { ImportOutcome, ImportResponse } from "../core/types/daemon-writes.js";
import type { Store } from "../core/types/store.js";
import { askDaemon } from "./daemon-access.js";

/** Pauses between the command's asks of how the daemon's import goes. */
const STATUS_PAUSES_MS = [20, 50, 100, 250] as const;

/** What the command asks the serving daemon to import. */
export interface SentImport {
  readonly worktreeId: WorktreeId;
  /** The export file, absolute. */
  readonly file: string;
  /** SHA-256 of the bytes the command read and checked. */
  readonly fileHash: string;
  readonly dryRun: boolean;
}

/**
 * Spec 021 D15 (row 021-20): `squeal import` through the daemon that serves
 * the worktree, as 021-16's writes go: only a daemon whose heartbeat is
 * fresh. The daemon reads the file and imports it in its retried path; the
 * command asks how it went until it ended. `null`: no daemon took it (none
 * serves, none answered, or it refused: a release before this request, a
 * stopping daemon, another store schema), so the command imports itself.
 * An import is idempotent, so one the daemon may have taken before it went
 * silent costs a second import at most. Once taken, a daemon that stops
 * answering is a failure: what it imported stays for the next import.
 */
export async function importThroughDaemon(
  store: Store,
  sent: SentImport,
  now: EpochMs,
): Promise<ImportOutcome | null> {
  const record = store.worktrees.get(sent.worktreeId)?.daemon ?? null;
  if (record === null || !heartbeatFresh(record, now)) return null;
  const socket = record.socketPath;
  const request = { type: "import", storeSchema: store.schemaVersion, ...sent } as const;
  const answer = await askDaemon(socket, request).catch(() => null);
  if (!isImport(answer)) return null;
  let state = answer;
  for (let attempt = 0; state.outcome === null; attempt++) {
    await sleep(STATUS_PAUSES_MS[Math.min(attempt, STATUS_PAUSES_MS.length - 1)]);
    const next = await askDaemon(socket, {
      type: "import-status",
      requestId: answer.requestId,
    }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    if (!isImport(next)) return { failed: silent(next) };
    state = next;
  }
  return state.outcome;
}

function isImport(answer: DaemonResponse | string | null): answer is ImportResponse {
  return typeof answer === "object" && answer?.ok === true && answer.type === "import";
}

function silent(answer: DaemonResponse | string | null): string {
  const why =
    answer === null
      ? "its socket is gone"
      : typeof answer === "string"
        ? answer
        : answer.ok
          ? `it answered ${answer.type}`
          : answer.error;
  return `the daemon took the import and then stopped answering (${why}); what it imported stays, run the command again`;
}
