import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, expireConsumers } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type DeltaEntry,
  type DeltaKind,
  type HarnessDelivery,
  REGRESSION_KINDS,
  type ResultRecord,
  type StateSink,
  type Store,
  type TransitionKind,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

const NONE = { checkpointId: null };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "sub-1" };
const A = check("a");
const B = check("b");

/** `baseline` of a transition entry; retired entries have none. */
const baselineOf = (e: DeltaEntry) => ("baseline" in e ? e.baseline : undefined);

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let clock: number;
let revision: number;

beforeEach(() => {
  store = freshStore();
  clock = 10_000;
  revision = 0;
  sink = createStateSink(store, { now: () => clock });
  delivery = createDelivery(store, {
    status: fixedStatus(),
    now: () => clock,
    pollIntervalMs: 5,
  });
  setKey(store, "k1");
});

function apply(...results: ResultRecord[]) {
  revision++;
  sink.applyResults(WT, revision, results, NONE);
}

const pass = () => result(A, "pass");
const fail = (message = "expected 1 to be 2") => result(A, "fail", { message });

async function kindsFor(consumer: Consumer): Promise<DeltaKind[] | null> {
  const delta = await delivery.onToolBoundary(consumer);
  return delta === null ? null : delta.entries.map((e) => e.kind);
}

describe("onToolBoundary", () => {
  const cases: [TransitionKind, () => void, () => void][] = [
    ["first-seen-fail", () => {}, () => apply(fail())],
    ["pass-to-fail", () => apply(pass()), () => apply(fail())],
    ["fail-to-pass", () => apply(fail()), () => apply(pass())],
    ["fail-changed", () => apply(fail("one")), () => apply(fail("two"))],
    ["to-unknown", () => apply(pass()), () => sink.markUnknown(WT, 9, [FILE], "runner crashed")],
  ];

  it.each(cases)("delivers %s exactly once", async (kind, before, change) => {
    before();
    await delivery.register(C1);
    change();
    expect(await kindsFor(C1)).toEqual([kind]);
    expect(await kindsFor(C1)).toBeNull();
  });

  it("delivers the entry with its state", async () => {
    apply(pass());
    await delivery.register(C1);
    apply(fail());
    const delta = await delivery.onToolBoundary(C1);
    expect(delta).toMatchObject({
      schemaVersion: 1,
      consumer: C1,
      label: "transitions",
      entries: [
        {
          check: A,
          kind: "pass-to-fail",
          from: "pass",
          to: "fail",
          validity: "current",
          observedAt: 1,
          origin: { kind: "own" },
          summary: "expected 1 to be 2",
          location: { path: "src/a.ts", line: 3, column: 5 },
        },
      ],
    });
    expect(delta?.entries.map(baselineOf)).toEqual([undefined]);
  });

  it("names the root of the worktree an inherited result came from", async () => {
    store.worktrees.upsert({
      id: OTHER,
      root: "/repo/other",
      commonDir: "/repo/.git",
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    const gone = "wt-gone";
    await delivery.register(C1);
    apply(
      result(A, "fail", { worktreeId: OTHER, commit: "beef" }),
      result(B, "fail", { worktreeId: gone, commit: "beef" }),
    );
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.entries).toEqual([
      expect.objectContaining({
        check: A,
        origin: { kind: "inherited", worktreeId: OTHER, commit: "beef" },
        originRoot: "/repo/other",
      }),
      expect.not.objectContaining({ originRoot: expect.anything() }),
    ]);
  });

  it("stays silent for PASS -> PASS and for FAIL -> FAIL with the same fingerprint", async () => {
    apply(pass(), result(B, "fail"));
    await delivery.register(C1);
    apply(pass(), result(B, "fail"));
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("stays silent when a check breaks and recovers between two deliveries", async () => {
    apply(pass(), result(B, "fail"));
    await delivery.register(C1);
    apply(fail(), result(B, "pass"));
    apply(pass(), result(B, "fail"));
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("stays silent for a skip", async () => {
    apply(fail());
    await delivery.register(C1);
    apply(result(A, "skip"));
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("stays silent when a told failure is skipped and comes back unchanged", async () => {
    apply(fail());
    await delivery.register(C1);
    apply(result(A, "skip"));
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    apply(fail());
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    apply(pass());
    expect(await kindsFor(C1)).toEqual(["fail-to-pass"]);
  });

  it("writes a pass never told to anyone into the view silently", async () => {
    await delivery.register(C1);
    apply(pass());
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(store.views.list(C1).map((v) => v.outcome)).toEqual(["pass"]);
    apply(fail());
    expect(await kindsFor(C1)).toEqual(["pass-to-fail"]);
  });

  it("puts failures first", async () => {
    const c = check("c");
    apply(pass(), result(B, "fail"), result(c, "pass"));
    await delivery.register(C1);
    apply(fail(), result(B, "pass"), result(c, "fail"));
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.entries.map((e) => [e.check, e.kind])).toEqual([
      [A, "pass-to-fail"],
      [c, "pass-to-fail"],
      [B, "fail-to-pass"],
    ]);
  });

  it("keeps independent views for two consumers on one worktree", async () => {
    await delivery.register(C1);
    await delivery.register(C2);
    apply(fail());
    expect(await kindsFor(C1)).toEqual(["first-seen-fail"]);
    apply(pass());
    expect(await kindsFor(C1)).toEqual(["fail-to-pass"]);
    expect(await kindsFor(C2)).toBeNull();
  });

  it("returns null and writes nothing for an unregistered consumer", async () => {
    apply(fail());
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(store.views.list(C1)).toEqual([]);
    expect(store.consumers.get(C1)).toBeNull();
  });

  it("drops view entries of retired checks told as passing silently", async () => {
    apply(pass(), result(B, "pass"));
    await delivery.register(C1);
    sink.retire(WT, [A]);
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(store.views.list(C1).map((v) => v.check)).toEqual([B]);
  });

  it("delivers a retired check told as failing once, as no longer reported", async () => {
    const fileLevel = { kind: "file" as const, project: "", testPath: FILE.path };
    apply(result(fileLevel, "fail"), result(B, "pass"));
    await delivery.register(C1);
    await delivery.register(C2);
    store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: FILE.path, oldHash: "a", newHash: "b" }],
    });
    sink.retire(WT, [fileLevel]);

    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.entries).toEqual([
      {
        check: fileLevel,
        kind: "fail-retired",
        from: "fail",
        to: null,
        fingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:3:5",
        observedAt: 1,
      },
    ]);
    expect(delta?.label).toBe("transitions");
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(store.views.list(C1).map((v) => v.check)).toEqual([B]);
    expect((await delivery.onToolBoundary(C2))?.entries.map((e) => e.kind)).toEqual([
      "fail-retired",
    ]);
  });

  it("stays silent when a retired told failure comes back unchanged before delivery", async () => {
    apply(fail());
    await delivery.register(C1);
    sink.retire(WT, [A]);
    apply(fail());
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("records when the consumer was seen and delivered to", async () => {
    await delivery.register(C1);
    clock = 20_000;
    await delivery.onToolBoundary(C1);
    expect(store.consumers.get(C1)).toMatchObject({ lastSeenAt: 20_000, lastDeliveredAt: null });
    apply(fail());
    clock = 30_000;
    await delivery.onToolBoundary(C1);
    expect(store.consumers.get(C1)).toMatchObject({ lastSeenAt: 30_000, lastDeliveredAt: 30_000 });
  });
});

describe("peek", () => {
  it("consumes regressions only; a following onToolBoundary still delivers the recoveries", async () => {
    const c = check("c");
    apply(pass(), result(B, "fail"), result(c, "fail", { message: "one" }));
    await delivery.register(C1);
    apply(fail(), result(B, "pass"), result(c, "fail", { message: "two" }));

    const peeked = await delivery.peek(C1, { kinds: REGRESSION_KINDS });
    expect(peeked?.entries.map((e) => [e.check, e.kind])).toEqual([[A, "pass-to-fail"]]);
    expect(peeked?.label).toBe("transitions");
    expect(await delivery.peek(C1, { kinds: REGRESSION_KINDS })).toBeNull();

    const rest = await delivery.onToolBoundary(C1);
    expect(rest?.entries.map((e) => [e.check, e.kind])).toEqual([
      [c, "fail-changed"],
      [B, "fail-to-pass"],
    ]);
  });

  it("leaves other consumers and retired failures alone", async () => {
    apply(pass(), result(B, "fail"));
    await delivery.register(C1);
    await delivery.register(C2);
    sink.retire(WT, [B]);
    apply(fail());

    expect((await delivery.peek(C1, { kinds: REGRESSION_KINDS }))?.entries).toHaveLength(1);
    expect(await kindsFor(C1)).toEqual(["fail-retired"]);
    expect(await kindsFor(C2)).toEqual(["pass-to-fail", "fail-retired"]);
  });

  it("returns null for an unregistered consumer", async () => {
    apply(fail());
    expect(await delivery.peek(C1, { kinds: REGRESSION_KINDS })).toBeNull();
    expect(store.views.list(C1)).toEqual([]);
  });
});

describe("register", () => {
  it("reports pre-existing and inherited failures once, in the registration only", async () => {
    apply(
      fail(),
      result(B, "fail", { worktreeId: OTHER, commit: "beef" }),
      result(check("c"), "pass"),
    );

    const registration = await delivery.register(C1);
    expect(registration.knownFailures.map((f) => [f.check, f.summary, f.validity])).toEqual([
      [A, "expected 1 to be 2", "current"],
      [B, "expected 1 to be 2", "current"],
    ]);
    expect(registration.knownFailures[0]).toMatchObject({
      outcome: "fail",
      observedAt: 1,
      fingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:3:5",
      location: { path: "src/a.ts", line: 3, column: 5 },
    });
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("re-seeds the view of a consumer that registers again", async () => {
    await delivery.register(C1);
    apply(fail());
    const again = await delivery.register(C1);
    expect(again.knownFailures).toHaveLength(1);
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("carries the header", async () => {
    apply(pass(), result(B, "pass", { key: "old" }));
    store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/a.ts", oldHash: null, newHash: "abc" }],
    });
    const cp = store.checkpoints.start({
      id: "cp-1",
      worktreeId: WT,
      revision: 1,
      kind: "run-all",
      testFiles: [FILE],
      startedAt: 1,
    });
    store.checkpoints.finish(cp.id, "completed", 2);

    const { header } = await delivery.register(C1);
    expect(header).toEqual({
      revision: 1,
      counts: { current: 1, pending: 0, stale: 1, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: true, lastCompletedRevision: 1 },
      testFilesListed: true,
      inheritedCount: 0,
      daemon: { state: "down", since: null },
    });
  });

  it("reports revision 0 and no full suite on an empty store", async () => {
    const { header, knownFailures } = await delivery.register(C1);
    expect(header).toEqual({
      revision: 0,
      counts: { current: 0, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 1 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      testFilesListed: true,
      inheritedCount: 0,
      daemon: { state: "down", since: null },
    });
    expect(knownFailures).toEqual([]);
  });

  it("says the test files are not listed while no key and no completed checkpoint exist (lessons, defect 4)", async () => {
    store.testFileKeys.remove(WT, [FILE]);
    expect((await delivery.register(C1)).header.testFilesListed).toBe(false);

    const cp = store.checkpoints.start({
      id: "cp-empty",
      worktreeId: WT,
      revision: 0,
      kind: "baseline",
      testFiles: [],
      startedAt: 1,
    });
    store.checkpoints.finish(cp.id, "completed", 2);
    // A project with no test files at all is listed once its baseline completed.
    expect((await delivery.register(C2)).header.testFilesListed).toBe(true);
  });

  it("counts current inherited results", async () => {
    apply(result(A, "pass", { worktreeId: OTHER, commit: "beef" }), result(B, "pass"));
    expect((await delivery.register(C1)).header.inheritedCount).toBe(1);
  });

  it("counts test files without checks: never-run as unknown, queued and running as pending", async () => {
    apply(pass());
    const file = (path: string) => ({ project: "", path });
    setKey(store, "k-new", { file: file("src/new.test.ts") });
    setKey(store, "k-queued", { file: file("src/queued.test.ts"), pending: "queued" });
    setKey(store, "k-running", { file: file("src/running.test.ts"), pending: "running" });
    setKey(store, "k1", { pending: "queued" });

    const { header } = await delivery.register(C1);

    expect(header.testFilesWithoutChecks).toEqual({ pending: 2, unknown: 1 });
  });
});

describe("baseline findings", () => {
  function startBaseline(id = "cp-base") {
    store.checkpoints.start({
      id,
      worktreeId: WT,
      revision: 0,
      kind: "baseline",
      testFiles: [FILE],
      startedAt: 1,
    });
    return { checkpointId: id };
  }

  it("labels failures first observed by the baseline checkpoint after registration", async () => {
    await delivery.register(C1);
    sink.applyResults(WT, 1, [fail(), result(B, "pass")], startBaseline());
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.label).toBe("baseline");
    expect(delta?.entries.map((e) => [e.check, e.kind, baselineOf(e)])).toEqual([
      [A, "first-seen-fail", true],
    ]);
  });

  it("labels a lookup hit made for the baseline", async () => {
    await delivery.register(C1);
    store.results.putMany([result(A, "fail", { worktreeId: OTHER })]);
    sink.refresh(WT, 1, startBaseline());
    expect((await delivery.onToolBoundary(C1))?.label).toBe("baseline");
  });

  it("labels each entry when baseline findings and transitions mix", async () => {
    apply(result(B, "pass"));
    await delivery.register(C1);
    sink.applyResults(WT, 2, [fail()], startBaseline());
    apply(result(B, "fail"));
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.label).toBe("transitions");
    expect(delta?.entries.map((e) => [e.check, baselineOf(e) ?? false])).toEqual([
      [B, false],
      [A, true],
    ]);
  });

  it("does not label first-seen failures of other checkpoints", async () => {
    await delivery.register(C1);
    store.checkpoints.start({
      id: "cp-all",
      worktreeId: WT,
      revision: 0,
      kind: "run-all",
      testFiles: [FILE],
      startedAt: 1,
    });
    sink.applyResults(WT, 1, [fail()], { checkpointId: "cp-all" });
    expect((await delivery.onToolBoundary(C1))?.label).toBe("transitions");
  });

  it("stops labelling a check after a later transition", async () => {
    await delivery.register(C1);
    sink.applyResults(WT, 1, [fail()], startBaseline());
    sink.markUnknown(WT, 2, [FILE], "runner crashed");
    apply(fail());
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.entries.map((e) => [e.kind, baselineOf(e) ?? false])).toEqual([
      ["first-seen-fail", false],
    ]);
  });
});

describe("waitForDelta", () => {
  it("resolves with the first non-empty delta", async () => {
    await delivery.register(C1);
    const waiting = delivery.waitForDelta(C1, { timeoutMs: 5_000 });
    setTimeout(() => apply(fail()), 30);
    const delta = await waiting;
    expect(delta?.entries.map((e) => e.kind)).toEqual(["first-seen-fail"]);
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("resolves null on timeout", async () => {
    await delivery.register(C1);
    const started = performance.now();
    expect(await delivery.waitForDelta(C1, { timeoutMs: 40 })).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(35);
  });

  it("resolves null on abort", async () => {
    await delivery.register(C1);
    const controller = new AbortController();
    const waiting = delivery.waitForDelta(C1, { timeoutMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await waiting).toBeNull();
  });
});

describe("lifecycle", () => {
  it("unregister drops the consumer and its view", async () => {
    apply(fail());
    await delivery.register(C1);
    await delivery.unregister(C1);
    expect(store.consumers.get(C1)).toBeNull();
    expect(store.views.list(C1)).toEqual([]);
  });

  it("status delegates to the status builder", async () => {
    const status = await delivery.status(WT);
    expect(status).toMatchObject({ available: false, reason: "timeout" });
  });

  it("expires consumers idle for 12 hours", async () => {
    await delivery.register(C1);
    clock = 10_000 + CONSUMER_EXPIRY_MS / 2;
    await delivery.register(C2);
    expect(expireConsumers(store, 10_001 + CONSUMER_EXPIRY_MS)).toEqual([C1]);
    expect(store.consumers.list(WT).map((r) => r.consumer)).toEqual([C2]);
  });
});
