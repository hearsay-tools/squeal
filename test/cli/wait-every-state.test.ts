import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { readHeld, startView } from "../../src/cli/status-wait-held.js";
import { type Every, keptAtStart, readEvery } from "../../src/cli/wait/every-state.js";
import type { openStore as OpenStore } from "../../src/core/store/open.js";
import { claimStatesMarker } from "../../src/core/store/states-marker.js";
import type { Store } from "../../src/core/types/store.js";
import { appendRevisions } from "../status/helpers.js";
import {
  A,
  ADDS,
  answering,
  B,
  fail,
  finish,
  INCARNATION,
  key,
  options,
  repoWith,
} from "./status-wait-fixture.js";

/*
 * Row 011-45 (C6 as amended 2026-10-20, 011-42): the edit wait's fallback,
 * which holds for every check, reads every known state and every
 * `test_file_keys` row only when the states marker moved since its last
 * read. A store whose daemon claimed no marker reads them each poll, as
 * before. Each store the wait opens logs its unfiltered reads of both.
 */

type Read = "states" | "keys";
const sessions = vi.hoisted((): Read[][] => []);

/** Logs `store`'s unfiltered reads of states and keys into `reads`. */
function counted(store: Store, reads: Read[]): Store {
  const { knownStates, testFileKeys } = store;
  return {
    ...store,
    knownStates: {
      ...knownStates,
      list: (id, files) => {
        if (files === undefined) reads.push("states");
        return knownStates.list(id, files);
      },
    },
    testFileKeys: {
      ...testFileKeys,
      list: (id, files) => {
        if (files === undefined) reads.push("keys");
        return testFileKeys.list(id, files);
      },
    },
  };
}

vi.mock("../../src/core/store/open.js", async (importOriginal) => {
  const original = await importOriginal<{ openStore: typeof OpenStore }>();
  const counting: typeof OpenStore = (commonDir, opts) => {
    const opened = original.openStore(commonDir, opts);
    if (!("knownStates" in opened)) return opened;
    const reads: Read[] = [];
    sessions.push(reads);
    const store = opened as { -readonly [K in keyof Store]: Store[K] };
    const wrapped = counted(opened, reads);
    store.knownStates = wrapped.knownStates;
    store.testFileKeys = wrapped.testFileKeys;
    return store;
  };
  return { ...original, openStore: counting };
});

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  sessions.length = 0;
});
afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A worktree whose live daemon claimed the states marker, as its registration does. */
function claimed(pending: readonly string[], done: readonly string[] = []) {
  const made = repoWith(pending, done);
  claimStatesMarker(made.store, made.repo.mainId, INCARNATION);
  return made;
}

describe("the fallback read of every state (row 011-45)", () => {
  it("reads again only when the marker moved, and equals a full read each time", () => {
    const { repo, store } = claimed([A], [B]);
    const id = repo.mainId;
    const reads: Read[] = [];
    const view = startView(store.knownStates.list(id));
    const every: Every = { kept: keptAtStart(store, id, store.knownStates.list(id)) };
    const read = () => {
      reads.length = 0;
      const seen = readEvery(counted(store, reads), id, view, every);
      expect(seen).toEqual(readHeld(store, id, view, null));
      return [...reads];
    };

    // The first read takes the start view's states and reads the rows.
    expect(read()).toEqual(["keys"]);
    expect(read()).toEqual([]);
    // A revision is no state write: the header reads it fresh.
    appendRevisions(store, id, 1, { head: null, dirty: false });
    expect(read()).toEqual([]);
    fail(store, id, ADDS);
    expect(read()).toEqual(["states", "keys"]);
    expect(read()).toEqual([]);
    key(store, id, A, "running");
    expect(read()).toEqual(["states", "keys"]);
    finish(store, id, A);
    expect(read()).toEqual(["states", "keys"]);
    expect(read()).toEqual([]);
  });

  it("reads every time with no marker, or once another daemon registered", () => {
    const { repo, store } = repoWith([A], [B]);
    const id = repo.mainId;
    const reads: Read[] = [];
    const view = startView(store.knownStates.list(id));
    const every: Every = { kept: keptAtStart(store, id, store.knownStates.list(id)) };
    expect(every.kept).toBeUndefined();
    for (let i = 0; i < 2; i++) {
      readEvery(counted(store, reads), id, view, every);
      expect(reads.splice(0)).toEqual(["states", "keys"]);
    }

    claimStatesMarker(store, id, INCARNATION);
    readEvery(counted(store, reads), id, view, every);
    readEvery(counted(store, reads), id, view, every);
    expect(reads.splice(0)).toEqual(["states", "keys"]);
    // An older daemon registers; it claims nothing and may write with no bump.
    const daemon = store.worktrees.get(id)?.daemon ?? null;
    store.worktrees.setDaemon(id, daemon && { ...daemon, squealVersion: "0.1.112" });
    for (let i = 0; i < 2; i++) {
      readEvery(counted(store, reads), id, view, every);
      expect(reads.splice(0)).toEqual(["states", "keys"]);
    }
  });
});

describe("a fallback status --wait (row 011-45)", () => {
  // A sync that names no incarnation: the wait cannot build the edit's window.
  const fallback = (store: Store, id: string, timeoutMs: number) =>
    options(answering(store, id, null).sync, timeoutMs);

  it("reads no state on a poll with no state write since the one before", async () => {
    const { repo, store } = claimed([A], [B]);
    sessions.length = 0;

    const wait = await waitForStatus(repo.main, fallback(store, repo.mainId, 400));

    expect(wait.outcome).toBe("timeout");
    const polls = sessions.slice(1, -1);
    expect(polls.length).toBeGreaterThan(3);
    for (const reads of polls) expect(reads).toEqual([]);
  });

  it("reads every state on each poll of a store whose daemon claimed no marker, as before", async () => {
    const { repo, store } = repoWith([A], [B]);
    sessions.length = 0;

    const wait = await waitForStatus(repo.main, fallback(store, repo.mainId, 400));

    expect(wait.outcome).toBe("timeout");
    const polls = sessions.slice(1, -1);
    expect(polls.length).toBeGreaterThan(3);
    for (const reads of polls) expect(reads).toEqual(["states", "keys"]);
  });

  /** The wait's end with the marker and without it, `write` made 150 ms in. */
  async function both(write: (store: Store, id: string) => void) {
    const ends = [];
    for (const marked of [true, false]) {
      const { repo, store } = marked ? claimed([A], [B]) : repoWith([A], [B]);
      setTimeout(() => write(store, repo.mainId), 150);
      const wait = await waitForStatus(repo.main, fallback(store, repo.mainId, 3_000));
      if (wait.outcome === "unavailable") throw new Error("unavailable");
      const { waitedMs: _waited, result, ...ended } = wait;
      const { revision, counts, testFilesWithoutChecks } = result;
      ends.push({ ended, result: { revision, counts, testFilesWithoutChecks } });
    }
    return ends;
  }

  it("finds a state write on the next poll: its news equals a full read's", async () => {
    const [marked, full] = await both((store, id) => fail(store, id, ADDS));
    expect(marked?.ended).toMatchObject({ outcome: "news", transitions: 1 });
    expect(marked).toEqual(full);
  });

  it("finds a state write on the next poll: its quiet equals a full read's", async () => {
    const [marked, full] = await both((store, id) => finish(store, id, A));
    expect(marked?.ended).toMatchObject({ outcome: "quiet", transitions: 0 });
    expect(marked).toEqual(full);
  });
});
