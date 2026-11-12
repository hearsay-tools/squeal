import type { PayloadSchemaVersion, WorktreeId } from "./common.js";

/*
 * Spec 021 D15 (row 021-16): hooks and the writing CLI commands send their
 * store writes to the daemon that serves their worktree, which writes them
 * in its retried path. A client takes the worktree's write lease, keeps
 * every write of its transactions as statements, and sends each batch;
 * the lease keeps two clients from deciding on the same rows at once,
 * where SQLite's write lock did. A daemon before these requests answers
 * "unknown request type", and the client writes the store itself.
 */

/**
 * One parameter of a sent statement. JSON has no bigint or bytes, so they
 * travel as `{ "bigint": "<decimal>" }` and `{ "bytes": "<base64>" }`.
 */
export type SentParam =
  | null
  | number
  | string
  | { readonly bigint: string }
  | { readonly bytes: string };

/**
 * A batch of write statements, run by the daemon in one transaction, in
 * order. Each row is `[index into sqls, ...params]`, since one statement
 * often repeats thousands of times (a registration writes a view per
 * known state).
 */
export interface SentBatch {
  readonly sqls: readonly string[];
  readonly rows: readonly (readonly [number, ...SentParam[]])[];
}

/**
 * The process a lease is taken for. Review 0.1.442 B3: a client paused
 * between deciding a report and handing it to its host keeps its lease
 * while this process lives, and loses it once the process is gone.
 */
export interface LeaseProcess {
  readonly pid: number;
  /** Field 22 of `/proc/<pid>/stat` and the PID namespace, where `/proc` exists; else `null`. */
  readonly startTime: number | null;
  readonly pidNamespace: string | null;
}

/** Takes the worktree's write lease for `holder` (a pid and a name, for the daemon's log). */
export interface LeaseRequest {
  readonly type: "lease";
  readonly worktreeId: WorktreeId;
  readonly holder: string;
  /** The client's process; absent (a client before review 0.1.442 B3), the lease ends by time alone. */
  readonly process?: LeaseProcess;
}

/**
 * The lease: its token, or `null` while another client holds it, with that
 * holder. It ends after `ttlMs` without a write or another lease request
 * under its token.
 */
export interface LeaseResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "lease";
  readonly token: string | null;
  readonly ttlMs: number;
  readonly holder: string | null;
}

/** Ends the lease `token` holds; nothing when it ended already. */
export interface ReleaseRequest {
  readonly type: "release";
  readonly worktreeId: WorktreeId;
  readonly token: string;
}

export interface ReleaseResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "release";
}

/**
 * Writes `batch` in one transaction. `storeSchema` is the `user_version`
 * the client read its store at; another one is refused. `token` names the
 * lease the batch was decided under, `null` for none; `release` ends that
 * lease once the batch is written or has failed.
 */
export interface WriteRequest {
  readonly type: "write";
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
  readonly token: string | null;
  readonly release: boolean;
  readonly batch: SentBatch;
}

/** Asks how the write `requestId` went. */
export interface WriteStatusRequest {
  readonly type: "write-status";
  readonly requestId: string;
}

/**
 * A write's state: `written` once its transaction committed, `false` once it
 * failed (`error` says why), `null` while a busy store keeps it waiting.
 */
export interface WriteResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "write";
  readonly requestId: string;
  readonly written: boolean | null;
  readonly error: string | null;
}
