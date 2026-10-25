import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedDaemon } from "../../src/core/daemon/open.js";
import { createFixtureRepo, type FixtureRepo } from "./helpers.js";

/*
 * Review 0.1.329, B3 (row 011-226): the store file a daemon records is the
 * one its connection holds. Another worktree's start can mark the store and
 * move it aside at any moment; nothing here is excluded by this worktree's
 * lock. When it happens between the open and the read of the file, the start
 * opens again and serves the fresh store; when it happens after, the
 * recorded file is the moved one, so the heartbeat's check stops the daemon.
 */

/** What another worktree's start does next, once: after this open, or after the temp directory. */
const at = vi.hoisted(() => ({
  afterOpen: null as (() => void) | null,
  afterScratch: null as (() => void) | null,
}));

function once(hook: "afterOpen" | "afterScratch"): void {
  const run = at[hook];
  at[hook] = null;
  run?.();
}

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/index.js")>();
  return {
    ...actual,
    openStore: ((...args: Parameters<typeof actual.openStore>) => {
      const opened = actual.openStore(...args);
      if (args[1]?.checkIntegrity !== undefined) once("afterOpen");
      return opened;
    }) as typeof actual.openStore,
  };
});

vi.mock("../../src/core/daemon/scratch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/scratch.js")>();
  return {
    ...actual,
    prepareScratch: ((...args: Parameters<typeof actual.prepareScratch>) => {
      const prepared = actual.prepareScratch(...args);
      once("afterScratch");
      return prepared;
    }) as typeof actual.prepareScratch,
  };
});

const { openDaemon } = await import("../../src/core/daemon/open.js");
const { removeScratch } = await import("../../src/core/daemon/scratch.js");
const { storeCondemned, storeFileOf } = await import("../../src/core/daemon/store-file.js");
const { META_STORE_RECOVERED, markStore, openStore } = await import(
  "../../src/core/store/index.js"
);

const repos: FixtureRepo[] = [];
const opened: OpenedDaemon[] = [];
afterEach(() => {
  at.afterOpen = null;
  at.afterScratch = null;
  for (const daemon of opened.splice(0)) {
    daemon.store.close();
    removeScratch(daemon.scratch);
    daemon.lock.release();
  }
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** A fixture whose store holds `belongs-to: old`, and the file it is. */
function oldStore() {
  const repo = createFixtureRepo();
  repos.push(repo);
  const store = openStore(repo.commonDir);
  if ("reason" in store) throw new Error(JSON.stringify(store));
  store.meta.set("belongs-to", "old");
  store.close();
  return { repo, old: storeFileOf(repo.commonDir) };
}

/** Another worktree's start: a failed full check's mark, then its quick-checked open moves the store aside. */
function recoverElsewhere(commonDir: string): void {
  markStore(commonDir, { at: 1, problem: "row 1 missing from index fault_a" });
  const fresh = openStore(commonDir, { checkIntegrity: "quick" });
  if ("reason" in fresh) throw new Error(JSON.stringify(fresh));
  fresh.close();
}

async function start(repo: FixtureRepo): Promise<OpenedDaemon> {
  const daemon = await openDaemon(repo.root, Date.now, undefined, 0);
  if ("reason" in daemon) throw new Error(daemon.message);
  opened.push(daemon);
  return daemon;
}

describe("the store file a daemon records is its connection's (review 0.1.329, B3)", () => {
  it("opens again when another start moves the store aside between the open and the file read", async () => {
    const { repo, old } = oldStore();
    at.afterOpen = () => recoverElsewhere(repo.commonDir);

    const daemon = await start(repo);

    expect(at.afterOpen).toBeNull();
    expect(daemon.store.meta.get("belongs-to")).toBeNull();
    expect(JSON.parse(daemon.store.meta.get(META_STORE_RECOVERED) ?? "null")).toMatchObject({
      check: "full",
    });
    expect(daemon.storeFile).not.toEqual(old);
    expect(daemon.storeFile).toEqual(storeFileOf(repo.commonDir));
    expect(storeCondemned(repo.commonDir, daemon.storeFile)).toBeNull();
  });

  it("records the moved file when the store is moved aside after the open, so the heartbeat stops it", async () => {
    const { repo, old } = oldStore();
    at.afterScratch = () => recoverElsewhere(repo.commonDir);

    const daemon = await start(repo);

    expect(at.afterScratch).toBeNull();
    // The connection holds the moved store, and the daemon records that file.
    expect(daemon.store.meta.get("belongs-to")).toBe("old");
    expect(daemon.storeFile).toEqual(old);
    expect(storeFileOf(repo.commonDir)).not.toEqual(old);
    expect(storeCondemned(repo.commonDir, daemon.storeFile)).toMatch(
      /store file it opened was moved aside/,
    );
  });
});
