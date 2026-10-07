import { join, relative } from "node:path";
import type {
  AbsolutePath,
  RelativePath,
  WatcherBackend,
  WatchHint,
  WatchListener,
  WatchSubscription,
} from "../types/index.js";

/**
 * Watches the target of every symlinked directory the root's watch does not
 * descend into, and reports each hint under every link to that target, as the
 * path below the root the runner and the stat cache know (task 001-118). A
 * target that cannot be watched is reported to `onError`; the reconciliation
 * pass still walks it.
 */
export class LinkedWatches {
  /** Target realpath to its subscription, `null` when watching it failed. */
  private readonly subs = new Map<AbsolutePath, Promise<WatchSubscription | null>>();
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
    const closing: Promise<WatchSubscription | null>[] = [];
    for (const [target, sub] of this.subs) {
      if (byTarget.has(target)) continue;
      this.subs.delete(target);
      closing.push(sub);
    }
    for (const target of byTarget.keys()) {
      if (!this.subs.has(target)) this.subs.set(target, this.watch(target));
    }
    await Promise.all(this.subs.values());
    await Promise.all(closing.map(async (sub) => (await sub)?.close()));
  }

  async close(): Promise<void> {
    await this.update(new Map());
  }

  private async watch(target: AbsolutePath): Promise<WatchSubscription | null> {
    const spec = { root: target, excluded: [], extraFiles: [] };
    try {
      return await this.backend.watch(spec, {
        onHints: (hints) =>
          this.listener.onHints(hints.flatMap((hint) => this.mapped(target, hint))),
        onDropped: (reason) => this.listener.onDropped(reason),
        onError: (error) => this.listener.onError(error),
      });
    } catch (error) {
      this.listener.onError(
        new Error(
          `squeal: cannot watch the linked directory ${target}: ${(error as Error).message}`,
        ),
      );
      return null;
    }
  }

  private mapped(target: AbsolutePath, hint: WatchHint): WatchHint[] {
    const below = relative(target, hint.path);
    return (this.links.get(target) ?? []).map((link) => ({
      ...hint,
      path: join(this.root, link, below),
    }));
  }
}
