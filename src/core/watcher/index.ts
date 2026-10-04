import { notImplemented } from "../not-implemented.js";
import type { WatcherBackend } from "../types/index.js";

/** chokidar on Linux, @parcel/watcher on macOS (spec 001 D2). Task 001-12. */
export function createWatcherBackend(_platform: NodeJS.Platform): WatcherBackend {
  return notImplemented("createWatcherBackend");
}
