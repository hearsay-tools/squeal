import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  park,
  registeredMetaKey,
  registration,
  registrationHead,
  tellRegistered,
} from "../../src/core/delivery/registered.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import type { Store } from "../../src/core/types/store.js";
import { gitRepo } from "../harness/stopped-repo.js";
import { git } from "../hash/git-repo.js";
import { fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 011-312: a registration records the commit `HEAD` named then, for the
 * second proof that a session changed nothing. The field is additive: a
 * value without it still reads, and a session that comes back keeps its
 * first registration's `head` as it keeps its revision.
 */

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "89abcdef0123456789abcdef0123456789abcdef";

function seeded(): { store: Store; consumer: Consumer } {
  const repo = fakeRepo();
  const store = seedStore(repo);
  return { store, consumer: { worktreeId: repo.mainId, sessionId: "s1", agentId: "main" } };
}

/** A real checkout, removed after the test. */
function checkout() {
  const cleanups: (() => void)[] = [];
  onTestFinished(() => {
    for (const cleanup of cleanups) cleanup();
  });
  return gitRepo(cleanups);
}

describe("a registration's head (011-312)", () => {
  it("is recorded and read back", () => {
    const { store, consumer } = seeded();
    tellRegistered(store, consumer, 3, { at: 1 as EpochMs, scanned: null, head: SHA });
    expect(registration(store, consumer)).toEqual({ since: 3, gaps: [], head: SHA });
  });

  it("is absent when none was read, and the bare-number form stays", () => {
    const { store, consumer } = seeded();
    tellRegistered(store, consumer, 3, { at: 1 as EpochMs, scanned: null, head: null });
    expect(registration(store, consumer)).toEqual({ since: 3, gaps: [] });
    const key = registeredMetaKey(consumer.worktreeId);
    expect(JSON.parse(store.meta.get(key) ?? "{}")).toEqual({ "s1\nmain": 3 });
  });

  it("a value from before it, with or without `scanned`, still reads", () => {
    const { store, consumer } = seeded();
    const key = registeredMetaKey(consumer.worktreeId);
    store.meta.set(key, JSON.stringify({ "s1\nmain": { since: 2, gaps: [], scanned: 7 } }));
    expect(registration(store, consumer)).toEqual({ since: 2, gaps: [], scanned: 7 });
    store.meta.set(key, JSON.stringify({ "s1\nmain": 4 }));
    expect(registration(store, consumer)).toEqual({ since: 4, gaps: [] });
  });

  it("a session that comes back keeps its first head, as it keeps its revision", () => {
    const { store, consumer } = seeded();
    tellRegistered(store, consumer, 3, { at: 1 as EpochMs, scanned: null, head: SHA });
    park(store, consumer, 2 as EpochMs);
    tellRegistered(store, consumer, 3, { at: 3 as EpochMs, scanned: null, head: OTHER });
    expect(registration(store, consumer)).toMatchObject({ since: 3, head: SHA });
  });
});

describe("registrationHead (011-312)", () => {
  it("reads a main checkout's, a linked worktree's and a detached HEAD", () => {
    const repo = checkout();
    const main = repo.main as AbsolutePath;
    const sha = git(main, ["rev-parse", "HEAD"]).trim();
    expect(registrationHead(main)).toBe(sha);
    const linked = repo.addWorktree("linked").root as AbsolutePath;
    expect(registrationHead(linked)).toBe(sha);
    writeFileSync(join(main, "b.txt"), "b\n");
    git(main, ["add", "b.txt"]);
    git(main, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "b"]);
    git(linked, ["checkout", "-q", "--detach", sha]);
    expect(registrationHead(linked)).toBe(sha);
    expect(registrationHead(main)).not.toBe(sha);
  });

  it("is null for an unborn HEAD, a directory with no Git, and a HEAD it cannot read", () => {
    const repo = checkout();
    const unborn = join(repo.main, "..", "unborn") as AbsolutePath;
    mkdirSync(unborn);
    git(unborn, ["init", "-q"]);
    expect(registrationHead(unborn)).toBeNull();
    expect(registrationHead(fakeRepo().main as AbsolutePath)).toBeNull();
    const head = join(repo.commonDir, "HEAD");
    rmSync(head);
    mkdirSync(head);
    expect(registrationHead(repo.main as AbsolutePath)).toBeNull();
  });
});
