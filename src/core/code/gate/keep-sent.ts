import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { type DaemonRequestError, requestDaemon } from "../../daemon/client.js";
import { heartbeatFresh } from "../../presence/heartbeat.js";
import type { AbsolutePath, EpochMs, RelativePath, WorktreeId } from "../../types/common.js";
import type { DaemonRequest, DaemonResponse } from "../../types/daemon.js";
import type { KeepResponse, KeepWrite, SeenReads } from "../../types/daemon-writes.js";
import type { TestFileRef } from "../../types/keys.js";
import type { Store } from "../../types/store.js";
import { OlderDaemon } from "./keep-seen.js";
import type { KeepWriter, Tried } from "./keep-write.js";

/** How long the keeper waits for the daemon (review 0.1.450 B2). */
export interface DaemonWaits {
  /** One socket request's answer, which the desk gives from memory. */
  readonly answerMs: number;
  /** Asking again, by the try's id, how a try whose answer was lost went. */
  readonly reconcileMs: number;
}

export const DAEMON_WAITS: DaemonWaits = { answerMs: 2_000, reconcileMs: 10_000 };

/** Pauses between asks of how a try goes: a try waits one busy slice at most. */
const STATUS_PAUSES_MS = [5, 10, 25, 50] as const;

/** Pause between asks again after a lost answer. */
const RECONCILE_PAUSE_MS = 250;

/** The 020-28 note for a daemon that keeps the files: one before this request answers so. */
export const DAEMON_KEEPS_ITS_OWN = "a daemon runs in this worktree, and it keeps its own";

/**
 * Row 020-48: how many bytes one `seen` write is at most as JSON
 * (`partsOf`), far below a `keep` line's limit (`MAX_WRITE_LINE_BYTES`,
 * 32 MiB); a gate run's reads are some KB, so most runs send one.
 */
export const SEEN_BYTES = 4 * 1024 * 1024;

/**
 * Row 020-48: the refusals of a daemon before that row, to a `seen` write:
 * a kind it does not know, or no `keep` request at all.
 */
const OLDER_SEEN: ReadonlySet<string> = new Set([
  '"write.kind" must be "coverage" or "results"',
  'unknown request type "keep"',
  "this daemon takes no kept files",
]);

/** Socket errors that prove the request never reached a daemon. */
const NOT_REACHED: ReadonlySet<string> = new Set(["ENOENT", "ECONNREFUSED"]);

/**
 * Review 0.1.450 B2: a try the daemon took whose outcome it did not say
 * within `DaemonWaits.reconcileMs`; the write may have landed.
 */
export class KeepUnknown extends Error {}

/** A refusal the daemon gave: nothing was written. */
class KeepRefused extends Error {}

/**
 * Spec 021 D15 (row 021-20, part two): the keeper's writer while a daemon
 * holds the worktree's lock and serves it: each try of a file's coverage
 * record or results is a `keep` request with an id of its own, which the
 * daemon runs once in its retried path. The keeper's wait, its bound, its
 * notes and its check of the inputs after each pause stay with the keeper
 * (`keepFile`). Review 0.1.450 B2: an answer lost on the way back is asked
 * again by that id; the daemon runs one id once, so asking never writes
 * twice. A try the daemon does not know ran nowhere and is `lost`, so the
 * keeper tries anew; one it does not tell of within the bound is
 * `KeepUnknown`. B1: a refusal says why, and only a daemon before this
 * request gives the 020-28 note. Row 020-48: the runs' reads go first, as
 * `seen` writes of at most `SEEN_BYTES` each, which the daemon merges into
 * the shared observed rows; a daemon before that row refuses them, which
 * throws `OlderDaemon`.
 */
export function writeThroughDaemon(target: {
  readonly socketPath: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
  readonly waits?: DaemonWaits;
}): KeepWriter {
  const { socketPath, worktreeId, storeSchema } = target;
  const waits = target.waits ?? DAEMON_WAITS;
  const ask = (request: DaemonRequest) => requestDaemon(socketPath, request, waits.answerMs);

  /** How try `id` went, asked again until the bound while its answers are lost. */
  const statusOf = async (id: string): Promise<KeepResponse | "lost"> => {
    const until = Date.now() + waits.reconcileMs;
    for (;;) {
      let why: string;
      try {
        const answer = await ask({ type: "keep-status", requestId: id });
        if (isKeep(answer)) return answer;
        if (!answer.ok && answer.error.startsWith("unknown request id")) return "lost";
        why = whyNot(answer);
      } catch (error) {
        why = (error as Error).message;
      }
      if (Date.now() >= until) {
        throw new KeepUnknown(`the daemon took the write and did not say how it went: ${why}`);
      }
      await sleep(RECONCILE_PAUSE_MS);
    }
  };

  const tryOnce = async (write: KeepWrite): Promise<Tried> => {
    const id = randomUUID();
    let state: KeepResponse | "lost";
    try {
      const answer = await ask({ type: "keep", id, worktreeId, storeSchema, write });
      if (!isKeep(answer)) throw refusal(answer, write.kind);
      state = answer;
    } catch (error) {
      if (error instanceof KeepRefused || error instanceof OlderDaemon) throw error;
      const { code, message } = error as DaemonRequestError;
      if (NOT_REACHED.has(code)) throw new Error(`the daemon did not answer: ${message}`);
      // Sent, its answer lost: it may have run.
      state = await statusOf(id);
    }
    for (let n = 0; state !== "lost" && state.outcome === null; n++) {
      await sleep(STATUS_PAUSES_MS[Math.min(n, STATUS_PAUSES_MS.length - 1)]);
      state = await statusOf(id);
    }
    if (state === "lost" || state.outcome === null) return "lost";
    const { outcome } = state;
    if ("failed" in outcome) throw new Error(outcome.failed);
    return outcome.kept ? "kept" : "busy";
  };

  return {
    seen: async (seen) => {
      for (const part of partsOf(seen)) {
        const tried = await tryOnce({ kind: "seen", seen: part });
        if (tried !== "kept") return tried;
      }
      return "kept";
    },
    coverage: (file) => tryOnce({ kind: "coverage", key: file.key, record: file.record }),
    results: (file, records, keys) =>
      tryOnce({
        kind: "results",
        key: file.key,
        records,
        paths: file.paths,
        environmentFiles: keys.environmentFiles(file.ref.project),
      }),
  };
}

/**
 * Spec 021 D15 (row 021-20, part two): while a daemon holds the worktree's
 * lock, it writes the kept files when it serves (its heartbeat is fresh);
 * `null` when none does, and nothing is kept, as before this row.
 */
export function sentWriter(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  waits?: DaemonWaits,
): KeepWriter | null {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon === null || !heartbeatFresh(daemon, now)) return null;
  const { socketPath } = daemon;
  const storeSchema = store.schemaVersion;
  return writeThroughDaemon({ socketPath, worktreeId, storeSchema, ...(waits ? { waits } : {}) });
}

/**
 * The daemon's refusal of a try of a `kind` write: `OlderDaemon` for reads
 * a daemon before row 020-48 does not take; the 020-28 note for one before
 * this request; else its words.
 */
function refusal(answer: DaemonResponse, kind: KeepWrite["kind"]): Error {
  const why = whyNot(answer);
  if (kind === "seen" && OLDER_SEEN.has(why)) return new OlderDaemon(why);
  const older = why === 'unknown request type "keep"' || why === "this daemon takes no kept files";
  return new KeepRefused(older ? DAEMON_KEEPS_ITS_OWN : `the daemon refused the write: ${why}`);
}

/**
 * Review 0.1.465 S1: `seen` in order, in parts whose write, as JSON
 * (`{"kind":"seen","seen":[...]}`), is at most `bytes`. A file whose reads
 * do not fit goes on in an entry of its own `ref` in the next part, its
 * three lists in order, so the parts joined hold each list whole (the
 * merge adds). Only a path that with its file's ref alone passes `bytes`
 * goes past it, one to a part. The request around the write adds its type,
 * id, worktree and schema: a few hundred bytes, below a `keep` line's limit.
 */
export function partsOf(seen: readonly SeenReads[], bytes = SEEN_BYTES): SeenReads[][] {
  const parts = new SeenParts(bytes);
  for (const one of seen) {
    parts.start(one.ref);
    for (const list of LISTS) for (const path of one[list]) parts.add(list, path);
  }
  return parts.done();
}

const LISTS = ["add", "direct", "modules"] as const;

type Entry = { readonly ref: TestFileRef } & Record<(typeof LISTS)[number], RelativePath[]>;

/** The bytes of `value` as JSON. */
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** The bytes of a write with no reads: `{"kind":"seen","seen":[]}`. */
const FRAME = jsonBytes({ kind: "seen", seen: [] });

/** `partsOf`'s parts as they fill, with the bytes of the current part's write. */
class SeenParts {
  readonly #bytes: number;
  readonly #parts: Entry[][] = [];
  #part: Entry[] = [];
  #size = FRAME;
  #entry: Entry | null = null;

  constructor(bytes: number) {
    this.#bytes = bytes;
  }

  /** The next file, `ref`: an entry of its own, in this part while it fits. */
  start(ref: TestFileRef): void {
    this.#entry = null;
    this.#open(ref);
  }

  /** `path` on the current file's `list`; a new part, with a new entry of its ref, when it does not fit. */
  add(list: (typeof LISTS)[number], path: RelativePath): void {
    let entry = this.#entry as Entry;
    let cost = jsonBytes(path) + (entry[list].length > 0 ? 1 : 0);
    if (this.#size + cost > this.#bytes && !this.#alone(entry)) {
      if (this.#empty(entry)) this.#drop(entry);
      this.#close();
      entry = this.#open(entry.ref);
      cost = jsonBytes(path);
    }
    entry[list].push(path);
    this.#size += cost;
  }

  done(): SeenReads[][] {
    this.#close();
    return this.#parts;
  }

  #open(ref: TestFileRef): Entry {
    const entry: Entry = { ref, add: [], direct: [], modules: [] };
    if (this.#part.length > 0 && this.#size + 1 + jsonBytes(entry) > this.#bytes) this.#close();
    this.#size += jsonBytes(entry) + (this.#part.length > 0 ? 1 : 0);
    this.#part.push(entry);
    this.#entry = entry;
    return entry;
  }

  /** Whether `entry` is the current part's only entry and holds no path: a new part would not help. */
  #alone(entry: Entry): boolean {
    return this.#part.length === 1 && this.#empty(entry);
  }

  #empty(entry: Entry): boolean {
    return LISTS.every((list) => entry[list].length === 0);
  }

  /** Takes `entry`, the last of the part and empty, back out of it. */
  #drop(entry: Entry): void {
    this.#part.pop();
    this.#size -= jsonBytes(entry) + (this.#part.length > 0 ? 1 : 0);
  }

  #close(): void {
    if (this.#part.length > 0) this.#parts.push(this.#part);
    this.#part = [];
    this.#size = FRAME;
  }
}

function isKeep(answer: DaemonResponse): answer is KeepResponse {
  return answer.ok && answer.type === "keep";
}

function whyNot(answer: DaemonResponse): string {
  return answer.ok ? `it answered ${answer.type}` : answer.error;
}
