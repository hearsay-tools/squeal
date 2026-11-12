import { randomUUID } from "node:crypto";
import { PAYLOAD_SCHEMA_VERSION, type WorktreeId } from "../types/common.js";
import type { DaemonErrorResponse, DaemonPhase } from "../types/daemon.js";
import type {
  ImportOutcome,
  ImportRequest,
  ImportResponse,
  ImportStatusRequest,
} from "../types/daemon-writes.js";
import { errorResponse } from "./protocol.js";
import type { ImportRequests } from "./write-protocol.js";

/** Import states remembered for status requests; older ones are dropped. */
const REMEMBERED = 16;

export interface ImportDeskContext {
  readonly worktreeId: WorktreeId;
  /** `user_version` of the daemon's store; an import read at another one is refused. */
  readonly storeSchema: number;
  /** Imports one export file in the daemon's retried path (`importInDaemon`). */
  readonly requestImport: (request: ImportRequest) => Promise<ImportOutcome>;
}

/**
 * Spec 021 D15 (row 021-20): the socket's side of `squeal import` through
 * the daemon. It hands each import to the main thread, which owns the
 * store, and keeps its outcome in memory for the command's status requests,
 * as the write desk keeps a write's. Every refusal is an error answer, so
 * the command writes the store itself.
 */
export class ImportDesk {
  readonly #context: ImportDeskContext;
  readonly #imports = new Map<string, { outcome: ImportOutcome | null }>();

  constructor(context: ImportDeskContext) {
    this.#context = context;
  }

  /** The answer to `request`. A stopping daemon takes no new import. */
  answer(request: ImportRequests, phase: DaemonPhase): ImportResponse | DaemonErrorResponse {
    if (request.type === "import-status") return this.status(request);
    if (phase === "stopping") return errorResponse("daemon is stopping");
    return this.import(request);
  }

  import(request: ImportRequest): ImportResponse | DaemonErrorResponse {
    const { worktreeId, storeSchema } = this.#context;
    if (request.worktreeId !== worktreeId) {
      return errorResponse(`this daemon serves worktree ${worktreeId}, not ${request.worktreeId}`);
    }
    if (request.storeSchema !== storeSchema) {
      return errorResponse(
        `the daemon's store is at schema ${storeSchema}, not ${request.storeSchema}`,
      );
    }
    const requestId = randomUUID();
    const state: { outcome: ImportOutcome | null } = { outcome: null };
    this.#imports.set(requestId, state);
    for (const old of this.#imports.keys()) {
      if (this.#imports.size <= REMEMBERED) break;
      this.#imports.delete(old);
    }
    this.#context.requestImport(request).then(
      (outcome) => {
        state.outcome = outcome;
      },
      (error: unknown) => {
        state.outcome = { failed: error instanceof Error ? error.message : String(error) };
      },
    );
    return importAnswer(requestId, state.outcome);
  }

  status(request: ImportStatusRequest): ImportResponse | DaemonErrorResponse {
    const state = this.#imports.get(request.requestId);
    if (state === undefined) return errorResponse(`unknown request id ${request.requestId}`);
    return importAnswer(request.requestId, state.outcome);
  }
}

function importAnswer(requestId: string, outcome: ImportOutcome | null): ImportResponse {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "import", requestId, outcome };
}
