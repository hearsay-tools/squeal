import type { WatcherBackend } from "../types/index.js";
import { chokidarBackend } from "./chokidar-backend.js";
import { parcelBackend } from "./parcel-backend.js";

/**
 * chokidar on Linux, @parcel/watcher on macOS (spec 001 D2). Other platforms
 * get chokidar, the pure-JS backend; v1 does not test them.
 */
export function createWatcherBackend(platform: NodeJS.Platform): WatcherBackend {
  return platform === "darwin" ? parcelBackend : chokidarBackend;
}
