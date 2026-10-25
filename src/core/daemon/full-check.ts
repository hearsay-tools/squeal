import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { setPriority } from "node:os";
import {
  isCorruption,
  META_FULL_CHECK,
  markStore,
  readStoreMark,
  type StoreMark,
  storePaths,
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
 * Row 011-226, once the daemon serves: takes the day's claim and, holding
 * it, runs the full check off the main thread. A fault marks the store
 * (`markStore`) and leaves a note; every daemon on the store exits at its
 * next heartbeat (`storeCondemned`), and the next start moves the store
 * aside. A check that could not run gives its claim back, and so does one
 * the returned function stops before it ended, so the next start runs it.
 */
export function startFullCheck(context: FullCheckContext): () => void {
  const { store, commonDir, now, log } = context;
  let claim: Claim | null;
  try {
    claim = claimFullCheck(store, now());
  } catch (error) {
    log(`full integrity check not claimed: ${String(error)}`);
    return () => {};
  }
  if (claim === null) return () => {};
  const taken = claim;
  const release = () => {
    try {
      releaseClaim(store, taken);
    } catch (error) {
      log(`full integrity check claim not given back: ${String(error)}`);
    }
  };
  const check = (context.run ?? runFullCheck)(storePaths(commonDir).database);
  let ended = false;
  void check.done.then((outcome) => {
    if (ended) return;
    ended = true;
    if ("ok" in outcome) log("full integrity check: ok");
    else if ("problem" in outcome) failed(context, { at: now(), problem: outcome.problem });
    else {
      log(`full integrity check did not run: ${outcome.unrun}`);
      release();
    }
  });
  return () => {
    if (ended) return;
    ended = true;
    check.stop();
    release();
  };
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

/** The store file a daemon opened, by device and inode. */
export interface StoreFile {
  readonly dev: number;
  readonly ino: number;
}

/** The file at the store's path now; `null` when there is none. */
export function storeFileOf(commonDir: AbsolutePath): StoreFile | null {
  const stat = statSync(storePaths(commonDir).database, { throwIfNoEntry: false });
  return stat === undefined ? null : { dev: stat.dev, ino: stat.ino };
}

/**
 * Why a daemon on this store stops at its heartbeat, or `null`: a failed
 * full check marked it, or a start moved the file it opened (`opened`)
 * aside, which takes the mark with it (row 011-226).
 */
export function storeCondemned(commonDir: AbsolutePath, opened?: StoreFile | null): string | null {
  const mark = readStoreMark(commonDir);
  if (mark !== null) {
    return (
      `daemon stopped: the full integrity check of the store found a fault (${mark.problem}); ` +
      "the next start moves the store aside and starts a fresh one"
    );
  }
  if (opened === undefined || opened === null) return null;
  const now = storeFileOf(commonDir);
  if (now !== null && now.dev === opened.dev && now.ino === opened.ino) return null;
  return "daemon stopped: the store file it opened was moved aside or removed; the next start opens the store at its path";
}
