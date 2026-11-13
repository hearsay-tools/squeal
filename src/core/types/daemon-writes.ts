import type { PayloadSchemaVersion, RelativePath, WorktreeId } from "./common.js";
import type { CheckKey, TestFileRef } from "./keys.js";
import type { ResultRecord } from "./store-records.js";

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

/** What an import added (spec 018 D3). */
export interface ImportCounts {
  readonly results: number;
  /** Results left as they were: the store held results at their key already. */
  readonly alreadyStored: number;
  readonly closures: number;
  readonly observed: number;
  readonly startup: number;
  /** Test files whose results went at their key here (018 D11), not at the exported key. */
  readonly rekeyed: number;
}

/**
 * Spec 021 D15 (row 021-20): asks the daemon to import an export file
 * (`squeal import`) in its retried path. An import creates tables, adds
 * check rows it reads back and can be tens of MB, which a sent batch
 * cannot carry, so the daemon reads the file and imports it itself.
 */
export interface ImportRequest {
  readonly type: "import";
  readonly worktreeId: WorktreeId;
  /** The `user_version` the command read its store at; another one is refused. */
  readonly storeSchema: number;
  /** The export file, an absolute path, which the daemon reads itself. */
  readonly file: string;
  /** SHA-256 of the bytes the command read and checked; other bytes are not imported. */
  readonly fileHash: string;
  readonly dryRun: boolean;
}

/** Asks how the import `requestId` went. */
export interface ImportStatusRequest {
  readonly type: "import-status";
  readonly requestId: string;
}

/**
 * How an import ended: what it added, and whether this repository holds the
 * export's commit (018 D11); or how long its last slice waited for a busy
 * store before the bound; or why it failed.
 */
export type ImportOutcome =
  | { readonly counts: ImportCounts; readonly commitHere: boolean }
  | { readonly busyMs: number }
  | FailedOutcome;

/** An import's state: `outcome` `null` while it runs. */
export interface ImportResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "import";
  readonly requestId: string;
  readonly outcome: ImportOutcome | null;
}

/** Why a request the daemon took did not end as asked. */
export interface FailedOutcome {
  readonly failed: string;
}

/**
 * Spec 021 D15 (row 021-20, part two): one try of one write of a test file
 * the code gate keeps (spec 020 D17.3, D17.5), run by the daemon that
 * holds the worktree's lock, in its retried path. The gate keeps the wait:
 * its bound, the notes and the check of the file's inputs after each
 * busy pause, as with no daemon.
 */
export interface KeepRequest {
  readonly type: "keep";
  /**
   * The try's own id, chosen by the gate (review 0.1.450 B2): a lost answer
   * is asked again by it (`keep-status`), and the daemon runs one id once.
   */
  readonly id: string;
  readonly worktreeId: WorktreeId;
  /** The `user_version` the gate read its store at; another one is refused. */
  readonly storeSchema: number;
  readonly write: KeepWrite;
}

/**
 * Row 020-48 (spec 020 D17.3): what one completed test file's gate run
 * read that the repository's shared observed rows (spec 016 D4) may lack.
 */
export interface SeenReads {
  readonly ref: TestFileRef;
  /** Its reads beyond its key (`ObservedGrowth.add`): the `observed.` row. */
  readonly add: readonly RelativePath[];
  /** What a process it started imported (`markDirect`): the `observedDirect.` row. */
  readonly direct: readonly RelativePath[];
  /** Its module loads (`markModules`): the `observedModules.` row. */
  readonly modules: readonly RelativePath[];
}

/**
 * What one try writes: the file's coverage record at its key (`putParts`),
 * or its results (`storeResults`) with the paths its heal is judged by and
 * the environment files its project's key read (`unresolvedPreloads`).
 * Row 020-48: or the reads of the gate's runs, merged into the shared
 * observed rows before any file is written at a key that holds them. A
 * daemon before this row refuses the kind.
 */
export type KeepWrite =
  | {
      readonly kind: "seen";
      readonly seen: readonly SeenReads[];
    }
  | {
      readonly kind: "coverage";
      readonly key: CheckKey;
      /** A `CoverageRecord` (spec 015 D8) as JSON. */
      readonly record: unknown;
    }
  | {
      readonly kind: "results";
      /** The file's key: every record's (review 0.1.450 B3). */
      readonly key: CheckKey;
      readonly records: readonly ResultRecord[];
      readonly paths: readonly RelativePath[];
      readonly environmentFiles: readonly RelativePath[];
    };

/** Asks how the keep try `requestId` (its `KeepRequest.id`) went. */
export interface KeepStatusRequest {
  readonly type: "keep-status";
  readonly requestId: string;
}

/** A try's end: `kept` false when a busy store refused it, so the gate pauses and tries again. */
export type KeepOutcome = { readonly kept: boolean } | FailedOutcome;

/** A keep try's state: `outcome` `null` while it runs. */
export interface KeepResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "keep";
  readonly requestId: string;
  readonly outcome: KeepOutcome | null;
}
