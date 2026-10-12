import { lstat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { sameList } from "../fs/index.js";
import type {
  AbsolutePath,
  RelativePath,
  WatcherBackend,
  WatchHint,
  WatchListener,
  WatchSubscription,
} from "../types/index.js";
import { linkedExclusions } from "./linked-exclusions.js";

/** One watched target: its subscription and what the subscription leaves out. */
interface Target {
  sub: WatchSubscription | null;
  excluded: AbsolutePath[];
  /** Exclusion work, one step at a time. */
  queue: Promise<void>;
  /** Paths hinted as added since the last step: directories among them are checked. */
  added: Set<AbsolutePath>;
  /** A `.gitignore` changed, or an update came, since the last step: recompute all. */
  stale: boolean;
  /** A step is queued and has not started: later hints join it. */
  queued: boolean;
}

/**
 * Watches the target of every symlinked directory the root's watch does not
 * descend into, and reports each hint under every link to that target, as the
 * path below the root the runner and the stat cache know (task 001-118). A
 * target that cannot be watched is reported to `onError`; the reconciliation
 * pass still walks it.
 *
 * The watch leaves out what `linkedExclusions` names: the directories git
 * would ignore under the links and nested repositories (task 001-300). They
 * are recomputed on every `update`, on a `.gitignore` hint, and for each
 * directory hinted as added or gaining a `.git` entry. A change of exclusions
 * replaces the subscription, the new one ready before the old one closes, since
 * chokidar's `unwatch` of a directory keeps the watches below it; a directory
 * no longer left out is reported as a hint, so the feed walks it.
 */
export class LinkedWatches {
  /** Target realpath to its watch, settled once the first subscription is. */
  private readonly targets = new Map<AbsolutePath, Promise<Target>>();
  /** Target realpath to the links that point at it. */
  private links = new Map<AbsolutePath, RelativePath[]>();

  constructor(
    private readonly root: AbsolutePath,
    private readonly backend: WatcherBackend,
    private readonly listener: WatchListener,
  ) {}

  /** Watches exactly the targets of `links`, a link path to its target's realpath. */
  async update(links: ReadonlyMap<RelativePath, AbsolutePath>): Promise<void> {
    const byTarget = new Map<AbsolutePath, RelativePath[]>();
    for (const [link, target] of links)
      byTarget.set(target, [...(byTarget.get(target) ?? []), link]);
    this.links = byTarget;
    const closing: Promise<Target>[] = [];
    for (const [path, target] of this.targets) {
      if (byTarget.has(path)) continue;
      this.targets.delete(path);
      closing.push(target);
    }
    const kept: Promise<void>[] = [];
    for (const path of byTarget.keys()) {
      const target = this.targets.get(path);
      if (target) kept.push(target.then((t) => this.step(path, t, true)));
      else this.targets.set(path, this.watch(path));
    }
    await Promise.all([...this.targets.values(), ...kept]);
    await Promise.all(
      closing.map(async (pending) => {
        const target = await pending;
        await target.queue;
        await target.sub?.close();
      }),
    );
  }

  async close(): Promise<void> {
    await this.update(new Map());
  }

  private async watch(path: AbsolutePath): Promise<Target> {
    const target: Target = {
      sub: null,
      excluded: [],
      queue: Promise.resolve(),
      added: new Set(),
      stale: false,
      queued: false,
    };
    try {
      target.excluded = await linkedExclusions(this.root, this.linksOf(path), path);
      target.sub = await this.subscribe(path, target);
    } catch (error) {
      this.listener.onError(
        new Error(`squeal: cannot watch the linked directory ${path}: ${(error as Error).message}`),
      );
    }
    return target;
  }

  private subscribe(path: AbsolutePath, target: Target): Promise<WatchSubscription> {
    return this.backend.watch(
      { root: path, excluded: target.excluded, extraFiles: [] },
      {
        onHints: (hints) => {
          this.listener.onHints(hints.flatMap((hint) => this.mapped(path, hint)));
          this.noted(path, target, hints);
        },
        onDropped: (reason) => this.listener.onDropped(reason),
        onError: (error) => this.listener.onError(error),
      },
    );
  }

  /** Queues the exclusion work the hints of `target` call for. */
  private noted(path: AbsolutePath, target: Target, hints: readonly WatchHint[]): void {
    let due = false;
    for (const hint of hints) {
      const name = basename(hint.path);
      if (name === ".gitignore") target.stale = due = true;
      else if (name === ".git" && hint.kind !== "unlink") {
        if (hint.path !== join(path, ".git")) target.added.add(dirname(hint.path));
        due = true;
      } else if (hint.kind === "add") {
        target.added.add(hint.path);
        due = true;
      }
    }
    if (due) void this.step(path, target, false);
  }

  /** Recomputes the exclusions of `target`, all of them when `all`, and applies them. */
  private step(path: AbsolutePath, target: Target, all: boolean): Promise<void> {
    if (all) target.stale = true;
    if (target.queued) return target.queue;
    target.queued = true;
    target.queue = target.queue.then(async () => {
      target.queued = false;
      if (target.sub === null || !this.links.has(path)) return;
      const links = this.linksOf(path);
      const stale = target.stale;
      const added = [...target.added];
      target.stale = false;
      target.added.clear();
      try {
        const excluded = stale
          ? await linkedExclusions(this.root, links, path)
          : [
              ...target.excluded,
              ...(await linkedExclusions(this.root, links, path, await newDirs(target, added))),
            ].sort();
        await this.apply(path, target, excluded);
      } catch (error) {
        this.listener.onError(error as Error);
      }
    });
    return target.queue;
  }

  private async apply(path: AbsolutePath, target: Target, excluded: AbsolutePath[]): Promise<void> {
    if (sameList(target.excluded, excluded) || !this.links.has(path)) return;
    const freed = target.excluded.filter((dir) => !excluded.includes(dir));
    const old = target.sub;
    target.excluded = excluded;
    target.sub = await this.subscribe(path, target);
    await old?.close();
    if (freed.length > 0) {
      this.listener.onHints(
        freed.flatMap((dir) => this.mapped(path, { path: dir, kind: "unknown" })),
      );
    }
  }

  private linksOf(target: AbsolutePath): RelativePath[] {
    return this.links.get(target) ?? [];
  }

  private mapped(target: AbsolutePath, hint: WatchHint): WatchHint[] {
    const below = relative(target, hint.path);
    return this.linksOf(target).map((link) => ({
      ...hint,
      path: join(this.root, link, below),
    }));
  }
}

/** The directories among `paths` that still exist, outside what `target` already leaves out. */
async function newDirs(target: Target, paths: readonly AbsolutePath[]): Promise<AbsolutePath[]> {
  const dirs: AbsolutePath[] = [];
  for (const path of paths) {
    if (target.excluded.some((dir) => path === dir || path.startsWith(`${dir}/`))) continue;
    const stats = await lstat(path).catch(() => null);
    if (stats?.isDirectory()) dirs.push(path);
  }
  // A directory below another of the batch is walked from it.
  return dirs.filter((dir) => !dirs.some((other) => dir.startsWith(`${other}/`)));
}
