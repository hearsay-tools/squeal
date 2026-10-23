import { describe, expect, it } from "vitest";
import { recordRunLoad } from "../../src/core/retry/index.js";
import { recordFailureKeys } from "../../src/core/slow/state.js";
import {
  checkIdentity,
  createStateSink,
  failureProducersMetaKey,
  recordFailureProducers,
} from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { result } from "../store/helpers.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Task 001-404: a known failure in `squeal status` says how old the run that
 * recorded it is and the host's load per CPU at that run, joined from the
 * result's provenance and `failed-run-loads`; the verdict stays the stored one.
 */

const AUTH = check("src/auth.test.ts", "auth > login");
const NOW = Date.UTC(2026, 9, 15, 12, 0);

function seeded(recordedAt: number) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  store.testFileKeys.upsertMany([
    {
      worktreeId: repo.mainId,
      testFile: { project: "", path: "src/auth.test.ts" },
      key: "k1",
      revision: 4,
      pending: null,
    },
  ]);
  const produced = result(AUTH, "k1", {
    outcome: "fail",
    worktreeId: repo.mainId,
    runId: "run-1",
    recordedAt,
  });
  store.results.putMany([produced]);
  recordFailureKeys(store, repo.mainId, new Map([[checkIdentity(AUTH), "k1"]]));
  recordFailureProducers(store, repo.mainId, [produced]);
  store.knownStates.upsertMany([
    state(repo.mainId, AUTH, {
      outcome: "fail",
      observedAt: 4,
      commit: "abc123",
      summary: "expected 1 to be 2",
      fingerprint: "AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
    }),
  ]);
  return { repo, store, produced };
}

describe("status: a known failure's age and load (001-404)", () => {
  it("dates an old failure and names the load its run ran under", () => {
    const { repo, store } = seeded(NOW - 3 * 3_600_000 - 10 * 60_000);
    recordRunLoad(store, "run-1", 3.33);

    const status = readStatus(repo.main, { now: () => NOW });
    const text = formatStatus(status, NOW);

    expect(status.available && status.knownFailures[0]?.recorded).toMatchObject({
      recordedAt: NOW - 3 * 3_600_000 - 10 * 60_000,
      loadPerCpu: 3.33,
    });
    expect(text).toContain(
      "        recorded 3 h ago in this worktree at revision 4, load 3.33 per CPU when it ran; no retry asked at these inputs; `squeal retry src/auth.test.ts --reason load` runs it once more when the one-minute load average is below the CPU count\n",
    );
  });

  // Row 011-67 (gh-52): the CLI status names, the path from the cwd it ran in, and only under load.
  it("names the load retry as the reader's command would, and none below the CPU count", () => {
    const { repo, store } = seeded(NOW - 20_000);
    recordRunLoad(store, "run-1", 1);
    const status = readStatus(repo.main, { now: () => NOW });

    expect(formatStatus(status, NOW, "/opt/squeal", { base: "src" })).toContain(
      "load 1.00 per CPU when it ran; no retry asked at these inputs; `/opt/squeal retry auth.test.ts --reason load` runs it",
    );
    recordRunLoad(store, "run-1", 0.99);
    const below = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);
    expect(below).toContain("load 0.99 per CPU when it ran; no retry asked at these inputs\n");
    expect(below).not.toContain("--reason load");
  });

  it("reads a fresh failure as just now, and a load not kept as not recorded", () => {
    const { repo } = seeded(NOW - 20_000);

    const text = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);

    expect(text).toContain(
      "recorded just now in this worktree at revision 4, load per CPU then not recorded;",
    );
  });
});

/*
 * Review 001-417 B3: the age and load are the producing result's, read
 * before any row at the file's current key is trusted.
 */
describe("status: a failure's age comes from the result that produced it (review 001-417 B3)", () => {
  const OLD = NOW - 2 * 3_600_000;

  function rekeyed() {
    const seed = seeded(OLD);
    const { repo, store } = seed;
    recordRunLoad(store, "run-1", 1.5);
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.mainId,
        testFile: { project: "", path: "src/auth.test.ts" },
        key: "k2",
        revision: 4,
        pending: null,
      },
    ]);
    const known = store.knownStates.get(repo.mainId, AUTH);
    if (known === null) throw new Error("no known state");
    store.knownStates.upsertMany([{ ...known, validity: "pending", pendingPhase: "queued" }]);
    return seed;
  }

  const failureOf = (repo: ReturnType<typeof fakeRepo>) => {
    const status = readStatus(repo.main, { now: () => NOW });
    if (!status.available) throw new Error("status unavailable");
    return { failure: status.knownFailures[0], text: formatStatus(status, NOW) };
  };

  it("a re-keyed pending failure keeps its old run's age and load", () => {
    const { repo } = rekeyed();
    const { failure, text } = failureOf(repo);
    expect(failure?.recorded).toMatchObject({ recordedAt: OLD, loadPerCpu: 1.5, revision: 4 });
    expect(text).toContain("observed at revision 4, pending\n        recorded 2 h ago");
  });

  it("a pass another worktree cached at the new key lends it nothing", () => {
    const { repo, store } = rekeyed();
    store.results.putMany([
      result(AUTH, "k2", { worktreeId: "wt-other", runId: "run-pass", recordedAt: NOW - 1_000 }),
    ]);
    recordRunLoad(store, "run-pass", 9.99);
    const { failure } = failureOf(repo);
    expect(failure?.recorded).toMatchObject({ recordedAt: OLD, loadPerCpu: 1.5 });
  });

  it("a stale failure under a re-keyed file keeps its run's age too", () => {
    const { repo, store } = rekeyed();
    const known = store.knownStates.get(repo.mainId, AUTH);
    if (known === null) throw new Error("no known state");
    store.knownStates.upsertMany([{ ...known, validity: "stale", pendingPhase: null }]);
    expect(failureOf(repo).failure?.recorded?.recordedAt).toBe(OLD);
  });

  it("a same-key replacement by another result says the age and load are unknown", () => {
    const { repo, store } = seeded(OLD);
    store.results.putMany([
      result(AUTH, "k1", { worktreeId: "wt-other", runId: "run-pass", recordedAt: NOW - 1_000 }),
    ]);
    const { failure, text } = failureOf(repo);
    expect(failure?.recorded).toBeUndefined();
    expect(failure?.recordedUnknown).toBe(true);
    expect(text).toContain(
      "        recorded at an unknown time and load: the result that produced it is no longer identifiable in the store\n",
    );
  });

  it("an inherited failure recorded after its revision began keeps its source's facts", () => {
    const { repo, store, produced } = seeded(OLD);
    const b = repo.addWorktree("b");
    store.worktrees.upsert({
      id: b.id,
      root: b.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, b.id, 1, { head: null, dirty: true, createdAt: 1 });
    store.testFileKeys.upsertMany([
      {
        worktreeId: b.id,
        testFile: { project: "", path: "src/auth.test.ts" },
        key: "k1",
        revision: 1,
        pending: null,
      },
    ]);
    store.knownStates.upsertMany([
      state(b.id, AUTH, {
        outcome: "fail",
        observedAt: 1,
        commit: "abc123",
        origin: { kind: "inherited", worktreeId: repo.mainId, commit: "abc123" },
        summary: "expected 1 to be 2",
        fingerprint: "AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
      }),
    ]);
    recordFailureKeys(store, b.id, new Map([[checkIdentity(AUTH), "k1"]]));
    recordFailureProducers(store, b.id, [produced]);
    const status = readStatus(b.root, { now: () => NOW });
    if (!status.available) throw new Error("status unavailable");
    expect(status.knownFailures[0]?.recorded).toMatchObject({
      worktreeId: repo.mainId,
      recordedAt: OLD,
    });
  });
});

/*
 * Review 001-417 round 2, B3: through the real state sink, a worktree
 * inherits main's failure, then main replaces that row with the identical
 * failure from a later run. Status shows neither the replacement's time nor
 * its load.
 */
describe("status: an identical same-key replacement is not the producer (review 001-417 B3)", () => {
  it("says the age and load are unknown instead of the replacement's", () => {
    const { repo, store, produced } = seeded(NOW - 5 * 3_600_000);
    recordRunLoad(store, "run-1", 1.5);
    const b = repo.addWorktree("b");
    store.worktrees.upsert({
      id: b.id,
      root: b.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, b.id, 1, { head: null, dirty: true, createdAt: 1 });
    store.testFileKeys.upsertMany([
      {
        worktreeId: b.id,
        testFile: { project: "", path: "src/auth.test.ts" },
        key: "k1",
        revision: 1,
        pending: null,
      },
    ]);
    const sink = createStateSink(store);
    const own = result(AUTH, "k1", { outcome: "fail", worktreeId: b.id, runId: "run-b" });
    store.results.putMany([own]);
    sink.applyResults(b.id, 1, [own], { checkpointId: null });
    store.results.putMany([produced]);
    sink.refresh(b.id, 1, { checkpointId: null });
    expect(store.knownStates.get(b.id, AUTH)?.origin?.kind).toBe("inherited");
    const facts = readStatus(b.root, { now: () => NOW });
    expect(facts.available && facts.knownFailures[0]?.recorded?.loadPerCpu).toBe(1.5);

    store.results.putMany([
      {
        ...produced,
        provenance: { ...produced.provenance, runId: "run-new", recordedAt: NOW - 1_000 },
      },
    ]);
    recordRunLoad(store, "run-new", 9.9);

    const status = readStatus(b.root, { now: () => NOW });
    if (!status.available) throw new Error("status unavailable");
    expect(status.knownFailures[0]?.recorded).toBeUndefined();
    expect(status.knownFailures[0]?.recordedUnknown).toBe(true);
    const text = formatStatus(status, NOW);
    expect(text).toContain("recorded at an unknown time and load");
    expect(text).not.toContain("9.90");
    expect(text).not.toContain("just now");
  });
});

/*
 * Review 001-417 round 3, N2 (task 001-420): an older daemon, whose sink
 * predates `failure-producers`, rewrites the state and leaves the reference
 * a producer-aware sink wrote. Simulated by the current sink with that row
 * restored: the older sink records failure keys but never the producer.
 */
describe("status: a producer reference left by an older writer (001-420)", () => {
  function inheritedThenOlderWriter() {
    const { repo, store, produced } = seeded(NOW - 5 * 3_600_000);
    recordRunLoad(store, "run-1", 9.9);
    const b = repo.addWorktree("b");
    store.worktrees.upsert({
      id: b.id,
      root: b.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, b.id, 2, { head: null, dirty: true, createdAt: 1 });
    const keyAt = (key: string, revision: number) =>
      store.testFileKeys.upsertMany([
        {
          worktreeId: b.id,
          testFile: { project: "", path: "src/auth.test.ts" },
          key,
          revision,
          pending: null,
        },
      ]);
    keyAt("k1", 1);
    const sink = createStateSink(store);
    const confirmed = result(AUTH, "k1", { outcome: "fail", worktreeId: b.id, runId: "run-b" });
    store.results.putMany([confirmed]);
    sink.applyResults(b.id, 1, [confirmed], { checkpointId: null });
    store.results.putMany([produced]);
    sink.refresh(b.id, 1, { checkpointId: null });
    expect(store.knownStates.get(b.id, AUTH)?.origin?.kind).toBe("inherited");
    const reference = store.meta.get(failureProducersMetaKey(b.id));
    expect(reference).not.toBeNull();
    const olderSink = {
      applyResults: (...args: Parameters<typeof sink.applyResults>) => {
        sink.applyResults(...args);
        store.meta.set(failureProducersMetaKey(b.id), reference ?? "");
      },
      refresh: (...args: Parameters<typeof sink.refresh>) => {
        sink.refresh(...args);
        store.meta.set(failureProducersMetaKey(b.id), reference ?? "");
      },
    };
    return { repo, store, produced, b, keyAt, olderSink };
  }

  /** The receiver's own failure at `k2`, revision 2: what lets it inherit at that key. */
  const ownAtK2 = (b: { id: string }) => {
    const ran = result(AUTH, "k2", {
      outcome: "fail",
      worktreeId: b.id,
      runId: "older-own-new-key",
      recordedAt: NOW - 2_000,
    });
    return { ...ran, provenance: { ...ran.provenance, revision: 2 } };
  };

  const failureIn = (root: string) => {
    const status = readStatus(root, { now: () => NOW });
    if (!status.available) throw new Error("status unavailable");
    return { failure: status.knownFailures[0], text: formatStatus(status, NOW) };
  };

  it("an own failure at a new key does not take the inherited source's facts", () => {
    const { store, b, keyAt, olderSink } = inheritedThenOlderWriter();
    keyAt("k2", 2);
    const own = ownAtK2(b);
    store.results.putMany([own]);
    olderSink.applyResults(b.id, 2, [own], { checkpointId: null });
    expect(store.knownStates.get(b.id, AUTH)).toMatchObject({
      origin: { kind: "own" },
      observedAt: 2,
      commit: "abc123",
    });

    const { failure, text } = failureIn(b.root);
    expect(failure?.recorded).toBeUndefined();
    expect(failure?.recordedUnknown).toBe(true);
    expect(text).not.toContain("9.90");
  });

  it("the same source's later failure at a new key does not keep the old run's facts", () => {
    const { repo, store, produced, b, keyAt, olderSink } = inheritedThenOlderWriter();
    keyAt("k2", 2);
    const own = ownAtK2(b);
    store.results.putMany([own]);
    olderSink.applyResults(b.id, 2, [own], { checkpointId: null });
    const later = result(AUTH, "k2", {
      outcome: "fail",
      worktreeId: repo.mainId,
      runId: "run-later",
      recordedAt: NOW - 1_000,
    });
    store.results.putMany([later]);
    olderSink.refresh(b.id, 2, { checkpointId: null });
    expect(store.knownStates.get(b.id, AUTH)?.origin).toMatchObject({
      kind: "inherited",
      worktreeId: repo.mainId,
    });
    expect(store.results.listForCheck(AUTH, 10)).toContainEqual(produced);

    const { failure } = failureIn(b.root);
    expect(failure?.recorded).toBeUndefined();
    expect(failure?.recordedUnknown).toBe(true);
  });

  it("a producer-aware refresh at the new key names the new run", () => {
    const { repo, store, b, keyAt, olderSink } = inheritedThenOlderWriter();
    keyAt("k2", 2);
    const own = ownAtK2(b);
    store.results.putMany([own]);
    olderSink.applyResults(b.id, 2, [own], { checkpointId: null });
    store.results.putMany([
      result(AUTH, "k2", {
        outcome: "fail",
        worktreeId: repo.mainId,
        runId: "run-later",
        recordedAt: NOW - 1_000,
      }),
    ]);
    createStateSink(store).refresh(b.id, 2, { checkpointId: null });
    expect(failureIn(b.root).failure?.recorded).toMatchObject({
      worktreeId: repo.mainId,
      recordedAt: NOW - 1_000,
    });
  });
});
