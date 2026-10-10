import type * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchHint, WatchSubscription } from "../../src/core/types/index.js";
import { createParcelBackend, type Parcel } from "../../src/core/watcher/parcel-backend.js";
import { ENTRY_BUDGET } from "../../src/core/watcher/root-recheck.js";
import { makeRepo } from "./helpers.js";

/** Paths whose stat reports these mtimeNs and ctimeNs; the rest report this host's. */
const held = new Map<string, bigint>();
/** The paths the backend stat'ed, and those whose content it opened. */
const stats: string[] = [];
const opened: string[] = [];
/** Paths whose stat fails, as a permission error would. */
const denied = new Set<string>();

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: object) => {
    stats.push(path);
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
  const openSync = ((path: string, flags: fs.OpenMode) => {
    opened.push(path);
    return real.openSync(path, flags);
  }) as typeof real.openSync;
  const readFileSync = ((path: string, ...rest: never[]) => {
    opened.push(path);
    return real.readFileSync(path, ...rest);
  }) as typeof real.readFileSync;
  const fakes = { statSync, openSync, readFileSync };
  return { ...real, default: { ...real, ...fakes }, ...fakes };
});

/*
 * 001-236: @parcel/watcher 2.6.0 copies its pending events, then clears them,
 * and erases an event added between the two (001-235). On macOS the root is
 * watched by parcel, so a file written beside one a batch names can lose its
 * event the same way. Each root batch re-stats the directories its events
 * name and reports the files there written since the previous batch.
 */
type FakeCallback = (error: Error | null, events: { path: string; type: string }[]) => void;

describe("parcel backend, an event @parcel/watcher erased from the root watch", () => {
  let root: string;
  let cleanup: () => void;
  let hints: WatchHint[];
  let sub: WatchSubscription | null;
  let rootCallback: FakeCallback | undefined;
  /** This test's clock, in ms: Date.now() reads it. */
  let clock: number;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    hints = [];
    sub = null;
    rootCallback = undefined;
    held.clear();
    denied.clear();
    stats.length = 0;
    opened.length = 0;
    clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // The fixture's files were written long ago, as far as the backend can tell.
    for (const rel of ["README.md", ".gitignore", "src/a.ts", "src/lib/b.ts"]) {
      held.set(join(root, rel), ns(clock - 3_600_000));
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await sub?.close();
    cleanup();
  });

  const ns = (ms: number) => BigInt(ms) * 1_000_000n;
  const fakeParcel = {
    subscribe: async (dir: string, cb: FakeCallback) => {
      if (dir === root) rootCallback = cb;
      return { unsubscribe: async () => {} };
    },
  } as unknown as Parcel;
  const start = async () => {
    sub = await createParcelBackend(async () => fakeParcel).watch(
      { root, excluded: [".git", "out", "debug.log"].map((p) => join(root, p)), extraFiles: [] },
      {
        onHints: (batch) => hints.push(...batch),
        onDropped: () => {},
        onError: (error) => {
          throw error;
        },
      },
    );
  };
  /** Writes `rel` now, by this test's clock. */
  const write = (rel: string) => {
    writeFileSync(join(root, rel), `${rel} at ${clock}\n`);
    held.set(join(root, rel), ns(clock));
  };
  const deliver = (...rels: string[]) =>
    rootCallback?.(
      null,
      rels.map((rel) => ({ path: join(root, rel), type: "update" })),
    );
  const paths = () => hints.map((h) => h.path);
  const sorted = () => paths().sort();

  it("reports a file whose event was erased from a batch that named its sibling", async () => {
    await start();
    write("src/a.ts");
    write("src/c.ts");
    deliver("src/a.ts");
    expect(hints).toEqual([
      { path: join(root, "src/a.ts"), kind: "change" },
      { path: join(root, "src/c.ts"), kind: "change" },
    ]);
  });

  it("reports a write whose coarse timestamp falls before the previous batch, reading no content", async () => {
    await start();
    clock += 5_000;
    deliver("src/a.ts");
    clock += 500;
    // Rewritten after that batch at the same size, stamped by a tick that began before it.
    writeFileSync(join(root, "README.md"), "# basic\n");
    held.set(join(root, "README.md"), ns(clock - 1_000));
    deliver(".gitignore");
    expect(sorted()).toEqual([
      join(root, ".gitignore"),
      join(root, "README.md"),
      join(root, "src/a.ts"),
    ]);
    expect(opened).toEqual([]);
  });

  it("reports no file again once a batch after its write has passed", async () => {
    await start();
    write("src/c.ts");
    clock += 10_000;
    write("src/a.ts");
    deliver("src/a.ts");
    clock += 10_000;
    write("src/a.ts");
    deliver("src/a.ts");
    expect(paths()).toEqual([
      join(root, "src/a.ts"),
      join(root, "src/c.ts"),
      join(root, "src/a.ts"),
    ]);
  });

  it("reports no excluded file, no directory and no file outside the named directories", async () => {
    await start();
    write("README.md");
    write("debug.log");
    mkdirSync(join(root, "new"));
    held.set(join(root, "new"), ns(clock));
    write("src/lib/b.ts");
    deliver("README.md");
    expect(paths()).toEqual([join(root, "README.md")]);
  });

  it("reports a file it could not stat, never trusting it as unwritten", async () => {
    await start();
    write("src/a.ts");
    denied.add(join(root, ".gitignore"));
    deliver("README.md");
    expect(paths()).toEqual([join(root, "README.md"), join(root, ".gitignore")]);
  });

  it("leaves an erased removal to the reconciliation pass", async () => {
    await start();
    write("src/a.ts");
    rmSync(join(root, "src/lib/b.ts"));
    rmSync(join(root, "README.md"));
    deliver("src/a.ts");
    expect(paths()).toEqual([join(root, "src/a.ts")]);
  });

  it(`stats at most ${ENTRY_BUDGET} entries of the named directories per batch`, async () => {
    mkdirSync(join(root, "gen"));
    for (let i = 0; i < ENTRY_BUDGET + 10; i++) write(`gen/f${i}.js`);
    await start();
    stats.length = 0;
    deliver("gen/f0.js", "src/a.ts");
    expect(stats.length).toBeLessThanOrEqual(ENTRY_BUDGET);
    expect(hints.length).toBeLessThanOrEqual(ENTRY_BUDGET + 2);
    expect(hints.length).toBeGreaterThan(ENTRY_BUDGET / 2);
  });
});
