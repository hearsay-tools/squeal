import type * as fs from "node:fs";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchHint, WatchSubscription } from "../../src/core/types/index.js";
import { createParcelBackend, type Parcel } from "../../src/core/watcher/parcel-backend.js";
import { makeRepo } from "./helpers.js";

/** Paths whose stat reports these mtimeNs and ctimeNs, as if every write fell in one tick. */
const held = new Map<string, bigint>();
/** Paths whose stat fails, as a permission error would. */
const denied = new Set<string>();
/** Every content read the backend attempted, by any route; none is expected (001-253). */
const reads: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: object) => {
    if (denied.has(path))
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const stat = real.statSync(path, options as never) as unknown as fs.BigIntStats | undefined;
    const time = held.get(path);
    if (!stat || time === undefined) return stat;
    // Spread drops the prototype's methods, which the backend calls.
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
      mtimeNs: time,
      ctimeNs: time,
    });
  }) as typeof real.statSync;
  // A content read fails, as descriptor exhaustion would: the 001-245 case, had the backend read.
  const refuse = (route: string) =>
    ((path: string | number) => {
      reads.push(`${route} ${path}`);
      throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
    }) as never;
  const fakes = {
    statSync,
    openSync: refuse("openSync"),
    readSync: refuse("readSync"),
    readFileSync: refuse("readFileSync"),
  };
  return { ...real, default: { ...real, ...fakes }, ...fakes };
});

/*
 * 001-243: a same-size rewrite inside one coarse kernel timestamp tick leaves
 * ino, size, mtime and ctime as they were, so a stat comparison cannot see
 * it. The extras' recheck takes the root's rule (001-253): a file written no
 * earlier than the previous batch, less the racy window, is reported, by its
 * timestamps alone, so no read can fail (001-245) or overrun a budget (001-247).
 */
type FakeCallback = (error: Error | null, events: { path: string; type: string }[]) => void;

describe("parcel backend, an extra file's erased event inside one timestamp tick", () => {
  let root: string;
  let cleanup: () => void;
  let hints: WatchHint[];
  let sub: WatchSubscription | null;
  let callbacks: Map<string, FakeCallback>;
  /** This test's clock, in ms: Date.now() reads it. */
  let clock: number;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    hints = [];
    sub = null;
    callbacks = new Map();
    held.clear();
    denied.clear();
    reads.length = 0;
    clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    mkdirSync(join(root, "real-build"));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'a';\n");
    writeFileSync(join(root, "real-build/other.js"), "export const other = 'a';\n");
    symlinkSync("real-build", join(root, "dist"));
    // Written long ago, as far as the backend can tell.
    held.set(index(), ns(clock - 3_600_000));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await sub?.close();
    cleanup();
    expect(reads).toEqual([]);
  });

  const ns = (ms: number) => BigInt(ms) * 1_000_000n;
  const index = () => join(root, "real-build/index.js");
  const change = () => ({ path: join(root, "dist/index.js"), kind: "change" });
  const fakeParcel = {
    subscribe: async (dir: string, cb: FakeCallback) => {
      callbacks.set(dir, cb);
      return { unsubscribe: async () => {} };
    },
  } as unknown as Parcel;
  const start = async () => {
    sub = await createParcelBackend(async () => fakeParcel).watch(
      {
        root,
        excluded: [".git", "dist", "real-build"].map((p) => join(root, p)),
        extraFiles: [join(root, "dist/index.js")],
      },
      {
        onHints: (batch) => hints.push(...batch),
        onDropped: () => {},
        onError: (error) => {
          throw error;
        },
      },
    );
  };
  /** Rewrites index.js with `content`, stamped by a tick that began `ago` ms before this clock. */
  const rewrite = (content: string, ago = 0) => {
    writeFileSync(index(), content);
    held.set(index(), ns(clock - ago));
  };
  const deliver = (...names: string[]) =>
    callbacks.get(join(root, "real-build"))?.(
      null,
      names.map((n) => ({ path: join(root, "real-build", n), type: "update" })),
    );

  it("reports a same-size rewrite stamped by a tick that began before the previous batch", async () => {
    await start();
    clock += 5_000;
    deliver("other.js");
    expect(hints).toEqual([]);
    clock += 500;
    rewrite("export const build = 'b';\n", 1_000);
    deliver("other.js");
    expect(hints).toEqual([change()]);
  });

  /* 001-245, reviews/wave-13x.md B1: a same-tick rewrite the seed could not have read. */
  it("reports a same-tick rewrite of a file written in the tick of the seed", async () => {
    rewrite("export const build = 'a';\n");
    await start();
    rewrite("export const build = 'b';\n");
    deliver("other.js");
    expect(hints).toEqual([change()]);
  });

  /* 001-247, reviews/wave-13y.md B1: a file grown past the old 4 MiB read budget. */
  it("reports a same-tick rewrite that grew the file past 4 MiB", async () => {
    await start();
    rewrite("x".repeat(12 * 1024 * 1024));
    deliver("other.js");
    expect(hints).toEqual([change()]);
  });

  it("reports a file it could not stat, never trusting it as unwritten", async () => {
    await start();
    denied.add(index());
    deliver("other.js");
    expect(hints).toEqual([change()]);
  });

  it("reports no file settled before the previous batch", async () => {
    await start();
    deliver("other.js");
    clock += 10_000;
    deliver("other.js");
    expect(hints).toEqual([]);
  });

  /* Moved from parcel-links.test.ts, which has no clock: a duplicate falls inside the racy window. */
  it("reports nothing more for a sibling's batch once a batch after the file's own has passed", async () => {
    await start();
    rewrite("export const build = 'b';\n");
    deliver("index.js");
    clock += 10_000;
    deliver("other.js");
    clock += 10_000;
    deliver("other.js");
    // Its own event, then once more by its timestamp, a duplicate the reconciler drops.
    expect(hints).toEqual([change(), change()]);
  });
});
