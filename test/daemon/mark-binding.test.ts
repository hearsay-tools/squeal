import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

/*
 * Review of cand/0.1.545, B1 (row 011-391): a mark and a move-aside exclude
 * each other. The writer stops after it took the file it opened and before
 * the lock (`markUnder`); another start then moves that file aside and puts
 * a fresh store at the path, holding results. The writer resumes: under the
 * recovery lock it finds another file at the path and writes nothing, so the
 * fresh store keeps its results. A held lock or one that cannot be made
 * costs a hook nothing but the mark; two writers keep the first mark.
 */

/** What runs once, just before the next `markUnder`. */
const boundary = vi.hoisted(() => ({ before: null as (() => void) | null }));

vi.mock("../../src/core/store/mark.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/mark.js")>();
  return {
    ...actual,
    markUnder: (...args: Parameters<typeof actual.markUnder>) => {
      const before = boundary.before;
      boundary.before = null;
      before?.();
      return actual.markUnder(...args);
    },
  };
});

const { HOOK_MARK_WAIT_MS, markFault, markHookFault, storeFaults } = await import(
  "../../src/core/daemon/store-fault.js"
);
const { storeCondemned, storeFileOf } = await import("../../src/core/daemon/store-file.js");
const { META_STORE_RECOVERED, openStore } = await import("../../src/core/store/open.js");
const { markPath, RECOVERY_LOCK, readStoreMark } = await import("../../src/core/store/mark.js");
const { storePaths } = await import("../../src/core/store/paths.js");
const { withContext } = await import("../../src/harness/shared/hook.js");
const { damageOverflow, seedOverflow } = await import("../store/damage.js");
const { fakeCommonDir, open } = await import("../store/helpers.js");
const { squealRepo } = await import("../harness/helpers.js");

const CORRUPT = Object.assign(new Error("database disk image is malformed"), { errcode: 11 });

/** Another start's recovery: moves the store aside and creates a fresh one holding `fresh: yes`. */
function recoverElsewhere(commonDir: string): void {
  const { database } = storePaths(commonDir);
  writeFileSync(markPath(database), JSON.stringify({ at: 1, problem: "found elsewhere" }));
  const fresh = openStore(commonDir, { checkIntegrity: "mark", now: () => 3 });
  if ("reason" in fresh) throw new Error(JSON.stringify(fresh));
  fresh.meta.set("fresh", "yes");
  fresh.close();
}

/** The fresh store is unmarked and survives the next checked open with its results. */
function expectFreshKept(commonDir: string): void {
  const { database } = storePaths(commonDir);
  expect(existsSync(markPath(database))).toBe(false);
  expect(storeCondemned(commonDir, storeFileOf(commonDir))).toBeNull();
  const store = openStore(commonDir, { checkIntegrity: "mark", now: () => 9 });
  if ("reason" in store) throw new Error(JSON.stringify(store));
  try {
    expect(store.meta.get("fresh")).toBe("yes");
    // The note is the first recovery's, not a second one's.
    expect(JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null")).toMatchObject({ at: 3 });
  } finally {
    store.close();
  }
}

/** Holds the recovery lock, as a move-aside does, until the returned function. */
function holdLock(commonDir: string): () => void {
  const { locksDir } = storePaths(commonDir);
  mkdirSync(locksDir, { recursive: true });
  const lock = new DatabaseSync(join(locksDir, RECOVERY_LOCK));
  lock.exec("BEGIN EXCLUSIVE");
  return () => {
    lock.exec("ROLLBACK");
    lock.close();
  };
}

function daemonFaults(commonDir: string) {
  const stops: string[] = [];
  const logs: string[] = [];
  const seen = storeFaults({
    commonDir,
    storeFile: storeFileOf(commonDir),
    now: () => 7,
    log: (line) => void logs.push(line),
    stop: (text) => void stops.push(text),
  });
  return { seen, stops, logs };
}

describe("a mark and a move-aside exclude each other (review of cand/0.1.545, B1)", () => {
  it("a daemon's mark, after a recovery that replaced its file, leaves the fresh store unmarked", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const { seen, stops } = daemonFaults(commonDir);
    boundary.before = () => recoverElsewhere(commonDir);

    expect(seen(CORRUPT)).toBe(true);

    expect(boundary.before).toBeNull();
    expect(stops).toHaveLength(1);
    expectFreshKept(commonDir);
  });

  it("a hook's mark, after a recovery that replaced its file, leaves the fresh store unmarked", async () => {
    const r = squealRepo();
    const { commonDir } = r.repo;
    seedOverflow(commonDir, "big");
    damageOverflow(commonDir);
    boundary.before = () => recoverElsewhere(commonDir);

    await expect(
      withContext({ session_id: "s1" }, { root: r.root, commonDir }, { env: {} }, async (c) => {
        c.store.meta.get("big");
        return null;
      }),
    ).rejects.toMatchObject({ errcode: 11 });

    expect(boundary.before).toBeNull();
    expectFreshKept(commonDir);
  });

  it("a hook skips the mark within its bound while the lock is held, and never throws", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const release = holdLock(commonDir);
    try {
      const started = performance.now();
      markHookFault(commonDir, storeFileOf(commonDir), "p", () => 1);
      expect(performance.now() - started).toBeLessThan(HOOK_MARK_WAIT_MS + 800);
    } finally {
      release();
    }
    expect(readStoreMark(commonDir)).toBeNull();
  });

  it("a daemon whose lock stays held logs it, writes nothing, and still stops", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const { seen, stops, logs } = daemonFaults(commonDir);
    const release = holdLock(commonDir);
    try {
      expect(seen(CORRUPT)).toBe(true);
    } finally {
      release();
    }
    expect(readStoreMark(commonDir)).toBeNull();
    expect(stops).toHaveLength(1);
    expect(logs).toEqual(["could not mark the store: the recovery lock stayed held"]);
  });

  it("a hook whose lock cannot be made skips the mark and never throws", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const { locksDir } = storePaths(commonDir);
    rmSync(locksDir, { recursive: true, force: true });
    writeFileSync(locksDir, "not a directory");

    expect(() => markHookFault(commonDir, storeFileOf(commonDir), "p", () => 1)).not.toThrow();
    expect(readStoreMark(commonDir)).toBeNull();
  });

  it("keeps the first of two marks", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const file = storeFileOf(commonDir);
    const first = { at: 1, problem: "first", found: "hook" as const };
    expect(markFault(commonDir, file, first, 100)).toBe("marked");
    expect(markFault(commonDir, file, { at: 2, problem: "second", found: "daemon" }, 100)).toBe(
      "kept",
    );
    expect(readStoreMark(commonDir)).toMatchObject(first);
  });
});

describe("the binding alone, with no lock (review of cand/0.1.545, B1)", () => {
  it("a mark naming another file condemns no daemon and is removed by the next checked open", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    const { database } = storePaths(commonDir);
    // As a writer that lost the race would leave it: beside the store, naming another file.
    writeFileSync(
      markPath(database),
      JSON.stringify({ at: 1, problem: "p", found: "daemon", file: { dev: 1, ino: 2 } }),
    );

    expect(readStoreMark(commonDir)).toBeNull();
    expect(storeCondemned(commonDir, storeFileOf(commonDir))).toBeNull();
    const store = openStore(commonDir, { checkIntegrity: "mark" });
    if ("reason" in store) throw new Error(JSON.stringify(store));
    try {
      expect(store.meta.get("kept")).toBe("yes");
      expect(store.meta.get(META_STORE_RECOVERED)).toBeNull();
    } finally {
      store.close();
    }
    expect(existsSync(markPath(database))).toBe(false);
  });
});
