import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink, describeFailure } from "../../src/core/state/index.js";
import type {
  Consumer,
  Delta,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TransitionEntry,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * 011 C5 as amended (the human, gh-32, task 011-18): a failure first observed
 * by a session says what the shared store holds for the check at the key its
 * file had when the session registered, looked up and never run: none, a
 * fail, or a pass. The closure line stays a fact, kept when the failure's
 * diagnostics name other files.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a");
const BASE = "0123456789abcdef0123456789abcdef01234567";
const NONE = { checkpointId: null };

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  liveDaemon(store, WT);
  store.worktrees.upsert({
    id: OTHER,
    root: "/repo/base",
    commonDir: "/repo/.git",
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.testFiles.put({
    testFile: FILE,
    closure: {
      testFile: FILE,
      paths: ["src/a.test.ts", "src/x.ts"],
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: WT,
  });
  revision(["README.md"], BASE);
  setKey(store, "k-base");
});

function revision(paths: readonly string[], head: string | null = BASE): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}` })),
  }).number;
}

/** The agent edits `src/x.ts` after registering; the file's key moves and the check fails there. */
async function failAfterEdit(failed: ResultRecord = result(A, "fail", { key: "k-edit" })) {
  await delivery.register(C1, { atStart: true });
  const at = revision(["src/x.ts"]);
  setKey(store, "k-edit");
  const stored = { ...failed, provenance: { ...failed.provenance, revision: at } };
  store.results.putMany([stored]);
  sink.applyResults(WT, at, [stored], NONE);
  const delta = await delivery.onToolBoundary(C1);
  const entry = delta?.entries.find((e) => e.to === "fail");
  if (entry === undefined || entry.kind === "fail-retired") throw new Error("no failure delivered");
  return { entry: entry as TransitionEntry, text: formatDelta(delta as Delta) };
}

describe("a first-seen failure's baseline (011-18)", () => {
  it("says it may predate the edits and how to settle it when none is stored", async () => {
    const { entry, text } = await failAfterEdit();
    expect(entry.beforeEdits).toEqual({ outcome: "none", commit: BASE });
    expect(text).toContain(
      `first observed: FAIL; no baseline result, may predate your edits; to settle it, run it in a checkout of ${BASE.slice(0, 12)}: its result is shared with this worktree; seen by Squeal's run at revision 2`,
    );
  });

  it("names the worktree and commit of a failure stored at the registration key", async () => {
    store.results.putMany([result(A, "fail", { key: "k-base", worktreeId: OTHER, commit: BASE })]);
    const { text } = await failAfterEdit();
    expect(text).toContain(
      `first observed: FAIL; it also failed before your edits (/repo/base at commit ${BASE.slice(0, 12)}); seen by Squeal's run at revision 2`,
    );
    expect(text).not.toContain("no baseline result");
  });

  it("reads a pass stored at the registration key as PASS -> FAIL", async () => {
    store.results.putMany([result(A, "pass", { key: "k-base", worktreeId: OTHER })]);
    const { entry, text } = await failAfterEdit();
    expect(entry.beforeEdits).toEqual({ outcome: "pass" });
    expect(text).toContain("PASS -> FAIL, seen by Squeal's run at revision 2");
    expect(text).not.toContain("first observed");
  });

  it("looks a result at the current key up only when it is the registration key", async () => {
    store.results.putMany([result(A, "fail", { key: "k-edit", worktreeId: OTHER })]);
    const { text } = await failAfterEdit();
    expect(text).toContain("no baseline result, may predate your edits");
  });

  it("runs nothing for a baseline: no run, no file queued", async () => {
    await failAfterEdit();
    expect(store.runs.inFlight(WT, 0)).toEqual([]);
    expect(store.runs.inFlight(OTHER, 0)).toEqual([]);
    expect(store.testFileKeys.list(WT).map((r) => r.pending)).toEqual([null]);
    expect(store.testFileKeys.list(OTHER)).toEqual([]);
  });
});

describe("a broad scan test whose diagnostics name other files (011-18, gh-32)", () => {
  const errors = [
    {
      name: "AssertionError",
      message: "server/forge/github-filters.test.ts waits on CI without a bound",
      stack: null,
      location: { path: "server/forge/github-filters.test.ts", line: 12, column: 3 },
      diff: null,
    },
    {
      name: "AssertionError",
      message: "server/forge/github.test.ts waits on CI without a bound",
      stack: null,
      location: { path: "server/forge/github.test.ts", line: 40, column: 7 },
      diff: null,
    },
  ];
  const described = describeFailure(errors, { path: FILE.path, line: 1, column: 1 });
  const scan = (key: string, worktreeId = WT, commit = "c0ffee"): ResultRecord => ({
    ...result(A, "fail", { key, worktreeId, commit }),
    errors,
    location: errors[0]?.location ?? null,
    fingerprint: described.fingerprint,
    summary: described.summary,
  });

  it.each([
    ["no baseline", undefined, "no baseline result, may predate your edits"],
    ["a failing baseline", "fail", "it also failed before your edits (/repo/base at commit"],
    ["a passing baseline", "pass", "PASS -> FAIL, seen by Squeal's run at revision 2"],
  ] as const)("keeps the closure line with %s", async (_name, outcome, said) => {
    if (outcome === "fail") store.results.putMany([scan("k-base", OTHER, BASE)]);
    if (outcome === "pass")
      store.results.putMany([result(A, "pass", { key: "k-base", worktreeId: OTHER })]);
    const { entry, text } = await failAfterEdit(scan("k-edit"));
    expect(entry.changesInClosure).toEqual(["src/x.ts"]);
    expect(text).toContain("server/forge/github-filters.test.ts");
    expect(text).toContain(said);
    expect(text).toContain(
      "its closure reads files changed here since this session started: src/x.ts",
    );
    expect(text).not.toContain("touches files changed here");
  });
});
