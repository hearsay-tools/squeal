import { beforeEach, describe, expect, it } from "vitest";
import { planDelta } from "../../src/core/delivery/delta.js";
import { baselineFindings, recordBaselineFindings } from "../../src/core/state/baseline.js";
import { renormalizeFingerprint } from "../../src/core/state/fingerprint.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  ResultRecord,
  RevisionNumber,
  StateSink,
  Store,
} from "../../src/core/types/index.js";
import { check, freshStore, result, setKey, WT } from "./helpers.js";

/*
 * Task 011-14, review wave 1.12 B3: stored fingerprints stay as their
 * writer's rules made them, and every comparison reads both sides under the
 * current rules. A standing failure an older daemon described, re-run with a
 * fresh port or the identical one, is not delivered as a changed failure,
 * whichever daemon wrote last.
 */

const NONE = { checkpointId: null };
const CONSUMER: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const PORT = (port: number) =>
  `expected 'listen EADDRINUSE: address already in use 127.0.0.1:${port}' to match /port ${port}.*(in use|occupied)/`;
// What the rules before 011-14 stored for `PORT(n)`: the message as it was, located as `result` locates it.
const OLD = (port: number) => `AssertionError: ${PORT(port)} @ src/a.ts:3:5`;

let store: Store;
let sink: StateSink;
const a = check("a");

/** A fail of `a` as an older daemon describes and writes it. */
function oldWrite(port: number, revision: number): ResultRecord {
  return { ...result(a, "fail", { message: PORT(port), revision }), fingerprint: OLD(port) };
}

/** A fail of `a` as the current rules describe it. */
function fresh(port: number, revision: number): ResultRecord {
  return result(a, "fail", { message: PORT(port), revision });
}

function apply(r: ResultRecord) {
  store.results.putMany([r]);
  return sink.applyResults(WT, r.provenance.revision, [r], NONE).map((t) => t.kind);
}

function delta() {
  return planDelta({
    view: store.views.list(CONSUMER),
    states: store.knownStates.list(WT),
    isBaselineFinding: () => false,
    toldAt: 9_000,
    rootOf: () => null,
    revision: 9,
    history: (c) => store.transitions.history(WT, c),
  }).entries.map((e) => e.kind);
}

/** What the consumer records as told: its view takes the fingerprint its daemon wrote. */
function tell(fingerprint: string) {
  store.views.writeMany(CONSUMER, [{ check: a, outcome: "fail", fingerprint, toldAt: 2_000 }]);
}

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store, { now: () => 5_000 });
  setKey(store, "k1");
  // A standing failure the consumer was told, under the previous rules.
  expect(apply(oldWrite(35321, 1))).toEqual(["first-seen-fail"]);
  store.consumers.register(CONSUMER, 1_000);
  tell(OLD(35321));
});

describe("a stored fingerprint of the previous rules", () => {
  it("is the same failure as an identical raw failure: no transition, no delta", () => {
    expect(apply(fresh(35321, 2))).toEqual([]);
    expect(delta()).toEqual([]);
  });

  it("is the same failure as a re-run with a fresh port", () => {
    expect(apply(fresh(34963, 2))).toEqual([]);
    expect(delta()).toEqual([]);
  });

  it("stays as written: no row is rewritten", () => {
    apply(fresh(35321, 2));
    expect(store.transitions.history(WT, a).map((t) => t.toFingerprint)).toEqual([OLD(35321)]);
    expect(store.views.list(CONSUMER)[0]?.fingerprint).toBe(OLD(35321));
  });

  it("keeps a genuinely changed failure a changed failure", () => {
    const changed = result(a, "fail", { message: "expected 1 to be 3", revision: 2 });
    expect(apply(changed)).toEqual(["fail-changed"]);
    expect(delta()).toEqual(["fail-changed"]);
  });
});

describe("an older daemon writing beside the current one (review wave 1.12, B3)", () => {
  it("old writer after the upgrade, then its replacement: no transition, no delta", () => {
    expect(apply(fresh(35321, 2))).toEqual([]);
    // The older daemon is still running: it writes the old form again, and tells its consumer.
    expect(apply(oldWrite(35321, 3))).toEqual([]);
    tell(OLD(35321));
    expect(store.knownStates.get(WT, a)?.fingerprint).toBe(OLD(35321));
    // Its replacement describes the identical raw failure under the current rules.
    expect(apply(fresh(35321, 4))).toEqual([]);
    expect(delta()).toEqual([]);
    expect(apply(fresh(34963, 5))).toEqual([]);
    expect(delta()).toEqual([]);
  });

  it("a consumer told the current form and a state the old writer left: no delta", () => {
    tell(fresh(35321, 2).fingerprint ?? "");
    expect(apply(oldWrite(34963, 2))).toEqual([]);
    expect(delta()).toEqual([]);
  });

  // Review wave 1.12, S1: what 09956c8f's rewrite left for an error name holding ": ".
  it("an error name holding ': ', stored renormalized, is the same failure", () => {
    const named = (revision: number): ResultRecord => {
      const r = result(a, "fail", { message: "boom", revision });
      return {
        ...r,
        errors: r.errors.map((e) => ({ ...e, name: "Error: port 12345" })),
        fingerprint: "Error: port 12345: boom @ src/a.ts:3:5",
      };
    };
    const first = named(2);
    apply({ ...first, fingerprint: renormalizeFingerprint(first.fingerprint ?? "") });
    expect(store.knownStates.get(WT, a)?.fingerprint).toBe(
      "Error: port <port>: boom @ src/a.ts:3:5",
    );
    expect(apply(named(3))).toEqual([]);
  });
});

describe("a baseline finding of the previous rules (review wave 1.12, N1)", () => {
  it("is still a baseline finding when the current rules describe it", () => {
    const b = check("b");
    store.checkpoints.start({
      id: "c0",
      worktreeId: WT,
      revision: 1 as RevisionNumber,
      kind: "baseline",
      testFiles: [],
      startedAt: 1_000,
    });
    recordBaselineFindings(store, WT, "c0", [
      {
        worktreeId: WT,
        check: b,
        kind: "first-seen-fail",
        from: null,
        to: "fail",
        fromFingerprint: null,
        toFingerprint: OLD(35321),
        revision: 1 as RevisionNumber,
        at: 1_000,
      },
    ]);
    const isFinding = baselineFindings(store, WT);
    expect(isFinding(b, fresh(34963, 2).fingerprint)).toBe(true);
    expect(isFinding(b, "AssertionError: expected 1 to be 3 @ src/a.ts:3:5")).toBe(false);
  });
});
