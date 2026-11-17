import { renameSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { StoreMark } from "../../src/core/store/mark.js";

/*
 * Review of cand/0.1.545, B1 (row 011-391): a mark names the store file its
 * writer opened. Here another start moves that file aside and puts a fresh
 * store at the path at the marking boundary, after every check a marker
 * makes and before its write: the mark lands beside the fresh store, names
 * the moved file, and condemns nothing. The next checked open removes it.
 */

/** What runs once, just before the next mark is written. */
const boundary = vi.hoisted(() => ({ before: null as (() => void) | null }));

vi.mock("../../src/core/store/mark.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/mark.js")>();
  return {
    ...actual,
    markStore: (commonDir: Parameters<typeof actual.markStore>[0], mark: StoreMark) => {
      const before = boundary.before;
      boundary.before = null;
      before?.();
      actual.markStore(commonDir, mark);
    },
  };
});

const { storeFaults } = await import("../../src/core/daemon/store-fault.js");
const { storeCondemned, storeFileOf } = await import("../../src/core/daemon/store-file.js");
const { META_STORE_RECOVERED, openStore } = await import("../../src/core/store/open.js");
const { markPath } = await import("../../src/core/store/mark.js");
const { storePaths } = await import("../../src/core/store/paths.js");
const { withContext } = await import("../../src/harness/shared/hook.js");
const { damageOverflow, seedOverflow } = await import("../store/damage.js");
const { fakeCommonDir, open } = await import("../store/helpers.js");
const { squealRepo } = await import("../harness/helpers.js");
const { existsSync } = await import("node:fs");

const CORRUPT = Object.assign(new Error("database disk image is malformed"), { errcode: 11 });

/** Another start: moves the store aside and creates a fresh one holding `fresh: yes`. */
function replace(commonDir: string): void {
  const { database } = storePaths(commonDir);
  renameSync(database, `${database}.corrupt-1`);
  if (existsSync(`${database}-wal`)) renameSync(`${database}-wal`, `${database}.corrupt-1-wal`);
  const fresh = openStore(commonDir);
  if ("reason" in fresh) throw new Error(JSON.stringify(fresh));
  fresh.meta.set("fresh", "yes");
  fresh.close();
}

/** The fresh store survives a checked open, and the stale mark is gone. */
function expectFreshKept(commonDir: string): void {
  const { database } = storePaths(commonDir);
  expect(existsSync(markPath(database))).toBe(true);
  expect(storeCondemned(commonDir, storeFileOf(commonDir))).toBeNull();
  const store = openStore(commonDir, { checkIntegrity: "mark" });
  if ("reason" in store) throw new Error(JSON.stringify(store));
  try {
    expect(store.meta.get("fresh")).toBe("yes");
    expect(store.meta.get(META_STORE_RECOVERED)).toBeNull();
  } finally {
    store.close();
  }
  expect(existsSync(markPath(database))).toBe(false);
}

describe("a mark written while another start replaces the store (review of cand/0.1.545, B1)", () => {
  it("from a daemon's read condemns nothing of the fresh store", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const stops: string[] = [];
    const seen = storeFaults({
      commonDir,
      storeFile: storeFileOf(commonDir),
      now: () => 7,
      log: () => {},
      stop: (text) => void stops.push(text),
    });
    boundary.before = () => replace(commonDir);

    expect(seen(CORRUPT)).toBe(true);

    expect(boundary.before).toBeNull();
    expect(stops).toHaveLength(1);
    expectFreshKept(commonDir);
  });

  it("from a hook's read condemns nothing of the fresh store", async () => {
    const r = squealRepo();
    const { commonDir } = r.repo;
    seedOverflow(commonDir, "big");
    damageOverflow(commonDir);
    boundary.before = () => replace(commonDir);

    await expect(
      withContext({ session_id: "s1" }, { root: r.root, commonDir }, { env: {} }, async (c) => {
        c.store.meta.get("big");
        return null;
      }),
    ).rejects.toMatchObject({ errcode: 11 });

    expect(boundary.before).toBeNull();
    expectFreshKept(commonDir);
  });
});
