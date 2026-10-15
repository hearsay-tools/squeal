import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
} from "../../src/core/types/index.js";
import { check, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Review 001-417 B3: a known failure at registration carries the age and
 * load of the result that produced it, never of a row that merely sits at
 * its test file's current key.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a");
const NONE = { checkpointId: null };

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1");
  liveDaemon(store, WT);
  store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: null, newHash: "h1" }],
  });
});

function at(row: ResultRecord, recordedAt: number, runId = row.provenance.runId): ResultRecord {
  return { ...row, provenance: { ...row.provenance, recordedAt, runId } };
}

function apply(...results: ResultRecord[]): void {
  store.results.putMany(results);
  sink.applyResults(WT, 1, results, NONE);
}

/** The failure moves to a key without a result; its state awaits the re-run. */
function rekey(): void {
  setKey(store, "k2");
  const known = store.knownStates.get(WT, A);
  if (known === null) throw new Error("no known state");
  store.knownStates.upsertMany([{ ...known, validity: "pending", pendingPhase: "queued" }]);
}

async function registered() {
  const registration = await delivery.register(C1, { atStart: true });
  return { failure: registration.knownFailures[0], text: formatRegistration(registration) };
}

describe("registration: a failure's age is its producer's (review 001-417 B3)", () => {
  it("a current own failure keeps its run's facts", async () => {
    apply(at(result(A, "fail"), 300));
    expect((await registered()).failure?.recorded).toMatchObject({ recordedAt: 300, revision: 1 });
  });

  it("a re-keyed pending failure keeps its old run's age", async () => {
    apply(at(result(A, "fail"), 300));
    rekey();
    expect((await registered()).failure?.recorded?.recordedAt).toBe(300);
  });

  it("a pass another worktree cached at the new key lends it nothing", async () => {
    apply(at(result(A, "fail"), 300));
    rekey();
    store.results.putMany([at(result(A, "pass", { key: "k2", worktreeId: OTHER }), 500, "run-b")]);
    const { failure } = await registered();
    expect(failure?.validity).toBe("pending");
    expect(failure?.recorded?.recordedAt).toBe(300);
  });

  it("a same-key replacement says the age and load are unknown", async () => {
    apply(at(result(A, "fail"), 300));
    store.results.putMany([at(result(A, "pass", { worktreeId: OTHER }), 500, "run-b")]);
    const { failure, text } = await registered();
    expect(failure?.recorded).toBeUndefined();
    expect(text).toContain(
      "Recorded at an unknown time and load: the result that produced it is no longer identifiable in the store",
    );
    expect(text).not.toContain("just now");
  });

  it("an inherited failure keeps its source's facts", async () => {
    apply(at(result(A, "fail", { worktreeId: OTHER }), 400, "run-b"));
    const { failure } = await registered();
    expect(store.knownStates.get(WT, A)?.origin?.kind).toBe("inherited");
    expect(failure?.recorded).toMatchObject({ worktreeId: OTHER, recordedAt: 400 });
  });
});
