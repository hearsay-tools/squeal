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
import { nowNs, RACY_NS, RootRecheck, stamp } from "./root-recheck.js";

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
    callback(
      listener,
      (path) => (exclusions.excludes(path) ? [] : [path]),
      new RootRecheck(exclusions),
    ),
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
 * is delivered after its write, so each batch from the parent reports the
 * extra files there it does not name by the root's rule ({@link RootRecheck}):
 * written no earlier than the previous batch, less {@link RACY_NS}. It reads
 * no content, so a same-size rewrite inside one tick is reported too (001-243,
 * 001-253), and a duplicate is dropped by the reconciler. One exists bit per
 * file reports an erased removal or creation by its kind.
 */
class ErasedEvents {
  private readonly exists = new Map<AbsolutePath, boolean>();
  private since = nowNs();

  constructor(private readonly files: Map<AbsolutePath, AbsolutePath[]>) {
    for (const real of files.keys()) this.exists.set(real, stamp(real, this.since) !== "absent");
  }

  /** The hints for the extra files written, added or removed without an event in `named`. */
  find(named: ReadonlySet<AbsolutePath>): WatchHint[] {
    const after = this.since - RACY_NS;
    this.since = nowNs();
    const hints: WatchHint[] = [];
    for (const [real, declared] of this.files) {
      const was = this.exists.get(real) ?? false;
      const now = stamp(real, after);
      this.exists.set(real, now !== "absent");
      if (named.has(real)) continue;
      const kind = moved(was, now);
      if (kind) for (const path of declared) hints.push({ path, kind });
    }
    return hints;
  }
}

/** The hint for a file that `was` present and whose stamp is `now`, null when it did not move. */
function moved(was: boolean, now: ReturnType<typeof stamp>): WatchHint["kind"] | null {
  if (now === "absent") return was ? "unlink" : null;
  if (!was) return "add";
  return now === "written" ? "change" : null;
}

/** `report` names the paths an event is reported under, none to drop it. */
function callback(
  listener: WatchListener,
  report: (path: AbsolutePath) => AbsolutePath[],
  erased: ErasedEvents | RootRecheck,
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
    hints.push(...erased.find(new Set(events.map((e) => e.path))));
    if (hints.length > 0) listener.onHints(hints);
  };
}
