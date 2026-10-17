import { beforeEach, describe, expect, it } from "vitest";
import { createStateSink, publishSlowSkips } from "../../src/core/state/index.js";
import type { StateSink, Store, TestFileRef } from "../../src/core/types/index.js";
import { check, FILE, freshStore, result, setKey, WT } from "./helpers.js";

/*
 * Spec 004 D8, review wave-8.1 B1 (re-review): a check of a slow file the
 * store keeps skipped never reads current, whatever its key stored; the
 * result stays as history, and the check is current again once the skip
 * ends.
 */

const NONE = { checkpointId: null };
const SIBLING: TestFileRef = { project: "", path: "src/b.test.ts" };

let store: Store;
let sink: StateSink;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store, { now: () => 5_000 });
  setKey(store, "k1");
  setKey(store, "k2", { file: SIBLING });
});

function skip(...testFiles: TestFileRef[]) {
  publishSlowSkips(
    store,
    WT,
    testFiles.length === 0
      ? []
      : [
          {
            precondition: { exists: ["ready"] },
            source: "slow.precondition",
            reason: "r",
            since: 1,
            testFiles,
          },
        ],
  );
}

describe("a skipped slow file's checks", () => {
  it("read stale at their key, pending once queued, current again when the skip ends", () => {
    const [a, b] = [check("a"), check("b", SIBLING)];
    const results = [result(a, "fail"), result(b, "pass", { key: "k2" })];
    store.results.putMany(results);
    sink.applyResults(WT, 1, results, NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({ validity: "current" });

    skip(FILE);
    expect(sink.refresh(WT, 2, NONE)).toEqual([]);
    expect(store.knownStates.get(WT, a)).toMatchObject({ outcome: "fail", validity: "stale" });
    expect(store.knownStates.get(WT, b)).toMatchObject({ validity: "current" });

    setKey(store, "k1", { pending: "queued" });
    sink.refresh(WT, 2, NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({
      validity: "pending",
      pendingPhase: "queued",
    });

    setKey(store, "k1");
    skip();
    sink.refresh(WT, 3, NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({ outcome: "fail", validity: "current" });
  });

  it("read stale from a result applied while the skip holds", () => {
    const a = check("a");
    skip(FILE);
    sink.applyResults(WT, 1, [result(a, "pass")], NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({ outcome: "pass", validity: "stale" });
  });
});
