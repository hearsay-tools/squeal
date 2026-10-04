import { dirname } from "node:path";
import type {
  AbsolutePath,
  WatcherBackend,
  WatchHint,
  WatchListener,
  WatchSpec,
  WatchSubscription,
} from "../types/index.js";
import { Exclusions } from "./exclusions.js";

type Parcel = typeof import("@parcel/watcher");
type ParcelSubscription = Awaited<ReturnType<Parcel["subscribe"]>>;
type ParcelCallback = Parameters<Parcel["subscribe"]>[1];

const KINDS = { create: "add", update: "change", delete: "unlink" } as const;

/** FSEventsBackend.cc: "Events were dropped by the FSEvents client. File system must be re-scanned." */
const DROPPED = /re-?scanned|dropped/i;

async function loadParcel(): Promise<Parcel> {
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
 * files.
 */
export const parcelBackend: WatcherBackend = {
  name: "parcel",
  async watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription> {
    const parcel = await loadParcel();
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

async function subscribeAll(
  parcel: Parcel,
  spec: WatchSpec,
  listener: WatchListener,
): Promise<ParcelSubscription[]> {
  const exclusions = new Exclusions(spec);
  const main = await parcel.subscribe(
    spec.root,
    callback(listener, (path) => !exclusions.excludes(path)),
    { ignore: [...spec.excluded] },
  );
  const subs = [main];

  const withoutExtras = new Exclusions({ ...spec, extraFiles: [] });
  const hidden = new Map<AbsolutePath, Set<AbsolutePath>>();
  for (const file of spec.extraFiles) {
    if (!withoutExtras.excludes(file)) continue;
    const parent = dirname(file);
    hidden.set(parent, (hidden.get(parent) ?? new Set()).add(file));
  }
  for (const [parent, files] of hidden) {
    try {
      subs.push(
        await parcel.subscribe(
          parent,
          callback(listener, (path) => files.has(path)),
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

function callback(listener: WatchListener, keep: (path: AbsolutePath) => boolean): ParcelCallback {
  return (error, events) => {
    if (error) {
      if (DROPPED.test(error.message)) listener.onDropped(error.message);
      else listener.onError(error);
      return;
    }
    const hints: WatchHint[] = [];
    for (const event of events) {
      if (keep(event.path)) hints.push({ path: event.path, kind: KINDS[event.type] });
    }
    if (hints.length > 0) listener.onHints(hints);
  };
}
