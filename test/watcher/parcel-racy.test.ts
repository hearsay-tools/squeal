import type * as fs from "node:fs";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchHint, WatchSubscription } from "../../src/core/types/index.js";
import { createParcelBackend, type Parcel } from "../../src/core/watcher/parcel-backend.js";
import { makeRepo } from "./helpers.js";

/** Paths whose stat reports these mtimeNs and ctimeNs, as if every write fell in one tick. */
const held = new Map<string, bigint>();
const reads: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: object) => {
    const stat = real.statSync(path, options as never) as unknown as fs.BigIntStats | undefined;
    const time = held.get(path);
    return stat && time !== undefined ? { ...stat, mtimeNs: time, ctimeNs: time } : stat;
  }) as typeof real.statSync;
  const readFileSync = ((path: string, ...rest: never[]) => {
    reads.push(path);
    return real.readFileSync(path, ...rest);
  }) as typeof real.readFileSync;
  return { ...real, default: { ...real, statSync, readFileSync }, statSync, readFileSync };
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
    mkdirSync(join(root, "real-build"));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'a';\n");
    writeFileSync(join(root, "real-build/other.js"), "export const other = 'a';\n");
    symlinkSync("real-build", join(root, "dist"));
  });
  afterEach(async () => {
    await sub?.close();
    cleanup();
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
});
