import { describe, expect, it, vi } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { fixedSelection, readVerdict } from "../../src/cli/verdict.js";
import { namedPoll } from "../../src/cli/wait/named.js";
import { namedSnapshot } from "../../src/cli/wait/snapshot.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { addCommandHold } from "../../src/core/scheduler/hold-rows.js";
import { buildSnapshot } from "../../src/core/status/snapshot.js";
import { readNamedFiles } from "../../src/core/status/standing.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { check } from "../status/helpers.js";
import { A, B, C, fail, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-411 (gh-250, option A): a named snapshot's verdict and named files
 * read the rows its whole-worktree snapshot read, not every state again. Its
 * text and JSON are the ones the separate reads gave.
 */

/** Calls of `knownStates.list` for a whole worktree, on every store a status read opens. */
const counter = vi.hoisted(() => ({ whole: 0, patched: new WeakSet<object>() }));

/** `store` with its whole-worktree state reads counted in `counter`. */
function countWhole(store: Store): Store {
  if (counter.patched.has(store)) return store;
  counter.patched.add(store);
  const list = store.knownStates.list;
  store.knownStates.list = (worktreeId, files) => {
    if (files === undefined) counter.whole++;
    return list(worktreeId, files);
  };
  return store;
}

vi.mock("../../src/core/status/open.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/status/open.js")>();
  return {
    ...actual,
    withStatusStore: ((cwd, options, fn) =>
      actual.withStatusStore(cwd, options, (context) =>
        fn({ ...context, store: countWhole(context.store) }),
      )) as typeof actual.withStatusStore,
  };
});

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = (): DaemonSync => ({ current: synced, stop: () => {} });
const OPTIONS = { now: () => NOW, settleMs: 0, sync };
/** The named wait's options: its first decided read is its last (row 011-421). */
const WAIT = { ...OPTIONS, timeoutMs: 5_000, pollMs: 20 };

/** A CI export of A, B and C, each at `key(path)`. */
function bundle(runId: string, key: (path: string) => string): ResultsBundle {
  const commit = runId.repeat(40).slice(0, 40);
  const testFiles = [A, B, C].map((path) => ({
    project: "",
    path,
    key: key(path),
    closure: { paths: [path], complete: true, method: "static imports plus declared inputs" },
    observed: {},
  }));
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit,
      dirty: false,
      createdAt: 1,
      source: { kind: "github", repository: "o/r", runId, ref: null, event: "push", sha: commit },
    },
    environments: [],
    testFiles,
    observedStartup: [],
    results: testFiles.map((f) => ({
      project: "",
      testPath: f.path,
      kind: "test" as const,
      fullName: "holds",
      location: null,
      key: f.key,
      outcome: "pass" as const,
      durationMs: 3,
    })),
  };
}

/** A pending, B current, C failing, and three CI imports of the three. */
function worktree() {
  const { repo, store } = repoWith([A], [B, C]);
  fail(store, repo.mainId, check(C, "holds"));
  const runs: [string, (path: string) => string][] = [
    ["1", (p) => `old-${p}`],
    ["2", (p) => `key-${p}-done`],
    ["3", (p) => `new-${p}`],
  ];
  for (const [run, key] of runs) {
    importResults(store, bundle(run, key), { importId: `i${run}`, fileHash: `h${run}`, now: 5 });
  }
  return { repo, store };
}

describe("a named snapshot reads the worktree's states once (row 011-411)", () => {
  it("gives the text and JSON the separate reads gave", async () => {
    const { repo, store } = worktree();

    const got = await namedSnapshot(repo.main, [A, B, C], OPTIONS);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.result.imports?.length).toBe(3);
    // Before row 011-411: the verdict and the named files read every state again.
    const left = new Set((got.leftForPause ?? []).map(testFileId));
    const held = got.selection.files.filter((f) => !left.has(testFileId(f)));
    const result = buildSnapshot(store, repo.main, NOW);
    const before = {
      ...got,
      verdict: readVerdict(store, repo.mainId, held, fixedSelection(got.selection.paths)),
      files: readNamedFiles(store, repo.mainId, repo.main, got.selection.files, result.daemon, NOW),
      result,
    };
    expect(JSON.stringify({ ...got, waitedMs: 0 })).toBe(
      JSON.stringify({ ...before, waitedMs: 0 }),
    );
    expect(namedText(got, NOW)).toBe(namedText(before, NOW));
    expect(namedText(got, NOW)).toMatch(/fail/);
  });

  it("reads every state of the worktree only for its snapshot (gh-250)", async () => {
    const { repo, store } = worktree();
    countWhole(store);
    counter.whole = 0;
    buildSnapshot(store, repo.main, NOW);
    const snapshotOnly = counter.whole;
    counter.whole = 0;

    await namedSnapshot(repo.main, [A, B, C], OPTIONS);

    // Before row 011-411: two more, the verdict's and the named files'.
    expect(snapshotOnly).toBe(1);
    expect(counter.whole).toBe(snapshotOnly);
  });
});

describe("a named wait's last read reads the worktree's states once (row 011-421)", () => {
  it("gives the text and JSON the separate reads gave", async () => {
    const { repo, store } = worktree();

    const got = await waitForNamed(repo.main, [B, C], WAIT);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("settled");
    expect(got.result.imports?.length).toBe(3);
    // Before row 011-421: the verdict, then the snapshot, then the named files, each reading every state.
    const left = new Set((got.leftForPause ?? []).map(testFileId));
    const held = got.selection.files.filter((f) => !left.has(testFileId(f)));
    const result = buildSnapshot(store, repo.main, NOW);
    const before = {
      ...got,
      verdict: readVerdict(store, repo.mainId, held, fixedSelection(got.selection.paths)),
      files: readNamedFiles(store, repo.mainId, repo.main, got.selection.files, result.daemon, NOW),
      result,
    };
    expect(JSON.stringify({ ...got, waitedMs: 0 })).toBe(
      JSON.stringify({ ...before, waitedMs: 0 }),
    );
    expect(namedText(got, NOW)).toBe(namedText(before, NOW));
    expect(namedText(got, NOW)).toMatch(/fail/);
  });

  it("reads every state of the worktree only for its snapshot (011-411 follow-up)", async () => {
    const { repo, store } = worktree();
    countWhole(store);
    counter.whole = 0;

    const got = await waitForNamed(repo.main, [B, C], WAIT);

    expect(got.outcome).toBe("settled");
    // Before row 011-421: three, the verdict's, the snapshot's and the named files'.
    expect(counter.whole).toBe(1);
  });

  it("names a hold that ends at the deadline as of the deadline's last millisecond (review 0.1.578 B3)", () => {
    const { repo, store } = repoWith([A]);
    const deadline = (NOW + 5_000) as EpochMs;
    addCommandHold(store, repo.mainId, {
      token: "deadline",
      since: (NOW - 1_000) as EpochMs,
      until: deadline,
      command: "sleep 60",
      wrapper: null,
      child: null,
    });
    let now: EpochMs = NOW;
    const poll = namedPoll(repo.main, [A], {
      now: () => now,
      timeoutMs: 5_000,
      pollMs: 20,
      settleMs: 0,
      sync: () => ({
        current: () => ({ state: "synced", revision: 4 as RevisionNumber, incarnation: null }),
        stop: () => {},
      }),
      promote: () => {},
    });
    now = deadline;

    const step = poll.read(
      { store, root: repo.main, commonDir: repo.commonDir },
      true,
      () => 5_000,
    );

    if (step === null || !("end" in step)) throw new Error("the wait did not end");
    const got = step.end;
    // The separate read at the deadline's last millisecond, before row 011-421's shared rows.
    const before = readNamedFiles(
      store,
      repo.mainId,
      repo.main,
      [ref(A)],
      got.result.daemon,
      (deadline - 1) as EpochMs,
    );
    expect(JSON.stringify(before)).toMatch(/"hold"/);
    expect(JSON.stringify(before)).not.toMatch(/"expired"/);
    expect(got.files).toEqual(before);
  });
});
