import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  Delta,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TestFileRef,
  TransitionEntry,
} from "../../src/core/types/index.js";
import { check, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Spec 004 D8: a slow failure's provenance line reads "slow tier, Squeal's
 * run saw it at revision N, against <declared artifact> as of revision N"
 * instead of 001 D6's line about the session's changes.
 */

const SLOW: TestFileRef = { project: "", path: "src/a.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a", SLOW);

const failure: TransitionEntry = {
  check: A,
  kind: "pass-to-fail",
  from: "pass",
  to: "fail",
  validity: "current",
  observedAt: 9,
  origin: { kind: "own" },
  summary: "expected 1 to be 2",
  location: null,
};

function delta(entries: TransitionEntry[]): Delta {
  return {
    schemaVersion: 1,
    consumer: C1,
    header: {
      revision: 9,
      counts: { current: 1, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
    },
    label: "transitions",
    entries,
  };
}

/** The lines under the first block's head. */
const lines = (d: Delta) => formatDelta(d).split("\n\n")[1]?.split("\n").slice(1) ?? [];

describe("a slow failure's provenance line (spec 004 D8)", () => {
  it("names the slow tier's run and the artifact as of its revision, never the session's changes", () => {
    const slow = { ...failure, slowArtifact: ["plugins/**"], changesInClosure: ["src/x.ts"] };
    expect(lines(delta([slow]))).toEqual([
      "      PASS -> FAIL, slow tier, Squeal's run saw it at revision 9, against plugins/** as of revision 9",
      "      expected 1 to be 2",
    ]);
  });

  it("says when no artifact is declared, and when its re-run is pending", () => {
    const slow = { ...failure, slowArtifact: [], validity: "pending" as const, observedAt: 7 };
    expect(lines(delta([slow]))[0]).toBe(
      "      PASS -> FAIL, slow tier, Squeal's run saw it at revision 7, against no declared artifact, revision 9 pending",
    );
  });

  it("names the worktree an inherited slow failure came from", () => {
    const slow = {
      ...failure,
      slowArtifact: ["plugins/**"],
      origin: { kind: "inherited" as const, worktreeId: OTHER, commit: "abcdef0123456789" },
      originRoot: "/repo/b",
    };
    expect(lines(delta([slow]))[0]).toBe(
      "      PASS -> FAIL, slow tier, Squeal's run in /repo/b at commit abcdef012345 saw it, inherited at revision 9, against plugins/** as of revision 9",
    );
  });

  it("leaves a fast failure's lines as they were (control)", () => {
    expect(lines(delta([{ ...failure, changesInClosure: [] }]))).toEqual([
      "      PASS -> FAIL, seen by Squeal's run at revision 9",
      "      expected 1 to be 2",
      "      none of the files changed here since this session started are in its imports",
    ]);
  });
});

describe("attribution of a slow failure from the worktree's policy (spec 004 D8)", () => {
  let root: string;
  let store: Store;
  let sink: StateSink;
  let delivery: HarnessDelivery;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "squeal-004-15-"));
    store = freshStore();
    store.worktrees.upsert({
      id: WT,
      root,
      commonDir: join(root, ".git"),
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    liveDaemon(store, WT);
    sink = createStateSink(store);
    delivery = createDelivery(store, { status: fixedStatus() });
    setKey(store, "k1");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function policy(value: object): void {
    writeFileSync(join(root, "squeal.config.json"), JSON.stringify(value));
  }

  function apply(...results: ResultRecord[]): void {
    const revision = store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/x.ts", oldHash: null, newHash: "h" }],
    }).number;
    store.results.putMany(results);
    sink.applyResults(WT, revision, results, { checkpointId: null });
  }

  async function failingText(): Promise<string> {
    apply(result(A, "pass"));
    await delivery.register(C1, { atStart: true });
    apply(result(A, "fail"));
    const d = await delivery.onToolBoundary(C1);
    if (d === null) throw new Error("no delta");
    return formatDelta(d);
  }

  it("carries the declared artifact of a slow file", async () => {
    policy({
      slow: { include: ["src/a.test.ts"] },
      inputs: { "src/*.test.ts": ["plugins/**", "dist/**"] },
    });
    const text = await failingText();
    expect(text).toContain(
      "PASS -> FAIL, slow tier, Squeal's run saw it at revision 1, against dist/**, plugins/** as of revision 1",
    );
    expect(text).not.toContain("changed here since this session started");
  });

  it("leaves a file the policy does not mark slow to the changes line", async () => {
    policy({ slow: { include: ["test/e2e/**"] } });
    expect(await failingText()).toContain("PASS -> FAIL, seen by Squeal's run at revision 1");
  });
});
