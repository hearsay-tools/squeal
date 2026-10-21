import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { createStateSink, describeFailure } from "../../src/core/state/index.js";
import { formatStatus, formatWhy, readStatus, readWhy } from "../../src/core/status/index.js";
import type {
  CheckError,
  Consumer,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TestFileRef,
  WhyReport,
} from "../../src/core/types/index.js";
import { check, setKey } from "../state/helpers.js";
import { type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 011-76 (011-64 R2, gh-67), tests 1 and 3: a failure a helper threw
 * names the first frame in its own test file wherever it prints its
 * location, read from the stored row behind it; `location` and the
 * fingerprint stay as they are.
 */

const AUTOSAVE: TestFileRef = { project: "", path: "test/harness-autosave.test.ts" };
const SAVES = check("saves after idle", AUTOSAVE);
const HELPER = { path: "test/harness-parity.testkit.ts", line: 823, column: 40 };
const FRAME = { path: "test/harness-autosave.test.ts", line: 84, column: 15 };
const STACK = [
  "AssertionError: expected 'idle' to be 'saved'",
  "    at assertSaved (test/harness-parity.testkit.ts:823:40)",
  "    at test/harness-autosave.test.ts:84:15",
  "    at file:///w/node_modules/@vitest/runner/dist/index.js:155:11",
].join("\n");
const AT =
  "at test/harness-parity.testkit.ts:823:40, called from test/harness-autosave.test.ts:84:15";
const NONE = { checkpointId: null };

let repo: FakeRepo;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let wt: string;
let told: Consumer;

beforeEach(async () => {
  repo = fakeRepo();
  store = seedStore(repo);
  wt = repo.mainId;
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, wt);
  setKey(store, "k1", { file: AUTOSAVE, worktreeId: wt });
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  told = { worktreeId: wt, sessionId: "s1", agentId: "main" };
  apply(row("pass"));
  await delivery.register(told, { atStart: true });
});

function edit(): number {
  return store.revisions.append({
    worktreeId: wt,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/x.ts", oldHash: null, newHash: `h${Math.random()}` }],
  }).number;
}

function row(
  outcome: "pass" | "fail",
  { stack = STACK, worktreeId = wt, runId = "run-1", revision = 1 } = {},
): ResultRecord {
  const errors: CheckError[] =
    outcome === "fail"
      ? [
          {
            name: "AssertionError",
            message: "expected 'idle' to be 'saved'",
            stack,
            location: HELPER,
            diff: null,
          },
        ]
      : [];
  const location = { path: AUTOSAVE.path, line: 80, column: 3 };
  const described = outcome === "fail" ? describeFailure(errors, location) : null;
  return {
    check: SAVES,
    key: "k1",
    outcome,
    durationMs: 5,
    location,
    fingerprint: described?.fingerprint ?? null,
    summary: described?.summary ?? null,
    errors,
    provenance: { worktreeId, revision, commit: "c0ffee", dirty: false, runId, recordedAt: 1_000 },
  };
}

/** Stores `result` and applies it to this worktree at a new revision. */
function apply(result: ResultRecord): void {
  const revision = edit();
  const stored = { ...result, provenance: { ...result.provenance, revision } };
  store.results.putMany([stored]);
  sink.applyResults(wt, revision, [stored], NONE);
}

function why(): WhyReport {
  const report = readWhy(repo.main, "test/harness-autosave.test.ts > saves after idle");
  if (!report.available || !report.found) throw new Error("no why report");
  return report;
}

describe("the test-file frame beside a helper's location (011-76 test 1)", () => {
  it("is named by the change notice, the registration, status and why", async () => {
    apply(row("fail"));

    const delta = await delivery.onToolBoundary(told);
    const entry = delta?.entries.find((e) => e.kind !== "fail-retired" && e.to === "fail");
    expect(entry && "testFileFrame" in entry ? entry.testFileFrame : null).toEqual(FRAME);
    expect(formatDelta(delta ?? never())).toContain(`\n      ${AT}\n`);

    const registration = await delivery.register({ ...told, sessionId: "s2" });
    expect(registration.knownFailures[0]?.testFileFrame).toEqual(FRAME);
    expect(formatRegistration(registration)).toContain(`\n      ${AT}\n`);

    const status = readStatus(repo.main);
    expect(status.available && status.knownFailures[0]?.testFileFrame).toEqual(FRAME);
    expect(formatStatus(status, Date.now())).toContain(`\n        ${AT}, observed at revision`);

    const report = why();
    expect(report.testFileFrame).toEqual(FRAME);
    expect(formatWhy(report)).toContain(`\n  Location: ${AT.slice("at ".length)}\n`);
  });

  it("leaves `location` and the fingerprint as they were", async () => {
    apply(row("fail"));
    const state = store.knownStates.get(wt, SAVES);
    expect(state?.location).toEqual(HELPER);
    expect(state?.fingerprint).toBe(
      "AssertionError: expected 'idle' to be 'saved' @ test/harness-parity.testkit.ts:823:40",
    );
    expect(store.results.byKey("k1")[0]?.errors[0]?.location).toEqual(HELPER);
  });
});

describe("no frame without a stored row behind the failure (011-76 test 3)", () => {
  it("names none once another run's pass replaced the row at its key", async () => {
    apply(row("fail"));
    store.results.putMany([row("pass", { worktreeId: "wt-other", runId: "run-2" })]);

    const delta = await delivery.onToolBoundary(told);
    const entry = delta?.entries.find((e) => e.kind !== "fail-retired" && e.to === "fail");
    expect(entry).toBeDefined();
    expect(entry && "testFileFrame" in entry).toBe(false);
    expect(formatDelta(delta ?? never())).toContain(
      "\n      at test/harness-parity.testkit.ts:823:40\n",
    );

    const registration = await delivery.register({ ...told, sessionId: "s2" });
    expect(registration.knownFailures[0]?.testFileFrame).toBeUndefined();
    const status = readStatus(repo.main);
    expect(status.available && status.knownFailures[0]?.testFileFrame).toBeUndefined();
    expect(why().testFileFrame).toBeUndefined();
    expect(formatWhy(why())).toContain("\n  Location: test/harness-parity.testkit.ts:823:40\n");
  });

  it("names none when the stack holds no frame in the test file", async () => {
    apply(row("fail", { stack: "Error: boom\n    at test/harness-parity.testkit.ts:823:40" }));
    const delta = await delivery.onToolBoundary(told);
    const entry = delta?.entries.find((e) => e.kind !== "fail-retired" && e.to === "fail");
    expect(entry && "testFileFrame" in entry).toBe(false);
    expect(why().testFileFrame).toBeUndefined();
  });
});

function never(): never {
  throw new Error("no delta");
}
