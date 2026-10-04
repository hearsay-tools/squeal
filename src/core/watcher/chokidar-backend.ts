import { type FSWatcher, watch } from "chokidar";
import type {
  WatcherBackend,
  WatchHint,
  WatchListener,
  WatchSpec,
  WatchSubscription,
} from "../types/index.js";
import { Exclusions } from "./exclusions.js";

const KINDS: Readonly<Record<string, WatchHint["kind"]>> = {
  add: "add",
  addDir: "add",
  change: "change",
  unlink: "unlink",
  unlinkDir: "unlink",
};

/**
 * chokidar 5, the Linux backend.
 *
 * Spec 001 D2: "The Linux choice is the only backend that passed every
 * correctness scenario in research". Research: it watches every file as well
 * as every directory and needs one descriptor per file on macOS, which is why
 * it is not the macOS backend.
 *
 * `atomic` is off: chokidar would otherwise hide editor swap files and files
 * ending in `~`, and fold unlink-then-add into one change. Events are hints, so
 * the extra events cost nothing and nothing is hidden.
 */
export const chokidarBackend: WatcherBackend = {
  name: "chokidar",
  async watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription> {
    let current = spec;
    let exclusions = new Exclusions(spec);
    const watcher: FSWatcher = watch([spec.root, ...spec.extraFiles], {
      ignored: (path: string) => exclusions.excludes(path),
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      atomic: false,
    });
    watcher.on("all", (event, path) => {
      const kind = KINDS[event];
      if (kind) listener.onHints([{ path, kind }]);
    });
    watcher.on("error", (error) => {
      listener.onError(error instanceof Error ? error : new Error(String(error)));
    });
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

    return {
      async update(next: WatchSpec): Promise<void> {
        const before = current;
        current = next;
        exclusions = new Exclusions(next);
        const nowExcluded = next.excluded.filter((p) => !before.excluded.includes(p));
        const noLongerExcluded = before.excluded.filter((p) => !next.excluded.includes(p));
        const newExtra = next.extraFiles.filter((p) => !before.extraFiles.includes(p));
        // unwatch releases the descriptors; the predicate alone would only drop events.
        if (nowExcluded.length > 0) watcher.unwatch(nowExcluded);
        // add with ignoreInitial reports nothing that already exists; the change
        // feed reconciles after exclusions shrink.
        if (noLongerExcluded.length > 0 || newExtra.length > 0) {
          watcher.add([...noLongerExcluded, ...newExtra]);
        }
      },
      close: () => watcher.close(),
    };
  },
};
