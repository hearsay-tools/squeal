import { spawn } from "node:child_process";
import { setPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import {
  BUSY_SLICE_MS,
  busyBackoffMs,
  isBusy,
  isCorruption,
  META_FULL_CHECK,
  markStore,
  type StoreMark,
  storePaths,
  withBusySliceSync,
} from "../store/index.js";
import type { AbsolutePath, EpochMs, Store } from "../types/index.js";
import { TEST_NICE } from "./low-priority.js";

/**
 * Spec 011, store failures as amended 2026-10-25 (row 011-226): a daemon
 * start runs `quick_check`; the full `integrity_check` runs after a daemon
 * serves, at most once per store in this period.
 */
export const FULL_CHECK_EVERY_MS = 24 * 60 * 60_000;

/** The check stops at this many problems: a store that has them is moved aside anyway. */
const MAX_PROBLEMS = 10;

/**
 * The check's process: opens the store read-only and prints what
 * `integrity_check` found, or the error that stopped it, as JSON. Code of its
 * own, so it needs no file beside the bundle.
 */
const SCRIPT = `
const { DatabaseSync } = require("node:sqlite");
let out;
try {
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  const rows = db.prepare("PRAGMA integrity_check(" + Number(process.argv[2]) + ")").all();
  out = { messages: rows.map((row) => String(row.integrity_check)) };
  db.close();
} catch (error) {
  out = { error: String(error && error.message), errcode: error && error.errcode };
}
process.stdout.write(JSON.stringify(out));
`;

/** What a full check found: nothing, a fault, or no answer (it could not run, or was stopped). */
export type FullCheckOutcome =
  | { readonly ok: true }
  | { readonly problem: string }
  | { readonly unrun: string };

/** A full check in its own process. */
export interface FullCheck {
  readonly pid: number | undefined;
  readonly done: Promise<FullCheckOutcome>;
  stop(): void;
}

/**
 * Runs `integrity_check` on `database` in a child process at nice 10, as
 * test processes run (001 D11 Priority), so the daemon's main thread answers
 * hooks meanwhile and the 24 s on an 850 MB store yield to other work (row
 * 011-223).
 */
export function runFullCheck(database: AbsolutePath): FullCheck {
  const { NODE_OPTIONS: _, ...env } = process.env;
  const child = spawn(process.execPath, ["-e", SCRIPT, database, String(MAX_PROBLEMS)], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    if (child.pid !== undefined) setPriority(child.pid, TEST_NICE);
  } catch {
    // Gone already, or not permitted: it runs at the daemon's priority.
  }
  const done = new Promise<FullCheckOutcome>((resolve) => {
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", (error) => resolve({ unrun: error.message }));
    child.on("close", (code, signal) => resolve(outcomeOf(out, code, signal)));
  });
  return { pid: child.pid, done, stop: () => void child.kill() };
}

function outcomeOf(out: string, code: number | null, signal: string | null): FullCheckOutcome {
  try {
    const read = JSON.parse(out) as { messages?: unknown; error?: unknown; errcode?: unknown };
    if (Array.isArray(read.messages)) {
      const messages = read.messages.map(String);
      return messages.length === 1 && messages[0] === "ok"
        ? { ok: true }
        : { problem: messages.join("; ") };
    }
    if (typeof read.error === "string") {
      return isCorruption({ errcode: read.errcode })
        ? { problem: read.error }
        : { unrun: read.error };
    }
  } catch {
    // No answer printed: the process died or was stopped.
  }
  return { unrun: `the check's process ended with ${signal ?? `code ${code}`}` };
}

/** The claim a daemon took: the start it wrote and the row's value before it. */
interface Claim {
  readonly at: EpochMs;
  readonly before: string | null;
}

/**
 * Takes the full check's claim in a write transaction: when no full check
 * started in the last `FULL_CHECK_EVERY_MS`, writes `at` as the last one's
 * start. A start recorded after `at` (a clock set back) is no claim held.
 */
export function claimFullCheck(store: Store, at: EpochMs): Claim | null {
  return store.transaction(() => {
    const before = store.meta.get(META_FULL_CHECK);
    const last = before === null ? Number.NaN : Number(before);
    if (last <= at && at - last < FULL_CHECK_EVERY_MS) return null;
    store.meta.set(META_FULL_CHECK, String(at));
    return { at, before };
  });
}

/** Gives a claim back while the row still holds it, so the next daemon's start runs the check. */
function releaseClaim(store: Store, claim: Claim): void {
  store.transaction(() => {
    if (store.meta.get(META_FULL_CHECK) !== String(claim.at)) return;
    if (claim.before === null) store.meta.delete(META_FULL_CHECK);
    else store.meta.set(META_FULL_CHECK, claim.before);
  });
}

export interface FullCheckContext {
  readonly store: Store;
  readonly commonDir: AbsolutePath;
  readonly now: () => EpochMs;
  /** A persisted note, for status. */
  readonly note: (text: string) => void;
  readonly log: (line: string) => void;
  /** Default `runFullCheck`. */
  readonly run?: (database: AbsolutePath) => FullCheck;
}

/**
 * How long a claim given back may wait for a busy store (review 0.1.329, B1):
 * the start's own bound, `DAEMON_START_BUSY_TIMEOUT_MS`. Past it the claim
 * stays, logged, and no full check runs on the store that day.
 */
export const RELEASE_WITHIN_MS = 120_000;

/**
 * Row 011-226, once the daemon serves: takes the day's claim and, holding
 * it, runs the full check off the main thread. A fault marks the store
 * (`markStore`) and leaves a note; every daemon on the store exits at its
 * next heartbeat (`storeCondemned`), and the next start moves the store
 * aside. A check that could not run gives its claim back, and so does one
 * the returned function stops before it ended, so the next start runs it.
 *
 * Review 0.1.329, B1 and S1: the claim and its return are C8's sliced
 * writes, each try waiting at most `BUSY_SLICE_MS` for a busy store and
 * tried again after `busyBackoffMs`, so the main thread is never held
 * longer. The returned function resolves once the claim is given back, or
 * after `RELEASE_WITHIN_MS`: the shutdown awaits it before the store closes.
 */
export function startFullCheck(context: FullCheckContext): () => Promise<void> {
  const owner = new FullCheckOwner(context);
  return () => owner.stop();
}

class FullCheckOwner {
  readonly #context: FullCheckContext;
  #stopped = false;
  #claim: Claim | null = null;
  #check: FullCheck | null = null;
  /** The check ended with an answer (passed, or a fault marked): its claim stays. */
  #answered = false;
  #release: Promise<void> | null = null;
  readonly #run: Promise<void>;

  constructor(context: FullCheckContext) {
    this.#context = context;
    this.#run = this.#start().catch((error: unknown) =>
      context.log(`full integrity check failed: ${String(error)}`),
    );
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#check?.stop();
    await this.#run;
    await this.#giveBack();
  }

  async #start(): Promise<void> {
    const { store, commonDir, now, log } = this.#context;
    let claim: Claim | null | undefined;
    try {
      claim = await sliced(
        () => claimFullCheck(store, now()),
        () => this.#stopped,
      );
    } catch (error) {
      log(`full integrity check not claimed: ${String(error)}`);
      return;
    }
    if (claim === undefined || claim === null) return;
    this.#claim = claim;
    // Stopped while the claim was taken: the stop gives it back.
    if (this.#stopped) return;
    this.#check = (this.#context.run ?? runFullCheck)(storePaths(commonDir).database);
    const outcome = await this.#check.done;
    if ("ok" in outcome) {
      this.#answered = true;
      log("full integrity check: ok");
    } else if ("problem" in outcome) {
      this.#answered = true;
      failed(this.#context, { at: now(), problem: outcome.problem });
    } else {
      log(`full integrity check ${this.#stopped ? "stopped" : `did not run: ${outcome.unrun}`}`);
      await this.#giveBack();
    }
  }

  /** Gives the claim back once, unless the check answered; later calls wait for the same return. */
  #giveBack(): Promise<void> {
    const claim = this.#claim;
    if (claim === null || this.#answered) return Promise.resolve();
    this.#release ??= (async () => {
      const { store, log } = this.#context;
      const deadline = performance.now() + RELEASE_WITHIN_MS;
      try {
        const done = await sliced(
          () => {
            releaseClaim(store, claim);
            return true;
          },
          () => performance.now() >= deadline,
        );
        if (done !== true) {
          log(
            `full integrity check claim not given back: the store stayed busy for ${RELEASE_WITHIN_MS} ms`,
          );
        }
      } catch (error) {
        log(`full integrity check claim not given back: ${String(error)}`);
      }
    })();
    return this.#release;
  }
}

/**
 * Spec 011 C8's busy writes, for one write: each try waits at most
 * `BUSY_SLICE_MS` for a busy store, and the next follows `busyBackoffMs`
 * later, so the event loop runs between them. `undefined` once `giveUp`
 * says so before a try; any error but busy is thrown.
 */
async function sliced<T>(write: () => T, giveUp: () => boolean): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    if (giveUp()) return undefined;
    try {
      return withBusySliceSync(BUSY_SLICE_MS, write);
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
    await sleep(busyBackoffMs(attempt));
  }
}

function failed(context: FullCheckContext, mark: StoreMark): void {
  try {
    markStore(context.commonDir, mark);
  } catch (error) {
    context.log(`could not mark the store: ${String(error)}`);
  }
  context.note(
    `the full integrity check of the store found a fault (${mark.problem}); every daemon on ` +
      "this store stops at its next heartbeat, and the next start moves the store aside and " +
      "starts a fresh one, so the stored results are lost",
  );
}
