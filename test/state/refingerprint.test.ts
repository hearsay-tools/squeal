import { beforeEach, describe, expect, it } from "vitest";
import { planDelta } from "../../src/core/delivery/delta.js";
import { FINGERPRINT_RULES, renormalizeFingerprint } from "../../src/core/state/fingerprint.js";
import { createStateSink } from "../../src/core/state/index.js";
import { META_FINGERPRINT_RULES, rewriteFingerprints } from "../../src/core/store/index.js";
import type { Consumer, ResultRecord, StateSink, Store } from "../../src/core/types/index.js";
import { check, freshStore, result, setKey, WT } from "./helpers.js";

/*
 * Task 011-14: a daemon's first start under new fingerprint rules rewrites
 * the fingerprints the previous rules stored, so a standing failure re-run
 * with a fresh port or temp path is not delivered as a changed failure.
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

/** A fail of `a` as the previous rules described it. */
function stored(port: number): ResultRecord {
  return { ...result(a, "fail", { message: PORT(port) }), fingerprint: OLD(port) };
}

const rewrite = () => rewriteFingerprints(store, FINGERPRINT_RULES, renormalizeFingerprint);

function delta() {
  return planDelta({
    view: store.views.list(CONSUMER),
    states: store.knownStates.list(WT),
    isBaselineFinding: () => false,
    toldAt: 9_000,
    rootOf: () => null,
    revision: 3,
    history: (c) => store.transitions.history(WT, c),
  });
}

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store, { now: () => 5_000 });
  setKey(store, "k1");
  // A standing failure the consumer was told, under the previous rules.
  store.results.putMany([stored(35321)]);
  sink.applyResults(WT, 1, [stored(35321)], NONE);
  store.consumers.register(CONSUMER, 1_000);
  store.views.writeMany(CONSUMER, [
    { check: a, outcome: "fail", fingerprint: OLD(35321), toldAt: 2_000 },
  ]);
});

describe("rewriteFingerprints at a daemon's start", () => {
  it("leaves a re-run with a fresh port quiet: no transition, no delta entry", () => {
    expect(rewrite()).toBeGreaterThan(0);
    const fresh = result(a, "fail", { message: PORT(34963), revision: 2 });
    expect(sink.applyResults(WT, 2, [fresh], NONE)).toEqual([]);
    expect(delta().entries).toEqual([]);
    expect(store.results.latestForCheck(a)?.fingerprint).toBe(fresh.fingerprint);
    expect(store.transitions.history(WT, a).at(-1)?.toFingerprint).toBe(fresh.fingerprint);
  });

  it("is what keeps it quiet: without it the re-run is a changed failure", () => {
    const fresh = result(a, "fail", { message: PORT(34963), revision: 2 });
    expect(sink.applyResults(WT, 2, [fresh], NONE).map((t) => t.kind)).toEqual(["fail-changed"]);
  });

  it("runs once per rules version: a second start rewrites nothing", () => {
    expect(rewrite()).toBeGreaterThan(0);
    expect(store.meta.get(META_FINGERPRINT_RULES)).toBe(String(FINGERPRINT_RULES));
    const after = store.knownStates.get(WT, a)?.fingerprint;
    expect(rewrite()).toBe(0);
    // Forced again, the rules map their own output to itself.
    store.meta.delete(META_FINGERPRINT_RULES);
    expect(rewrite()).toBe(0);
    expect(store.knownStates.get(WT, a)?.fingerprint).toBe(after);
  });

  it("keeps a genuinely changed failure a changed failure", () => {
    rewrite();
    const changed = result(a, "fail", { message: "expected 1 to be 3", revision: 2 });
    expect(sink.applyResults(WT, 2, [changed], NONE).map((t) => t.kind)).toEqual(["fail-changed"]);
    expect(delta().entries.map((e) => e.kind)).toEqual(["fail-changed"]);
  });
});
