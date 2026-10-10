import type * as fs from "node:fs";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchHint, WatchSubscription } from "../../src/core/types/index.js";
import {
  createParcelBackend,
  type Parcel,
  READ_BUDGET,
} from "../../src/core/watcher/parcel-backend.js";
import { makeRepo } from "./helpers.js";

/** Paths whose stat reports these mtimeNs and ctimeNs, as if every write fell in one tick. */
const held = new Map<string, bigint>();
const reads: string[] = [];
/** Paths whose next read fails, as descriptor exhaustion would. */
const failing = new Set<string>();
/** Writes to run just before a path's next content read, between its stat and its read. */
const beforeRead = new Map<string, () => void>();
/** The content bytes each read returned, and the descriptors still open. */
const bytes: number[] = [];
const open = new Set<number>();
/** Whether the next read through a descriptor fails, as an I/O error would. */
let readFails = false;

/** The start of a content read: either way the backend may read, so reverting to a whole-file read is caught too. */
function reading(path: string): void {
  reads.push(path);
  beforeRead.get(path)?.();
  beforeRead.delete(path);
  if (failing.delete(path))
    throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
}

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: object) => {
    const stat = real.statSync(path, options as never) as unknown as fs.BigIntStats | undefined;
    const time = held.get(path);
    return stat && time !== undefined ? { ...stat, mtimeNs: time, ctimeNs: time } : stat;
  }) as typeof real.statSync;
  const readFileSync = ((path: string, ...rest: never[]) => {
    reading(path);
    const content = real.readFileSync(path, ...rest);
    bytes.push(content.length);
    return content;
  }) as typeof real.readFileSync;
  const openSync = ((path: string, ...rest: never[]) => {
    reading(path);
    const fd = real.openSync(path, ...rest);
    open.add(fd);
    return fd;
  }) as typeof real.openSync;
  const readSync = ((...args: never[]) => {
    if (readFails) {
      readFails = false;
      throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
    }
    const n = (real.readSync as (...a: never[]) => number)(...args);
    bytes.push(n);
    return n;
  }) as typeof real.readSync;
  const closeSync = ((fd: number) => {
    open.delete(fd);
    real.closeSync(fd);
  }) as typeof real.closeSync;
  const fakes = { statSync, readFileSync, openSync, readSync, closeSync };
  return { ...real, default: { ...real, ...fakes }, ...fakes };
});

/*
 * 001-243: a same-size rewrite inside one coarse kernel timestamp tick leaves
 * ino, size, mtime and ctime as they were, so a stat signature cannot see it.
 * The fixture's write and the test's rewrite in parcel-links fell in one tick
 * and the erased event stayed lost. A signature taken within a tick of its
 * file's timestamps is racy, as git calls it, and is compared by content.
 */
type FakeCallback = (error: Error | null, events: { path: string; type: string }[]) => void;

describe("parcel backend, an erased event inside one timestamp tick", () => {
  let root: string;
  let cleanup: () => void;
  let hints: WatchHint[];
  let sub: WatchSubscription | null;
  let callbacks: Map<string, FakeCallback>;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    hints = [];
    sub = null;
    callbacks = new Map();
    held.clear();
    failing.clear();
    beforeRead.clear();
    readFails = false;
    reads.length = 0;
    bytes.length = 0;
    mkdirSync(join(root, "real-build"));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'a';\n");
    writeFileSync(join(root, "real-build/other.js"), "export const other = 'a';\n");
    symlinkSync("real-build", join(root, "dist"));
  });
  afterEach(async () => {
    await sub?.close();
    cleanup();
    expect(open).toEqual(new Set());
  });

  const index = () => join(root, "real-build/index.js");
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
  const deliver = (...names: string[]) =>
    callbacks.get(join(root, "real-build"))?.(
      null,
      names.map((n) => ({ path: join(root, "real-build", n), type: "update" })),
    );
  const nowNs = () => BigInt(Date.now()) * 1_000_000n;

  it("reports a same-size rewrite in the tick of the last signature", async () => {
    held.set(index(), nowNs());
    await start();
    writeFileSync(index(), "export const build = 'b';\n");
    deliver("other.js");
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
  });

  it("reports nothing for a racy signature whose content did not change", async () => {
    held.set(index(), nowNs());
    await start();
    writeFileSync(index(), "export const build = 'a';\n");
    deliver("other.js");
    deliver("other.js");
    expect(hints).toEqual([]);
  });

  it("reads no content for a signature taken well after its file's timestamps", async () => {
    held.set(index(), nowNs() - 60_000_000_000n);
    await start();
    reads.length = 0;
    deliver("other.js");
    deliver("other.js");
    expect(reads.filter((p) => p.endsWith("index.js"))).toEqual([]);
    expect(hints).toEqual([]);
  });

  /*
   * 001-245, reviews/wave-13x.md B1: a failed read of a racy file is not a
   * settled signature. It stays uncertain and is reported, so the next
   * same-tick rewrite is not trusted away.
   */
  it("reports a same-tick rewrite after the seed failed to read the file", async () => {
    held.set(index(), nowNs());
    failing.add(index());
    await start();
    writeFileSync(index(), "export const build = 'b';\n");
    deliver("other.js");
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
  });

  it("reports a same-tick rewrite after a recheck failed to read the file", async () => {
    held.set(index(), nowNs());
    await start();
    failing.add(index());
    deliver("other.js");
    hints.length = 0;
    writeFileSync(index(), "export const build = 'b';\n");
    deliver("other.js");
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
  });

  it("reports an unreadable racy file conservatively, then trusts the next good read", async () => {
    held.set(index(), nowNs());
    await start();
    failing.add(index());
    deliver("other.js");
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
    hints.length = 0;
    deliver("other.js");
    deliver("other.js");
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
  });

  /* S1: content reads have a budget; a file over it is hinted, not read. */
  it("hints a racy file over the read budget without reading it", async () => {
    writeFileSync(index(), "x".repeat(READ_BUDGET + 1));
    held.set(index(), nowNs());
    await start();
    deliver("other.js");
    deliver("other.js");
    expect(reads.filter((p) => p.endsWith("index.js"))).toEqual([]);
    expect(hints).toEqual([
      { path: join(root, "dist/index.js"), kind: "change" },
      { path: join(root, "dist/index.js"), kind: "change" },
    ]);
  });

  /*
   * 001-247, reviews/wave-13y.md B1: the size is the stat's, and a builder may
   * grow the file before it is read. The read stops at the budget whatever
   * the stat said, and the file is hinted.
   */
  it("reads a file grown between stat and read no further than the budget, and hints it", async () => {
    writeFileSync(index(), "x".repeat(1024));
    held.set(index(), nowNs());
    await start();
    bytes.length = 0;
    beforeRead.set(index(), () => writeFileSync(index(), "x".repeat(12 * 1024 * 1024)));
    deliver("other.js");
    expect(reads.filter((p) => p.endsWith("index.js"))).toEqual([index(), index()]);
    expect(bytes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(READ_BUDGET + 1);
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
  });

  it("hashes a racy file of exactly the budget and reports nothing while it is unchanged", async () => {
    writeFileSync(index(), "x".repeat(READ_BUDGET));
    held.set(index(), nowNs());
    await start();
    bytes.length = 0;
    deliver("other.js");
    expect(bytes.reduce((a, b) => a + b, 0)).toBe(READ_BUDGET);
    expect(hints).toEqual([]);
  });

  it("closes the descriptor and hints the file when a read fails after the open", async () => {
    held.set(index(), nowNs());
    await start();
    beforeRead.set(index(), () => {
      readFails = true;
    });
    deliver("other.js");
    expect(readFails).toBe(false);
    expect(hints).toEqual([{ path: join(root, "dist/index.js"), kind: "change" }]);
  });
});
