import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AbsolutePath, WatcherBackend } from "../types/index.js";
import { chokidarBackend } from "./chokidar-backend.js";
import { createParcelBackend, loadOwnParcel, type Parcel } from "./parcel-backend.js";

/**
 * chokidar on Linux, @parcel/watcher on macOS (spec 001 D2). Other platforms
 * get chokidar, the pure-JS backend; v1 does not test them.
 */
export function createWatcherBackend(platform: NodeJS.Platform): WatcherBackend {
  return platform === "darwin" ? createParcelBackend(loadParcel) : chokidarBackend;
}

/**
 * Squeal's own @parcel/watcher, else the one the project at `root` resolves,
 * loaded only when a watch starts. Review wave 3, N11: the plugin's CLI
 * bundle has no `node_modules` above it, so there only the project can
 * provide the native module.
 */
async function loadParcel(root: AbsolutePath): Promise<Parcel> {
  try {
    return await loadOwnParcel();
  } catch (own) {
    let resolved: string;
    try {
      resolved = createRequire(join(root, "package.json")).resolve("@parcel/watcher");
    } catch {
      throw own;
    }
    return ((await import(pathToFileURL(resolved).href)) as { default: Parcel }).default;
  }
}
