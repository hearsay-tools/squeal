import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type {
  AbsolutePath,
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
 *
 * Besides the spec, `ignored` rejects every path inside a directory below the
 * root that holds its own `.git` (task 001-299): a `git clone` or `git
 * worktree add` into a watched directory is otherwise watched file by file
 * until the spec's rebuild excludes it. The directory and its `.git` entry
 * stay watched, since the `.git` hint is what rebuilds the spec. Extra files
 * are never rejected.
 */
export const chokidarBackend: WatcherBackend = {
  name: "chokidar",
  async watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription> {
    let current = spec;
    let exclusions = new Exclusions(spec);
    let extra = new Set(spec.extraFiles);
    const watcher: FSWatcher = watch([spec.root, ...spec.extraFiles], {
      ignored: (path: string) =>
        !extra.has(path) && (exclusions.excludes(path) || inNestedRepo(spec.root, path)),
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
        extra = new Set(next.extraFiles);
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

/**
 * True when a directory above `path`, below `root`, holds a `.git` entry. A
 * `.git` entry is judged by the directories above the one holding it.
 */
function inNestedRepo(root: AbsolutePath, path: string): boolean {
  const holder = basename(path) === ".git" ? dirname(path) : path;
  for (let dir = dirname(holder); dir.startsWith(`${root}/`); dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return true;
  }
  return false;
}
