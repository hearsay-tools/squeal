import { createHash } from "node:crypto";
import { listImports, sourceLabel } from "../store/imports.js";
import { decodeBundle } from "../store/transfer-bundle.js";
import { importRefusal, importResults } from "../store/transfer-import.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { Policy } from "../types/policy.js";
import type { Store } from "../types/store.js";
import {
  advertisedUpstream,
  firstParents,
  onFirstParentLine,
  startPoint,
  type Upstream,
  upstreamOf,
} from "./choose.js";
import { fetchExport } from "./fetch.js";
import { failureOf, networkEnv } from "./git.js";
import { blobsAt, HEAD_TIMEOUT_MS, headOf } from "./local.js";
import { refOf, remoteExports } from "./refs.js";

/*
 * Spec 018 D14: with `shared.ref` set, the daemon imports CI's export of the
 * worktree's nearest main commit, in the background, at start and when that
 * commit changes. One export per start point, no gap filling from older
 * ones (`transport.md` Q4). A miss or an error only means local runs; a
 * failed or slow fetch is one status note (D15). Network I/O only here.
 *
 * Row 018-20 R1: each nudge computes the start point again from local git,
 * since a `git fetch` moves it while `HEAD` stays; and one stop ends every
 * step, so no git starts after `close()`. Row 018-23: the stop kills every
 * git the reader starts, the `HEAD` read and the commit's listing too.
 * Row 018-28: a clone without `refs/remotes/origin/HEAD`, or whose one names
 * a branch the clone does not hold (R2), takes the default branch the remote
 * advertises, under the listing's kill timer.
 */

/** The kill timer of the listing (`transport.md` Q3: 0.45 to 0.6 s to GitHub). */
export const LIST_TIMEOUT_MS = 5_000;
/** The kill timer of the fetch of about 2 MB (1.3 to 2.5 s to GitHub). */
export const FETCH_TIMEOUT_MS = 10_000;

/** The step the socket names while the main thread imports (row 011-302). */
export const IMPORT_STEP = "importing CI results";

export interface SharedReaderOptions {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The repository's shared store. */
  readonly store: Store;
  readonly policy: () => Policy;
  readonly now: () => number;
  /** A status note: a failed or slow fetch, or a refused export. */
  readonly note: (text: string) => void;
  readonly log: (text: string) => void;
  /** Results were added: the daemon looks them up (as `squeal import` tells it). */
  readonly imported: () => void;
  /** The main thread's import, for the socket to name meanwhile. */
  readonly step?: (operation: string, running: boolean) => void;
  readonly listTimeoutMs?: number;
  readonly fetchTimeoutMs?: number;
  /** The kill timer of `HEAD` read through git (`HEAD_TIMEOUT_MS`). */
  readonly headTimeoutMs?: number;
}

export interface SharedReader {
  /** Looks again, in the background: at start and after each stored batch. */
  nudge(): void;
  /** Resolves once no pass runs or is due; for tests and shutdown. */
  idle(): Promise<void>;
  /** Kills every git in flight; no git, fetch or import starts after. */
  close(): void;
}

export function createSharedReader(options: SharedReaderOptions): SharedReader {
  return new Reader(options);
}

/** Thrown by a step of a pass once the reader is closed; the loop ends quietly. */
const STOPPED = Symbol("stopped");

class Reader implements SharedReader {
  /** The `shared.ref` and start point last handled: one export per start point. */
  #start: string | null = null;
  #running: Promise<void> | null = null;
  #again = false;
  /** Row 018-28: the remote's advertised default branch, or the `HEAD` at which asking found none. */
  #asked: Upstream | { readonly missedAt: string } | null = null;
  /** The reader's one stop: each step checks it, and each git call it starts is killed by it. */
  readonly #stop = new AbortController();

  constructor(private readonly o: SharedReaderOptions) {}

  nudge(): void {
    if (this.#stop.signal.aborted || this.o.policy().shared.ref === null) return;
    if (this.#running !== null) {
      this.#again = true;
      return;
    }
    this.#running = this.#loop().finally(() => {
      this.#running = null;
    });
  }

  async idle(): Promise<void> {
    while (this.#running !== null) await this.#running;
  }

  close(): void {
    this.#stop.abort();
  }

  async #loop(): Promise<void> {
    do {
      this.#again = false;
      try {
        await this.#pass();
      } catch (error) {
        if (error === STOPPED) return;
        this.o.log(`CI results: ${error instanceof Error ? error.message : String(error)}`);
      }
    } while (this.#again && !this.#stop.signal.aborted);
  }

  /** One awaited step of a pass: none starts after the stop, and none goes on past it. */
  async #live<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const { signal } = this.#stop;
    if (signal.aborted) throw STOPPED;
    const value = await work(signal);
    if (signal.aborted) throw STOPPED;
    return value;
  }

  async #pass(): Promise<void> {
    const prefix = this.o.policy().shared.ref;
    const { root } = this.o;
    if (prefix === null) return;
    const timeoutMs = this.o.headTimeoutMs ?? HEAD_TIMEOUT_MS;
    const head = await this.#live((signal) => headOf(root, { timeoutMs, signal }));
    if (head === null) return;
    const upstream =
      (await this.#live((signal) => upstreamOf(root, signal))) ?? (await this.#advertised(head));
    if (upstream === null) {
      if (this.#start !== "no upstream") {
        this.#start = "no upstream";
        this.o.note(
          "CI results: shared.ref is set, but no remote names its default branch; run `git remote set-head origin --auto`",
        );
      }
      return;
    }
    // The start point, not HEAD, decides: `git fetch` moves it while HEAD stays.
    const start = await this.#live((signal) => startPoint(root, head, upstream, signal));
    if (start === null || `${prefix} ${start}` === this.#start) return;
    this.#start = `${prefix} ${start}`;

    const candidates = await this.#live((signal) => firstParents(root, start, signal));
    const held = new Set(listImports(this.o.store).map((i) => i.header.commit));
    const nearestHeld = candidates.findIndex((c) => held.has(c));
    if (nearestHeld === 0) return;
    const reach = nearestHeld === -1 ? candidates.length : nearestHeld;

    const env = await this.#live((signal) => networkEnv(root, signal));
    const listMs = this.o.listTimeoutMs ?? LIST_TIMEOUT_MS;
    const listed = await this.#live((signal) =>
      remoteExports(root, upstream.remote, prefix, { timeoutMs: listMs, env, signal }),
    );
    if ("timedOut" in listed) {
      this.o.note(
        `CI results: could not list ${prefix} on ${upstream.remote} (${failureOf(listed, listMs)}); tests run here as before`,
      );
      return;
    }
    for (const commit of candidates.slice(0, reach)) {
      const oid = listed.get(commit);
      if (oid === undefined) continue;
      const ref = refOf(prefix, commit);
      const onLine = await this.#live((signal) =>
        onFirstParentLine(root, upstream.branch, commit, signal),
      );
      if (!onLine) {
        this.o.note(
          `CI results: refused ${ref}: its commit is not on ${upstream.branch}'s first-parent line`,
        );
        continue;
      }
      await this.#take(upstream.remote, ref, commit, oid, env);
      return;
    }
  }

  /**
   * Row 018-28: the default branch the remote advertises, when no local
   * `refs/remotes/<remote>/HEAD` names one. Found once for the reader's
   * life; a miss is asked again only once `HEAD` moved, so a batch reaches
   * no remote for it.
   */
  async #advertised(head: string): Promise<Upstream | null> {
    const asked = this.#asked;
    if (asked !== null && "remote" in asked) return asked;
    if (asked !== null && asked.missedAt === head) return null;
    const { root } = this.o;
    const env = await this.#live((signal) => networkEnv(root, signal));
    const timeoutMs = this.o.listTimeoutMs ?? LIST_TIMEOUT_MS;
    const found = await this.#live((signal) =>
      advertisedUpstream(root, { timeoutMs, env, signal }),
    );
    this.#asked = found ?? { missedAt: head };
    return found;
  }

  /** Fetches, checks and imports the export of `commit`. */
  async #take(
    remote: string,
    ref: string,
    commit: string,
    oid: string,
    env: Readonly<Record<string, string>>,
  ): Promise<void> {
    const timeoutMs = this.o.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
    const bytes = await this.#live((signal) =>
      fetchExport(this.o.root, remote, ref, oid, { timeoutMs, env, signal }),
    );
    if (!Buffer.isBuffer(bytes)) {
      const what = bytes.timedOut ? "took too long and was stopped" : `failed (${bytes.failed})`;
      this.o.note(`CI results: fetching ${ref} from ${remote} ${what}; tests run here as before`);
      return;
    }
    const bundle = decodeBundle(bytes);
    const refusal =
      typeof bundle === "string"
        ? bundle
        : bundle.header.commit !== commit
          ? `its header names commit ${bundle.header.commit ?? "none"}`
          : importRefusal(bundle);
    if (typeof bundle === "string" || refusal !== null) {
      this.o.note(`CI results: refused ${ref}: ${refusal}`);
      return;
    }
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const blobs = await this.#live((signal) => blobsAt(this.o.root, commit, signal));
    this.o.step?.(IMPORT_STEP, true);
    let added: number;
    try {
      added = importResults(this.o.store, bundle, {
        importId: fileHash.slice(0, 16),
        fileHash,
        now: this.o.now(),
        rekeying: { worktreeId: this.o.worktreeId, blobs },
      }).results;
    } catch (error) {
      // A busy store: the next nudge tries this start point again.
      this.#start = null;
      throw error;
    } finally {
      this.o.step?.(IMPORT_STEP, false);
    }
    this.o.log(`CI results: imported ${added} results from ${sourceLabel(bundle.header)}`);
    this.o.imported();
  }
}
