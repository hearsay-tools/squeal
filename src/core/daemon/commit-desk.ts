import type {
  CommitAskRequest,
  CommitAskResponse,
  CommitAskState,
  CommitReadRequest,
  CommitReadResponse,
  CommitSnapshot,
} from "../types/commit-ask.js";
import { PAYLOAD_SCHEMA_VERSION } from "../types/common.js";

/*
 * Spec 023 D7.3 as amended (row 023-40c): a commit daemon's asks as its
 * socket thread answers them, from memory (spec 001 D9: no handler awaits
 * the main thread). An ask is forwarded to the main thread (`AtAsks`) and
 * answered at once; a read answers the last snapshot the main thread sent,
 * with each ask forwarded since and not in it yet as `waiting`.
 */

/** Before the main thread's first snapshot: the install has not ended. */
const FIRST: CommitSnapshot = { setup: { phase: "install" }, asks: [] };

export class CommitDesk {
  #snapshot: CommitSnapshot = FIRST;
  readonly #forwarded = new Set<string>();
  /** The worker loads this file with types stripped: no parameter properties. */
  readonly #forward: (request: CommitAskRequest) => void;

  constructor(forward: (request: CommitAskRequest) => void) {
    this.#forward = forward;
  }

  /** The main thread's snapshot, at each change. */
  set(snapshot: CommitSnapshot): void {
    this.#snapshot = snapshot;
    for (const ask of snapshot.asks) this.#forwarded.delete(ask.owner);
  }

  ask(request: CommitAskRequest): CommitAskResponse {
    const known = this.#snapshot.asks.some((ask) => ask.owner === request.owner);
    if (!known && !this.#forwarded.has(request.owner)) {
      this.#forwarded.add(request.owner);
      this.#forward(request);
    }
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "commit-ask",
      owner: request.owner,
    };
  }

  read(request: CommitReadRequest): CommitReadResponse {
    const waiting = [...this.#forwarded].map(
      (owner): CommitAskState => ({
        owner,
        phase: "waiting",
        files: [],
        readers: {},
        problems: [],
      }),
    );
    const { owners } = request;
    const asks = [...this.#snapshot.asks, ...waiting].filter(
      (ask) => owners === undefined || owners.includes(ask.owner),
    );
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "commit-read",
      setup: this.#snapshot.setup,
      asks,
    };
  }
}
