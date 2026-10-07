import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { registeredMetaKey } from "../../src/core/delivery/registered.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  CheckError,
  Consumer,
  Delta,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TransitionEntry,
} from "../../src/core/types/index.js";
import { withLoad } from "../../src/runners/vitest/results.js";
import { check, FILE, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Task 001-91, lessons defect 16: delivery reads, from the store, whether a
 * failure's closure holds a file changed since its consumer registered, the
 * load a timeout ran under, whether any dependencies are installed, and what
 * still fails.
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
});

/** A revision changing `paths`; returns its number. */
function edit(paths: readonly string[]): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}` })),
  }).number;
}

function closure(paths: readonly string[]): void {
  store.testFiles.put({
    testFile: FILE,
    closure: {
      testFile: FILE,
      paths,
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: WT,
  });
}

function apply(revision: number, ...results: ResultRecord[]): void {
  store.results.putMany(results);
  sink.applyResults(WT, revision, results, NONE);
}

const hashed = (...paths: string[]) =>
  store.fileHashes.upsertMany(
    WT,
    paths.map((path) => ({ path, mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1, hash: "h" })),
  );

async function failingEntry(): Promise<TransitionEntry> {
  const delta = await delivery.onToolBoundary(C1);
  const entry = delta?.entries.find((e) => e.to === "fail");
  if (entry === undefined || entry.kind === "fail-retired") throw new Error("no failure delivered");
  return entry;
}

describe("whether the changes since registration reach a failure", () => {
  beforeEach(async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
  });

  it("names the closure paths changed since registration", async () => {
    closure(["src/a.test.ts", "src/x.ts", "src/y.ts"]);
    edit(["src/x.ts", "README.md"]);
    apply(edit(["src/y.ts"]), result(A, "fail"));
    expect((await failingEntry()).changesInClosure).toEqual(["src/x.ts", "src/y.ts"]);
  });

  it("says none when no changed file is in the closure", async () => {
    closure(["src/a.test.ts", "src/x.ts"]);
    apply(edit(["README.md"]), result(A, "fail"));
    const entry = await failingEntry();
    expect(entry.changesInClosure).toEqual([]);
  });

  it("leaves out changes made before registration", async () => {
    closure(["src/a.test.ts"]);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failingEntry()).changesInClosure).toEqual([]);
  });

  it("reads an inherited failure against this worktree's changes", async () => {
    closure(["src/a.test.ts", "src/x.ts"]);
    const inherited = result(A, "fail", { worktreeId: OTHER, key: "k2", commit: "abc" });
    setKey(store, "k2");
    apply(edit(["src/x.ts"]), inherited);
    const entry = await failingEntry();
    expect(entry.origin.kind).toBe("inherited");
    expect(entry.changesInClosure).toEqual(["src/x.ts"]);
  });

  it("says nothing when the closure was never collected", async () => {
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failingEntry()).changesInClosure).toBeUndefined();
  });

  it("says nothing for a consumer registered before the registration revision was recorded", async () => {
    closure(["src/a.test.ts", "src/x.ts"]);
    store.meta.set(registeredMetaKey(WT), "{}");
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failingEntry()).changesInClosure).toBeUndefined();
  });
});

describe("a timeout's load average", () => {
  const timeout = (load?: number): ResultRecord => {
    const base = result(A, "fail", { message: "Test timed out in 5000ms." });
    const errors: CheckError[] = base.errors.map((e) =>
      load === undefined ? e : { ...e, loadAverage: load },
    );
    return { ...base, errors };
  };

  beforeEach(async () => {
    apply(edit([]), result(A, "pass"));
    await delivery.register(C1);
  });

  it("is read from the result the failure came from", async () => {
    apply(edit([]), timeout(7.25));
    const entry = await failingEntry();
    expect(entry.loadAverage).toBe(7.25);
    expect(formatDelta(deltaOf(entry))).toContain("load average 7.25 when it ran");
  });

  it("is absent from a failure text stored before it was recorded", async () => {
    apply(edit([]), timeout());
    const stored = store.results.latestForCheck(A);
    expect(stored?.errors[0]).toEqual({
      name: "AssertionError",
      message: "Test timed out in 5000ms.",
      stack: null,
      location: { path: "src/a.ts", line: 3, column: 5 },
      diff: null,
    });
    expect((await failingEntry()).loadAverage).toBeUndefined();
  });

  it("is recorded by the runner on a timed-out test or hook only", () => {
    const error: CheckError = {
      name: "Error",
      message: "Test timed out in 5000ms.\nIf this is a long-running test, pass a timeout value",
      stack: null,
      location: null,
      diff: null,
    };
    expect(withLoad(error, () => 3.5).loadAverage).toBe(3.5);
    expect(withLoad({ ...error, message: "Hook timed out in 10000ms." }, () => 2).loadAverage).toBe(
      2,
    );
    expect(withLoad({ ...error, message: "expected 1 to be 2" }, () => 3.5)).not.toHaveProperty(
      "loadAverage",
    );
    expect(withLoad(error, () => null)).not.toHaveProperty("loadAverage");
  });
});

/** A delta of one entry, for formatting an entry already delivered. */
function deltaOf(entry: TransitionEntry): Delta {
  return {
    schemaVersion: 1,
    consumer: C1,
    header: {
      revision: 1,
      counts: { current: 1, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
    },
    label: "transitions",
    entries: [entry],
  };
}

describe("installed dependencies in the header", () => {
  it("says no dependencies are installed when no hashed file is an installed lockfile", async () => {
    apply(edit([]), result(A, "pass"));
    await delivery.register(C1);
    hashed("src/a.test.ts", "package-lock.json");
    apply(edit([]), result(A, "fail", { message: "Cannot find package 'vitest'" }));
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.header.dependenciesInstalled).toBe(false);
    expect(formatDelta(delta as Delta).match(/No dependencies are installed/g)).toHaveLength(1);
  });

  it("says it in a registration that carries known failures", async () => {
    hashed("src/a.test.ts");
    apply(edit([]), result(A, "fail"));
    expect(formatRegistration(await delivery.register(C1))).toContain(
      "No dependencies are installed in this worktree",
    );
  });

  it("says nothing once a lockfile is installed, or while nothing is hashed", async () => {
    apply(edit([]), result(A, "pass"));
    await delivery.register(C1);
    apply(edit([]), result(A, "fail"));
    expect((await delivery.onToolBoundary(C1))?.header.dependenciesInstalled).toBeUndefined();
    hashed("src/a.test.ts", "node_modules/.package-lock.json");
    apply(edit([]), result(A, "fail", { message: "another" }));
    expect((await delivery.onToolBoundary(C1))?.header.dependenciesInstalled).toBe(true);
  });

  it("labels a report after the installed lockfile changed", async () => {
    apply(edit([]), result(A, "fail"));
    await delivery.register(C1);
    apply(edit(["node_modules/.package-lock.json"]), result(A, "pass"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).toContain(
      "These results follow a dependency install (node_modules/.package-lock.json changed).",
    );
  });
});

/* Review wave 10b S1: `npm ci` deletes node_modules first; a deletion is not an install. */
describe("a removed installed lockfile", () => {
  function remove(path: string): number {
    return store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path, oldHash: "installed", newHash: null }],
    }).number;
  }

  it("is not labelled an install, so the header says one thing (S1 probe)", async () => {
    apply(edit([]), result(A, "pass"));
    await delivery.register(C1);
    hashed("src/a.test.ts", "package-lock.json");
    apply(
      remove("node_modules/.package-lock.json"),
      result(A, "fail", { message: "Cannot find package 'vitest'" }),
    );
    const text = formatDelta((await delivery.onToolBoundary(C1)) as Delta);
    expect(text).toContain("No dependencies are installed in this worktree");
    expect(text).not.toContain("follow a dependency install");
  });

  it("is labelled an install once a later revision in the range writes it again", async () => {
    apply(edit([]), result(A, "fail"));
    await delivery.register(C1);
    hashed("src/a.test.ts", "node_modules/.package-lock.json");
    remove("node_modules/.package-lock.json");
    apply(edit(["node_modules/.package-lock.json"]), result(A, "pass"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).toContain(
      "These results follow a dependency install (node_modules/.package-lock.json changed).",
    );
  });
});

describe("still failing", () => {
  it("lists the checks failing at delivery", async () => {
    const B = check("b");
    apply(edit([]), result(A, "fail"), result(B, "fail"));
    await delivery.register(C1);
    apply(edit([]), result(A, "pass"));
    expect((await delivery.onToolBoundary(C1))?.stillFailing).toEqual([B]);
  });
});
