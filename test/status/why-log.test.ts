import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordFailureKeys } from "../../src/core/slow/state.js";
import { checkIdentity, recordFailureProducers } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import { result } from "../store/helpers.js";
import { fakeRepo, seedStore, state } from "./helpers.js";
import { at, LOGIN, reportOf, seedLogin } from "./why-seed.js";

const NAME = "src/auth.test.ts > auth > login";

/*
 * Issue 15 (011-04), seeded: `b`'s own FAIL of `auth > login` at key k0 came
 * from its run `run-b1`; main's later failing run `run-a1` at k0 replaced
 * that row. The state sink recorded `run-b1` as the producer at k0.
 */
function seeded() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = seedLogin(repo, store);
  store.testFileKeys.upsertMany([
    {
      worktreeId: b.id,
      testFile: { project: "", path: "src/auth.test.ts" },
      key: "k0",
      revision: 1,
      pending: null,
    },
  ]);
  const own = result(LOGIN, "k0", { outcome: "fail", worktreeId: b.id, runId: "run-b1" });
  store.knownStates.upsertMany([
    state(b.id, LOGIN, {
      outcome: "fail",
      observedAt: 4,
      commit: own.provenance.commit,
      fingerprint: own.fingerprint,
    }),
  ]);
  store.results.putMany([
    result(LOGIN, "k0", {
      outcome: "fail",
      worktreeId: repo.mainId,
      runId: "run-a1",
      recordedAt: at(14),
    }),
  ]);
  const produced = (runId: string, key = "k0") => {
    recordFailureProducers(store, b.id, [
      { ...own, provenance: { ...own.provenance, runId, recordedAt: at(12) } },
    ]);
    recordFailureKeys(store, b.id, new Map([[checkIdentity(LOGIN), key]]));
  };
  const runDir = (id: string) => join(repo.commonDir, "squeal", "runs", id);
  mkdirSync(runDir("run-b1"), { recursive: true });
  writeFileSync(join(runDir("run-b1"), "vitest.log"), "");
  const why = () => reportOf(readWhy(b.root, NAME));
  return { repo, store, b, produced, runDir, why };
}

describe("squeal why: the run log once the result behind the state was replaced", () => {
  it("reads the producer's log through its run record and names the replacing run", () => {
    const { repo, b, produced, runDir, why } = seeded();
    produced("run-b1");

    const report = why();

    expect(report.replacedAtKey).toEqual({
      runId: "run-a1",
      worktreeId: repo.mainId,
      recordedAt: at(14),
      key: "k0",
      logDir: runDir("run-a1"),
    });
    expect(report.runLog).toMatchObject({
      runId: "run-b1",
      worktreeId: b.id,
      path: join(runDir("run-b1"), "vitest.log"),
      state: "present",
      fromProducer: true,
    });
    expect(report.runLogUnavailable).toBeUndefined();
    const text = formatWhy(report);
    expect(text).toContain(
      `  Result at key k0: replaced by run run-a1 in ${repo.main} at ${new Date(at(14)).toISOString()}; the result and errors stored there are that run's, not those behind this state\n    Its log: ${runDir("run-a1")}\n`,
    );
    expect(text).toContain("key k0, replaced the result behind this worktree's known state\n");
    expect(text).toContain(
      `Run run-b1 in ${b.root} (this worktree) produced the known state; its stored result was replaced or pruned`,
    );
  });

  it("says the producer was pruned when its run record is gone", () => {
    const { produced, why } = seeded();
    produced("run-gone");
    const report = why();
    expect(report.runLog).toBeNull();
    expect(report.runLogUnavailable).toBe("producer-pruned");
    expect(formatWhy(report)).toContain(
      "Run log: unknown, the run that produced the known state has no run record left (pruned)",
    );
  });

  it("takes no producer of another worktree, another key, or the replacing run", () => {
    const { produced, why } = seeded();
    // run-a1 is main's, the replacing run; the state is b's own.
    produced("run-a1");
    expect(why()).toMatchObject({ runLog: null, runLogUnavailable: "replaced" });
    // b's run, recorded at a key that is not the state's.
    produced("run-b1", "k9");
    expect(why()).toMatchObject({ runLog: null, runLogUnavailable: "replaced" });
  });

  it("says when no result is stored at the key, and when the worktree has no state", () => {
    const { repo, store, b, why } = seeded();
    store.testFileKeys.upsertMany([
      {
        worktreeId: b.id,
        testFile: { project: "", path: "src/auth.test.ts" },
        key: "k7",
        revision: 1,
        pending: null,
      },
    ]);
    const report = why();
    expect(report).toMatchObject({ runLog: null, runLogUnavailable: "not-stored" });
    expect(report.replacedAtKey).toBeUndefined();
    expect(formatWhy(report)).toContain(
      "Run log: unknown, no result is stored at this worktree's key (pruned)",
    );

    const c = repo.addWorktree("c");
    store.transitions.append([
      {
        worktreeId: c.id,
        check: LOGIN,
        kind: "first-seen-fail",
        from: null,
        to: "fail",
        fromFingerprint: null,
        toFingerprint: null,
        revision: 1,
        at: at(9),
      },
    ]);
    expect(reportOf(readWhy(c.root, NAME))).toMatchObject({
      knownState: null,
      runLog: null,
      runLogUnavailable: "no-state",
    });
  });
});
