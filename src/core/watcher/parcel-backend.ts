import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  AbsolutePath,
  WatcherBackend,
  WatchHint,
  WatchListener,
  WatchSpec,
  WatchSubscription,
} from "../types/index.js";
import { Exclusions } from "./exclusions.js";

export type Parcel = typeof import("@parcel/watcher");
/** Loads @parcel/watcher for the worktree at `root`. */
export type ParcelLoader = (root: AbsolutePath) => Promise<Parcel>;
type ParcelSubscription = Awaited<ReturnType<Parcel["subscribe"]>>;
type ParcelCallback = Parameters<Parcel["subscribe"]>[1];

const KINDS = { create: "add", update: "change", delete: "unlink" } as const;

/** FSEventsBackend.cc: "Events were dropped by the FSEvents client. File system must be re-scanned." */
const DROPPED = /re-?scanned|dropped/i;

/** Squeal's own @parcel/watcher, an optional dependency of the npm package. */
export async function loadOwnParcel(): Promise<Parcel> {
  try {
    return (await import("@parcel/watcher")).default;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `squeal: @parcel/watcher, the macOS watcher backend, could not be loaded. It is an optional dependency; reinstall with optional dependencies enabled. ${reason}`,
    );
  }
}

/**
 * @parcel/watcher, the macOS backend.
 *
 * Spec 001 D2: "the macOS choice avoids per-file descriptors and reports
 * dropped events". Not run in v1 (spec 001 non-goals: "macOS verification");
 * research found it loses writes in renamed directories on Linux, so it is
 * never selected there.
 *
 * Parcel cannot change `ignore` on a live subscription. `update` subscribes
 * with the new spec before it unsubscribes the old one, so events in between
 * may be reported twice but are not lost. Extra files inside excluded
 * directories get one subscription per parent directory, filtered to those
 * files. The parent is subscribed at its realpath, since parcel refuses a
 * link on Linux and FSEvents reports canonical paths on macOS, and each event
 * is reported under every declared path that names the file.
 */
export const parcelBackend: WatcherBackend = createParcelBackend(() => loadOwnParcel());

/** The parcel backend over the @parcel/watcher that `load` returns for the watched root. */
export function createParcelBackend(load: ParcelLoader): WatcherBackend {
  return {
    name: "parcel",
    async watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription> {
      const parcel = await load(spec.root);
      let subs = await subscribeAll(parcel, spec, listener);
      return {
        async update(next: WatchSpec): Promise<void> {
          const old = subs;
          subs = await subscribeAll(parcel, next, listener);
          await Promise.all(old.map((s) => s.unsubscribe()));
        },
        async close(): Promise<void> {
          await Promise.all(subs.map((s) => s.unsubscribe()));
          subs = [];
        },
      };
    },
  };
}

async function subscribeAll(
  parcel: Parcel,
  spec: WatchSpec,
  listener: WatchListener,
): Promise<ParcelSubscription[]> {
  const exclusions = new Exclusions(spec);
  const main = await parcel.subscribe(
    spec.root,
    callback(listener, (path) => (exclusions.excludes(path) ? [] : [path])),
    { ignore: [...spec.excluded] },
  );
  const subs = [main];

  const withoutExtras = new Exclusions({ ...spec, extraFiles: [] });
  const hidden = new Map<AbsolutePath, Map<AbsolutePath, AbsolutePath[]>>();
  for (const file of spec.extraFiles) {
    if (!withoutExtras.excludes(file)) continue;
    const parent = await realpath(dirname(file)).catch(() => dirname(file));
    const files = hidden.get(parent) ?? new Map<AbsolutePath, AbsolutePath[]>();
    const real = join(parent, basename(file));
    files.set(real, [...(files.get(real) ?? []), file]);
    hidden.set(parent, files);
  }
  for (const [parent, files] of hidden) {
    try {
      // Seeded before the subscription: a write in between is found by the first batch.
      subs.push(
        await parcel.subscribe(
          parent,
          callback(listener, (path) => files.get(path) ?? [], new ErasedEvents(files)),
        ),
      );
    } catch (error) {
      listener.onError(
        new Error(`squeal: cannot watch extra files in ${parent}: ${(error as Error).message}`),
      );
    }
  }
  return subs;
}

/**
 * Finds the events @parcel/watcher erased for one parent's extra files.
 *
 * Its Watcher::triggerCallbacks copies the pending events, then clears them,
 * and an event its backend thread adds between the two is never delivered
 * (2.6.0, every platform). A rebuild writing `other.js`, then `index.js` lost
 * `index.js` in 1-2 % of fresh processes locally and in a quarter of CI's
 * jobs (`test/watcher/parcel-links.test.ts`). The batch that erased an event
 * is delivered after its write, so each batch from the parent re-stats the
 * extra files there it does not name and reports those that moved.
 *
 * A same-size rewrite inside one timestamp tick leaves the stat as it was, so
 * a signature taken within {@link RACY_NS} of its file's mtime or ctime is
 * racy, as git calls it, and also carries the content's hash (001-243). Only
 * racy signatures read the file; a later write to a settled one moves its
 * timestamps.
 */
class ErasedEvents {
  private readonly last = new Map<AbsolutePath, Signature | null>();

  constructor(private readonly files: Map<AbsolutePath, AbsolutePath[]>) {
    for (const real of files.keys()) this.last.set(real, signature(real));
  }

  /** The hints for the extra files that moved without an event in `named`. */
  find(named: ReadonlySet<AbsolutePath>): WatchHint[] {
    const hints: WatchHint[] = [];
    for (const [real, declared] of this.files) {
      const before = this.last.get(real) ?? null;
      const now = signature(real);
      this.last.set(real, now);
      if (named.has(real) || same(real, before, now)) continue;
      const kind = now === null ? "unlink" : before === null ? "add" : "change";
      for (const path of declared) hints.push({ path, kind });
    }
    return hints;
  }
}

/**
 * How close to its file's timestamps a signature is racy: two seconds, the
 * coarsest common tick (FAT), well above a kernel's coarse clock (a jiffy).
 */
const RACY_NS = 2_000_000_000n;

interface Signature {
  stat: string;
  /** The content's hash when the signature is racy, else null. */
  hash: string | null;
}

function signature(path: AbsolutePath): Signature | null {
  const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat) return null;
  const latest = stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs;
  const racy = latest >= BigInt(Date.now()) * 1_000_000n - RACY_NS;
  return {
    stat: `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
    hash: racy ? contentHash(path) : null,
  };
}

/** A racy `before` is matched by content too; `now` is read for it if it settled since. */
function same(path: AbsolutePath, before: Signature | null, now: Signature | null): boolean {
  if (before === null || now === null) return before === now;
  if (before.stat !== now.stat) return false;
  return before.hash === null || before.hash === (now.hash ?? contentHash(path));
}

function contentHash(path: AbsolutePath): string | null {
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/** `report` names the paths an event is reported under, none to drop it. */
function callback(
  listener: WatchListener,
  report: (path: AbsolutePath) => AbsolutePath[],
  erased?: ErasedEvents,
): ParcelCallback {
  return (error, events) => {
    if (error) {
      if (DROPPED.test(error.message)) listener.onDropped(error.message);
      else listener.onError(error);
      return;
    }
    const hints: WatchHint[] = [];
    for (const event of events) {
      for (const path of report(event.path)) hints.push({ path, kind: KINDS[event.type] });
    }
    if (erased) hints.push(...erased.find(new Set(events.map((e) => e.path))));
    if (hints.length > 0) listener.onHints(hints);
  };
}
