import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import {
  forgetSlowArtifacts,
  readSlowArtifacts,
  recordSlowArtifacts,
} from "../../src/core/slow/state.js";
import { createStateSink, readHeader, slowTierText } from "../../src/core/state/index.js";
import type {
  Consumer,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { check, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Spec 004 D8, review wave 2 B2: a slow failure names the artifact its own
 * run was declared to test, recorded with the run's key in its worktree
 * (`recordSlowArtifacts`), never the declaration on disk at delivery, and
 * "declared artifact unknown" when no record exists. Headers' current claims
 * read the same records.
 */

const SLOW: TestFileRef = { project: "", path: "test/e2e/a.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a", SLOW);
const MARKED = { slow: { include: ["test/e2e/**"] } };
const declares = (glob: string) => ({ ...MARKED, inputs: { "test/e2e/**": [glob] } });

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-004-23-"));
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
  setKey(store, "k1", { file: SLOW });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function policy(value: object): void {
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(value));
}

function revision(): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/x.ts", oldHash: null, newHash: "h" }],
  }).number;
}

function apply(...results: ResultRecord[]): void {
  const at = revision();
  store.results.putMany(results);
  sink.applyResults(WT, at, results, { checkpointId: null });
}

/** The slow file passes at revision 1, the consumer registers, and it fails at revision 2 under `k1`. */
async function failsAtTwo(from: ResultRecord["provenance"]["worktreeId"] = WT): Promise<void> {
  apply(result(A, "pass", { revision: 1 }));
  await delivery.register(C1, { atStart: true });
  apply(result(A, "fail", { revision: 2, worktreeId: from, commit: "abcdef0123456789" }));
}

/** An edit at revision 3 queues the slow file under `k2`: its failure is pending. */
function queueRerun(): void {
  const at = revision();
  setKey(store, "k2", { file: SLOW, pending: "queued" });
  sink.refresh(WT, at, { checkpointId: null });
}

async function provenanceLine(): Promise<string | undefined> {
  const d = await delivery.onToolBoundary(C1);
  if (d === null) throw new Error("no delta");
  return formatDelta(d)
    .split("\n")
    .find((line) => line.includes("slow tier") || line.includes("seen by"));
}

describe("a slow failure's artifact is its own run's (B2)", () => {
  it("names the run's declaration after the policy changed, its re-run pending", async () => {
    policy(declares("dist-a/**"));
    recordSlowArtifacts(store, WT, new Map([["k1", ["dist-a/**"]]]));
    await failsAtTwo();
    policy(declares("dist-b/**"));
    queueRerun();
    expect(await provenanceLine()).toBe(
      "      PASS -> FAIL, slow tier, Squeal's run saw it at revision 2, against dist-a/** as of revision 2, revision 3 pending",
    );
  });

  it("says the artifact is unknown for a result stored before the records", async () => {
    policy(declares("dist-b/**"));
    await failsAtTwo();
    const line = await provenanceLine();
    expect(line).toBe(
      "      PASS -> FAIL, slow tier, Squeal's run saw it at revision 2, declared artifact unknown",
    );
  });

  it("stays a slow run's failure when the policy no longer marks the file slow", async () => {
    recordSlowArtifacts(store, WT, new Map([["k1", ["dist-a/**"]]]));
    await failsAtTwo();
    policy({});
    expect(await provenanceLine()).toContain(
      "slow tier, Squeal's run saw it at revision 2, against dist-a/**",
    );
  });

  it("reads an inherited result's record at the worktree that ran it", async () => {
    policy(declares("dist-b/**"));
    recordSlowArtifacts(store, OTHER, new Map([["k1", ["dist-a/**"]]]));
    await failsAtTwo(OTHER);
    expect(await provenanceLine()).toBe(
      "      PASS -> FAIL, slow tier, Squeal's run in worktree wt-b at commit abcdef012345 saw it, inherited at revision 2, against dist-a/** as of revision 2",
    );
  });

  it("leaves a failure no slow run stored to the changes line (control)", async () => {
    await failsAtTwo();
    expect(await provenanceLine()).toBe("      PASS -> FAIL, seen by Squeal's run at revision 2");
  });
});

describe("the slow-tier line's current claim reads the runs' records (B2)", () => {
  const line = () => slowTierText(readHeader(store, WT), "squeal");

  it("keeps the run's declaration when the policy changes with no daemon", () => {
    policy(declares("dist-a/**"));
    recordSlowArtifacts(store, WT, new Map([["k1", ["dist-a/**"]]]));
    apply(result(A, "pass", { revision: 1 }));
    policy(declares("dist-b/**"));
    store.worktrees.setDaemon(WT, null);
    expect(line()).toBe(
      "Slow tier: 1 test file; 1 current against dist-a/** as of revision 1. Not covered by Stop's wait.",
    );
  });

  it("says unknown for a current result with no record", () => {
    policy(declares("dist-b/**"));
    apply(result(A, "pass", { revision: 1 }));
    expect(line()).toBe(
      "Slow tier: 1 test file; 1 current at revision 1, declared artifact unknown. Not covered by Stop's wait.",
    );
  });

  it("names no pending file's declaration beside the current ones", () => {
    const pending: TestFileRef = { project: "", path: "test/e2e/b.test.ts" };
    policy({
      ...MARKED,
      inputs: { "test/e2e/a.test.ts": ["dist-a/**"], "test/e2e/b.test.ts": ["dist-b/**"] },
    });
    recordSlowArtifacts(store, WT, new Map([["k1", ["dist-a/**"]]]));
    apply(result(A, "pass", { revision: 1 }));
    setKey(store, "kb", { file: pending, pending: "queued" });
    expect(line()).toBe(
      "Slow tier: 2 test files; 1 current against dist-a/** as of revision 1; 1 pending. Not covered by Stop's wait; `squeal run --slow` runs them now.",
    );
  });
});

describe("the records (spec 004 D8)", () => {
  it("keeps the newest 256 keys, a key recorded again counting as new", () => {
    recordSlowArtifacts(store, WT, new Map([["k0", ["a/**"]]]));
    for (let n = 1; n <= 300; n++) {
      recordSlowArtifacts(store, WT, new Map([[`k${n}`, ["a/**"]]]));
      if (n % 100 === 0) recordSlowArtifacts(store, WT, new Map([["k0", ["b/**"]]]));
    }
    const kept = readSlowArtifacts(store, WT);
    expect(kept.size).toBe(256);
    expect(kept.get("k0")).toEqual(["b/**"]);
    expect(kept.has("k44")).toBe(false);
    expect(kept.has("k300")).toBe(true);
  });

  it("forgets the keys a fast run stored results under", () => {
    recordSlowArtifacts(
      store,
      WT,
      new Map([
        ["k1", ["a/**"]],
        ["k2", []],
      ]),
    );
    forgetSlowArtifacts(store, WT, ["k1", "k9"]);
    expect([...readSlowArtifacts(store, WT)]).toEqual([["k2", []]]);
  });
});
