import { describe, expect, it } from "vitest";
import type {
  CheckRecord,
  Consumer,
  FileCheckId,
  TestFileKeyRecord,
  TestFileRecord,
  Transition,
} from "../../src/core/types/index.js";
import { fakeCommonDir, knownState, open, result, testCheck, worktree } from "./helpers.js";

const fileCheck: FileCheckId = { kind: "file", project: "", testPath: "src/a.test.ts" };

describe("worktrees", () => {
  it("round-trips records, daemon and heartbeat", () => {
    const store = open(fakeCommonDir());
    const record = worktree("wt-1", "/repo", { isMain: true });
    store.worktrees.upsert(record);
    expect(store.worktrees.get("wt-1")).toEqual(record);
    expect(store.worktrees.get("nope")).toBeNull();

    const daemon = {
      socketPath: "/tmp/squeal-wt-1.sock",
      startedAt: 10,
      heartbeatAt: 10,
      heartbeatIntervalMs: 5000,
      squealVersion: "0.0.0",
    };
    store.worktrees.setDaemon("wt-1", daemon);
    store.worktrees.heartbeat("wt-1", 99);
    expect(store.worktrees.get("wt-1")?.daemon).toEqual({ ...daemon, heartbeatAt: 99 });
    store.worktrees.setDaemon("wt-1", null);
    expect(store.worktrees.get("wt-1")?.daemon).toBeNull();

    store.worktrees.upsert(worktree("wt-2", "/repo/other"));
    expect(store.worktrees.list().map((w) => w.id)).toEqual(["wt-1", "wt-2"]);
  });

  it("remove drops every row the worktree owns and nothing else", () => {
    const store = open(fakeCommonDir());
    const consumer: Consumer = { worktreeId: "gone", sessionId: "s", agentId: "main" };
    const keep: Consumer = { worktreeId: "stay", sessionId: "s", agentId: "main" };
    for (const id of ["gone", "stay"]) {
      store.worktrees.upsert(worktree(id, `/${id}`));
      store.revisions.append({
        worktreeId: id,
        createdAt: 1,
        head: null,
        dirty: false,
        trigger: "start",
        changes: [{ path: "a.ts", oldHash: null, newHash: "h" }],
      });
      store.fileHashes.upsertMany(id, [
        { path: "a.ts", mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1, hash: "h" },
      ]);
      store.testFileKeys.upsertMany([
        {
          worktreeId: id,
          testFile: { project: "", path: "a.test.ts" },
          key: "k",
          revision: 1,
          pending: null,
        },
      ]);
      store.knownStates.upsertMany([knownState(id, testCheck("t"))]);
      store.transitions.append([transition(id)]);
    }
    store.consumers.register(consumer, 1);
    store.consumers.register(keep, 1);
    store.views.writeMany(consumer, [view()]);
    store.views.writeMany(keep, [view()]);

    store.worktrees.remove("gone");

    expect(store.worktrees.get("gone")).toBeNull();
    expect(store.revisions.latest("gone")).toBeNull();
    expect(store.fileHashes.list("gone")).toEqual([]);
    expect(store.testFileKeys.list("gone")).toEqual([]);
    expect(store.knownStates.list("gone")).toEqual([]);
    expect(store.transitions.history("gone", testCheck("t"))).toEqual([]);
    expect(store.consumers.list("gone")).toEqual([]);
    expect(store.views.list(consumer)).toEqual([]);

    expect(store.worktrees.get("stay")).not.toBeNull();
    expect(store.revisions.latest("stay")?.number).toBe(1);
    expect(store.fileHashes.list("stay")).toHaveLength(1);
    expect(store.testFileKeys.list("stay")).toHaveLength(1);
    expect(store.knownStates.list("stay")).toHaveLength(1);
    expect(store.transitions.history("stay", testCheck("t"))).toHaveLength(1);
    expect(store.consumers.list("stay")).toHaveLength(1);
    expect(store.views.list(keep)).toHaveLength(1);
  });
});

describe("revisions", () => {
  it("numbers revisions per worktree from 1 and round-trips changes", () => {
    const store = open(fakeCommonDir());
    const base = {
      createdAt: 5,
      head: "abc",
      dirty: true,
      trigger: "watch" as const,
      changes: [
        { path: "src/a.ts", oldHash: "1", newHash: "2" },
        { path: "src/new.ts", oldHash: null, newHash: "3" },
        { path: "src/old.ts", oldHash: "4", newHash: null },
      ],
    };
    const first = store.revisions.append({ ...base, worktreeId: "a" });
    const second = store.revisions.append({ ...base, worktreeId: "a", head: null });
    const other = store.revisions.append({ ...base, worktreeId: "b" });
    expect([first.number, second.number, other.number]).toEqual([1, 2, 1]);
    expect(store.revisions.get("a", 1)).toEqual(first);
    expect(store.revisions.latest("a")).toEqual(second);
    expect(store.revisions.get("a", 3)).toBeNull();
    expect(store.revisions.latest("c")).toBeNull();
  });
});

describe("file hashes", () => {
  it("upserts, lists sorted by path and removes", () => {
    const store = open(fakeCommonDir());
    const a = { path: "b.ts", mtimeMs: 1.5, ctimeMs: 2.25, size: 3, inode: 2 ** 40, hash: "h1" };
    const b = { path: "a.ts", mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1, hash: "h2" };
    store.fileHashes.upsertMany("w", [a, b]);
    store.fileHashes.upsertMany("w", [{ ...a, hash: "h3" }]);
    expect(store.fileHashes.get("w", "b.ts")).toEqual({ ...a, hash: "h3" });
    expect(store.fileHashes.list("w").map((r) => r.path)).toEqual(["a.ts", "b.ts"]);
    store.fileHashes.removeMany("w", ["a.ts"]);
    expect(store.fileHashes.get("w", "a.ts")).toBeNull();
    expect(store.fileHashes.list("other")).toEqual([]);
  });
});

describe("test files and keys", () => {
  it("stores one closure per test file, newest wins", () => {
    const store = open(fakeCommonDir());
    const testFile = { project: "unit", path: "src/a.test.ts" };
    const record: TestFileRecord = {
      testFile,
      closure: {
        testFile,
        paths: ["src/a.test.ts", "src/a.ts"],
        complete: false,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: "w1",
    };
    store.testFiles.put(record);
    const newer = {
      ...record,
      closure: { ...record.closure, paths: ["src/a.test.ts"] },
      updatedAt: 2,
    };
    store.testFiles.put(newer);
    expect(store.testFiles.get(testFile)).toEqual(newer);
    expect(store.testFiles.list()).toEqual([newer]);
    store.testFiles.remove(testFile);
    expect(store.testFiles.get(testFile)).toBeNull();
  });

  it("keeps one key per worktree and test file", () => {
    const store = open(fakeCommonDir());
    const a: TestFileKeyRecord = {
      worktreeId: "w",
      testFile: { project: "", path: "a.test.ts" },
      key: "k1",
      revision: 1,
      pending: "queued",
    };
    const b = { ...a, testFile: { project: "", path: "b.test.ts" }, pending: null };
    store.testFileKeys.upsertMany([a, b]);
    store.testFileKeys.upsertMany([{ ...a, key: "k2", revision: 2, pending: "running" }]);
    expect(store.testFileKeys.list("w")).toEqual([
      { ...a, key: "k2", revision: 2, pending: "running" },
      b,
    ]);
    store.testFileKeys.remove("w", [b.testFile]);
    expect(store.testFileKeys.list("w")).toHaveLength(1);
  });
});

describe("checks", () => {
  it("upserts test and file checks and keeps the first-seen time", () => {
    const store = open(fakeCommonDir());
    const test: CheckRecord = {
      check: testCheck("suite > case"),
      location: { path: "src/a.test.ts", line: 1, column: 1 },
      templated: true,
      firstSeenAt: 10,
    };
    const file: CheckRecord = {
      check: fileCheck,
      location: null,
      templated: false,
      firstSeenAt: 10,
    };
    store.checks.upsertMany([test, file]);
    store.checks.upsertMany([{ ...test, templated: false, firstSeenAt: 20 }]);
    const listed = store.checks.listByTestFile({ project: "", path: "src/a.test.ts" });
    expect(listed).toEqual(
      expect.arrayContaining([{ ...test, templated: false, firstSeenAt: 10 }, file]),
    );
    expect(listed).toHaveLength(2);
    expect(store.checks.listByTestFile({ project: "other", path: "src/a.test.ts" })).toEqual([]);
  });
});

describe("results", () => {
  it("keys results by check and key and deduplicates failure text", () => {
    const store = open(fakeCommonDir());
    const errors = [
      {
        name: "AssertionError",
        message: "expected 1 to be 2",
        stack: "at src/a.test.ts:3:5",
        location: { path: "src/a.test.ts", line: 3, column: 5 },
        diff: "- 1\n+ 2",
      },
    ];
    const failing = result(testCheck("one"), "k1", { outcome: "fail", errors });
    const passing = result(testCheck("two"), "k1");
    const sameText = result(testCheck("three"), "k1", { outcome: "fail", errors });
    store.results.putMany([failing, passing, sameText]);
    expect(store.results.byKey("k1")).toEqual(expect.arrayContaining([failing, passing, sameText]));
    expect(store.results.byKey("k1")).toHaveLength(3);
    expect(store.results.byKey("k2")).toEqual([]);

    const replaced = { ...passing, outcome: "skip" as const };
    store.results.putMany([replaced]);
    expect(store.results.byKey("k1")).toHaveLength(3);
    expect(store.results.byKey("k1")).toContainEqual(replaced);
  });

  it("returns the newest result of a check across keys", () => {
    const store = open(fakeCommonDir());
    const check = testCheck("one");
    store.results.putMany([
      result(check, "old", { recordedAt: 1 }),
      result(check, "new", { recordedAt: 3 }),
      result(check, "mid", { recordedAt: 2 }),
    ]);
    expect(store.results.latestForCheck(check)?.key).toBe("new");
    expect(store.results.latestForCheck(testCheck("none"))).toBeNull();
  });

  it("lists the checks stored under a key, without other keys' checks", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([
      result(testCheck("b"), "k1"),
      result(fileCheck, "k1", { outcome: "fail" }),
      result(testCheck("a"), "k1"),
      result(testCheck("renamed away"), "k0"),
    ]);
    expect(store.results.checksForKey("k1")).toEqual([fileCheck, testCheck("a"), testCheck("b")]);
    expect(store.results.checksForKey("k0")).toEqual([testCheck("renamed away")]);
    expect(store.results.checksForKey("missing")).toEqual([]);
  });
});

describe("runs", () => {
  it("starts, finishes and round-trips the checkpoint a tier belongs to", () => {
    const store = open(fakeCommonDir());
    const base = {
      worktreeId: "w",
      revision: 1,
      testFiles: [{ project: "", path: "a.test.ts" }],
      checkpointId: "cp-1",
      logDir: "/repo/.git/squeal/runs/r1",
      startedAt: 1,
    };
    const r1 = store.runs.start({ ...base, id: "r1" });
    expect(r1).toEqual({ ...base, id: "r1", endedAt: null, end: null });
    store.runs.start({ ...base, id: "r2", startedAt: 2, checkpointId: null });
    store.runs.finish("r1", "completed", 10);
    store.runs.finish("r2", "crashed", 20);
    expect(store.runs.get("r1")).toEqual({ ...r1, endedAt: 10, end: "completed" });
    expect(store.runs.get("r2")).toMatchObject({ checkpointId: null, endedAt: 20, end: "crashed" });
    expect(store.runs.get("missing")).toBeNull();
  });
});

describe("checkpoints", () => {
  it("starts, finishes and finds the newest completed checkpoint of a worktree", () => {
    const store = open(fakeCommonDir());
    const base = {
      worktreeId: "w",
      revision: 3,
      kind: "run-all" as const,
      testFiles: [
        { project: "", path: "a.test.ts" },
        { project: "", path: "b.test.ts" },
      ],
      startedAt: 1,
    };
    const first = store.checkpoints.start({ ...base, id: "cp-1" });
    expect(first).toEqual({ ...base, id: "cp-1", completedAt: null, end: null });
    expect(store.checkpoints.get("cp-1")).toEqual(first);
    expect(store.checkpoints.lastCompleted("w")).toBeNull();

    store.checkpoints.start({ ...base, id: "cp-2", kind: "baseline", revision: 1, startedAt: 2 });
    store.checkpoints.start({ ...base, id: "cp-3", revision: 5, startedAt: 3 });
    store.checkpoints.start({ ...base, id: "cp-4", revision: 6, startedAt: 4 });
    store.checkpoints.start({ ...base, id: "cp-other", worktreeId: "x", startedAt: 5 });
    store.checkpoints.finish("cp-1", "completed", 10);
    store.checkpoints.finish("cp-2", "completed", 20);
    store.checkpoints.finish("cp-3", "abandoned", 30);
    // cp-4 is still running.

    expect(store.checkpoints.get("cp-2")).toEqual({
      ...base,
      id: "cp-2",
      kind: "baseline",
      revision: 1,
      startedAt: 2,
      completedAt: 20,
      end: "completed",
    });
    expect(store.checkpoints.lastCompleted("w")?.id).toBe("cp-2");
    expect(store.checkpoints.lastCompleted("x")).toBeNull();
    expect(store.checkpoints.get("missing")).toBeNull();
  });
});

describe("known states", () => {
  it("upserts per worktree and check", () => {
    const store = open(fakeCommonDir());
    const a = knownState("w", testCheck("a"));
    const b = {
      ...knownState("w", fileCheck),
      outcome: "unknown" as const,
      validity: "pending" as const,
      pendingPhase: "running" as const,
      observedAt: null,
      origin: null,
      durationMs: null,
      summary: null,
      fingerprint: null,
    };
    const own = { ...a, check: testCheck("c"), origin: { kind: "own" as const }, commit: "abc" };
    const skipped = { ...own, check: testCheck("d"), outcome: "skip" as const, summary: null };
    store.knownStates.upsertMany([a, b, own, skipped]);
    store.knownStates.upsertMany([{ ...a, outcome: "pass", summary: null, fingerprint: null }]);
    expect(store.knownStates.get("w", testCheck("a"))).toEqual({
      ...a,
      outcome: "pass",
      summary: null,
      fingerprint: null,
    });
    expect(store.knownStates.get("w", fileCheck)).toEqual(b);
    expect(store.knownStates.get("w", testCheck("c"))).toEqual(own);
    expect(store.knownStates.get("w", testCheck("d"))).toEqual(skipped);
    expect(store.knownStates.list("w")).toHaveLength(4);
    expect(store.knownStates.get("other", fileCheck)).toBeNull();
  });

  it("removes the given checks of one worktree only", () => {
    const store = open(fakeCommonDir());
    const states = ["a", "b", "c"].map((name) => knownState("w", testCheck(name)));
    store.knownStates.upsertMany([...states, knownState("other", testCheck("a"))]);
    store.knownStates.removeMany("w", [testCheck("a"), testCheck("c"), testCheck("never seen")]);
    expect(store.knownStates.list("w").map((s) => s.check)).toEqual([testCheck("b")]);
    expect(store.knownStates.get("other", testCheck("a"))).not.toBeNull();
    store.knownStates.removeMany("w", []);
    expect(store.knownStates.list("w")).toHaveLength(1);
  });
});

describe("transitions", () => {
  it("appends and returns history in order", () => {
    const store = open(fakeCommonDir());
    const first = transition("w");
    const second = {
      ...first,
      kind: "fail-to-pass" as const,
      from: "fail" as const,
      to: "pass" as const,
      at: 9,
    };
    store.transitions.append([first]);
    const fromSkip = { ...first, from: "skip" as const, at: 10 };
    store.transitions.append([second, { ...first, check: testCheck("other") }, fromSkip]);
    expect(store.transitions.history("w", testCheck("t"))).toEqual([first, second, fromSkip]);
  });
});

describe("consumers and views", () => {
  const consumer: Consumer = { worktreeId: "w", sessionId: "s1", agentId: "main" };

  it("registers, touches, unregisters and expires", () => {
    const store = open(fakeCommonDir());
    expect(store.consumers.register(consumer, 5)).toEqual({
      consumer,
      registeredAt: 5,
      lastSeenAt: 5,
      lastDeliveredAt: null,
    });
    store.consumers.touch(consumer, 7, false);
    store.consumers.touch(consumer, 8, true);
    expect(store.consumers.get(consumer)).toEqual({
      consumer,
      registeredAt: 5,
      lastSeenAt: 8,
      lastDeliveredAt: 8,
    });
    const sub = { ...consumer, agentId: "agent-2" };
    store.consumers.register(sub, 100);
    store.views.writeMany(consumer, [view()]);
    expect(store.consumers.list("w")).toHaveLength(2);

    expect(store.consumers.expire(50)).toEqual([consumer]);
    expect(store.consumers.get(consumer)).toBeNull();
    expect(store.views.list(consumer)).toEqual([]);
    expect(store.consumers.get(sub)).not.toBeNull();

    store.consumers.unregister(sub);
    expect(store.consumers.list("w")).toEqual([]);
  });

  it("replaces view entries per check and clears them on re-registration", () => {
    const store = open(fakeCommonDir());
    store.consumers.register(consumer, 1);
    const a = view();
    const b = { ...view(), check: fileCheck, outcome: "pass" as const, fingerprint: null };
    const c = { ...b, check: testCheck("skipped"), outcome: "skip" as const };
    store.views.writeMany(consumer, [a, b, c]);
    store.views.writeMany(consumer, [{ ...a, outcome: "pass", fingerprint: null, toldAt: 9 }]);
    expect(store.views.list(consumer)).toEqual(
      expect.arrayContaining([{ ...a, outcome: "pass", fingerprint: null, toldAt: 9 }, b, c]),
    );
    expect(store.views.list(consumer)).toHaveLength(3);
    expect(store.views.list({ ...consumer, agentId: "x" })).toEqual([]);

    store.consumers.register(consumer, 2);
    expect(store.views.list(consumer)).toEqual([]);
  });

  it("removes the given checks from one consumer's view only", () => {
    const store = open(fakeCommonDir());
    const sub = { ...consumer, agentId: "agent-2" };
    const entries = ["a", "b", "c"].map((name) => ({ ...view(), check: testCheck(name) }));
    store.views.writeMany(consumer, entries);
    store.views.writeMany(sub, entries);
    store.views.removeMany(consumer, [testCheck("a"), testCheck("c"), testCheck("never seen")]);
    expect(store.views.list(consumer).map((e) => e.check)).toEqual([testCheck("b")]);
    expect(store.views.list(sub)).toHaveLength(3);
  });
});

describe("meta and transactions", () => {
  it("sets and gets meta values", () => {
    const store = open(fakeCommonDir());
    expect(store.meta.get("a")).toBeNull();
    store.meta.set("a", "1");
    store.meta.set("a", "2");
    expect(store.meta.get("a")).toBe("2");
  });

  it("rolls back everything written inside a failed transaction", () => {
    const store = open(fakeCommonDir());
    expect(() =>
      store.transaction(() => {
        store.meta.set("a", "1");
        store.results.putMany([result(testCheck("x"), "k")]);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(store.meta.get("a")).toBeNull();
    expect(store.results.byKey("k")).toEqual([]);
  });

  it("rolls back only the inner part of a nested transaction", () => {
    const store = open(fakeCommonDir());
    const value = store.transaction(() => {
      store.meta.set("outer", "1");
      expect(() =>
        store.transaction(() => {
          store.meta.set("inner", "1");
          throw new Error("inner");
        }),
      ).toThrow("inner");
      return 42;
    });
    expect(value).toBe(42);
    expect(store.meta.get("outer")).toBe("1");
    expect(store.meta.get("inner")).toBeNull();
  });
});

function transition(worktreeId: string): Transition {
  return {
    worktreeId,
    check: testCheck("t"),
    kind: "first-seen-fail",
    from: null,
    to: "fail",
    fromFingerprint: null,
    toFingerprint: "Error: x",
    revision: 1,
    at: 3,
  };
}

function view() {
  return { check: testCheck("t"), outcome: "fail" as const, fingerprint: "Error: x", toldAt: 4 };
}
