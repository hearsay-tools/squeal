import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  WatcherBackend,
  WatchHint,
  WatchListener,
  WatchSpec,
  WatchSubscription,
} from "../../src/core/types/index.js";
import { LinkedWatches } from "../../src/core/watcher/linked-watch.js";
import { makeRepo } from "./helpers.js";

/** A backend that records every subscription and rejects the calls named in `failing`. */
class FakeBackend implements WatcherBackend {
  readonly name = "parcel";
  readonly specs: WatchSpec[] = [];
  readonly closed: number[] = [];
  readonly failing = new Set<number>();

  async watch(spec: WatchSpec, _listener: WatchListener): Promise<WatchSubscription> {
    const call = this.specs.length;
    this.specs.push(spec);
    if (this.failing.has(call)) throw new Error("transient subscription failure");
    return { close: async () => void this.closed.push(call) };
  }
}

/*
 * Task 001-304 (reviews/wave-13ao.md S1): a replacement subscription that
 * rejects leaves the installed watch and its exclusions as they were, so the
 * next update tries the replacement again.
 */
describe("a linked target's replacement subscription", () => {
  let root: string;
  let target: string;
  let cleanup: () => void;
  let backend: FakeBackend;
  let hints: WatchHint[];
  let errors: Error[];
  let watches: LinkedWatches;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    target = join(root, "../ext/lib");
    mkdirSync(join(target, "gen"), { recursive: true });
    writeFileSync(join(target, "gen/a.ts"), "x\n");
    writeFileSync(join(target, ".gitignore"), "gen/\n");
    symlinkSync(target, join(root, "lib"));
    backend = new FakeBackend();
    hints = [];
    errors = [];
    watches = new LinkedWatches(root, backend, {
      onHints: (batch) => hints.push(...batch),
      onDropped: () => {},
      onError: (error) => errors.push(error),
    });
  });
  afterEach(async () => {
    await watches.close();
    cleanup();
  });

  it("is retried at the next update after it fails, then holds the new exclusions", async () => {
    const links = new Map([["lib", target]]);
    await watches.update(links);
    expect(backend.specs.map((s) => s.excluded)).toEqual([[join(target, "gen")]]);

    rmSync(join(target, ".gitignore"));
    backend.failing.add(1);
    await watches.update(links);
    expect(errors.map((e) => e.message)).toEqual(["transient subscription failure"]);
    expect(backend.closed).toEqual([]);
    expect(hints).toEqual([]);

    await watches.update(links);
    expect(backend.specs.map((s) => s.excluded)).toEqual([[join(target, "gen")], [], []]);
    expect(backend.closed).toEqual([0]);
    expect(hints).toEqual([{ path: join(root, "lib/gen"), kind: "unknown" }]);

    await watches.update(links);
    expect(backend.specs).toHaveLength(3);
  });
});
