import { realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { ImportsSeen } from "../../src/core/shared/imports-seen.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { exportResults } from "../../src/core/store/transfer.js";
import { encodeBundle } from "../../src/core/store/transfer-bundle.js";
import { claimRepo, type Side, side } from "../scheduler/claims-fixture.js";
import { publish, readerOf, scratch } from "./reader-kit.js";
import { cloneOf, git } from "./remote.js";

/*
 * Row 018-28 (`research/shared-proof.md` Q2): the reader imports into a
 * running daemon's store after the daemon keyed its files. The observed
 * entries the import adds must key them in the same pass, as a restart's
 * keying would: every exported file is then current from the import, with
 * no restart and no run. Before the fix, a fresh clone had 31 of 1,449 files
 * current at the first start (those without observed entries) and 1,449
 * after a restart.
 */

const COUNT = 3;
const INPUT = "data/input.txt";
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
const SLOW = { timeout: 60_000 } as const;
const NONE = {
  sameKeyKept: 0,
  sameKeyNotAdopted: 0,
  environment: 0,
  closure: 0,
  observed: 0,
  content: 0,
  noKey: 0,
};

/** Each completed file's run read `INPUT` beyond its closure, as a test that opens a fixture does. */
function readsInput(s: Side): void {
  const run = s.runner.run.bind(s.runner);
  s.runner.run = async (files) => {
    const report = await run(files);
    const observed = report.completedFiles.map((testFile) => ({
      testFile,
      paths: [INPUT],
      directories: [],
    }));
    return { ...report, observed };
  };
}

/** The current passing tests of `s` whose origin is an import. */
function imported(s: Side): number {
  return s.store.knownStates
    .list(s.worktreeId)
    .filter((k) => k.check.kind === "test" && k.validity === "current" && k.outcome === "pass")
    .filter((k) => k.origin?.kind === "imported").length;
}

describe("an import into a running daemon (row 018-28)", SLOW, () => {
  it("re-keys the files whose observed entries it added: every exported file current at the first start", async () => {
    const s = scratch();
    // CI: the suite ran there, each file read INPUT; its export is published for its commit.
    const { main: ci } = claimRepo(COUNT, { [INPUT]: "input\n" });
    const a = side(ci, { count: COUNT });
    readsInput(a);
    await a.scheduler.start();
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();
    const commit = git(ci, ["rev-parse", "HEAD"]);
    const { bundle } = exportResults(a.store, a.worktreeId, {
      squealVersion: "0.0.0-test",
      keyFormat: KEY_FORMAT_VERSION,
      commit,
      dirty: false,
      createdAt: 1_762_000_000_000,
      source: { kind: "local" },
    });
    expect(bundle.testFiles.map((f) => f.observed.observed)).toEqual(
      Array.from({ length: COUNT }, () => [INPUT]),
    );
    git(ci, ["remote", "add", "origin", s.remote]);
    git(ci, ["push", "-q", "origin", "main"]);
    await publish(ci, commit, encodeBundle(bundle));

    // A fresh clone: its daemon keys every file before the reader imports.
    const dev = realpathSync(cloneOf(s, "main"));
    const b = side(dev, { count: COUNT, policy: LOOKUP_ONLY });
    // The daemon's retry request, which the reader's callback makes, as `daemon.ts` wires it.
    const seen = new ImportsSeen(b.store);
    const retry = () => {
      seen.take((projects) => b.scheduler.refreshObserved(projects));
      return b.scheduler.requestRetries();
    };
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.passing()).toBe(0);

    const reader = readerOf(dev, { store: b.store, imported: () => void retry() });
    await reader.run();
    expect(reader.commits()).toEqual([commit]);
    expect(reader.notes).toEqual([]);
    await b.scheduler.idle();

    expect(b.runner.runs).toEqual([]);
    expect(imported(b)).toBe(COUNT);
    expect(readStatus(dev)).toMatchObject({
      imports: [
        { testFiles: COUNT, currentFiles: COUNT, currentResults: 2 * COUNT, notCurrent: NONE },
      ],
    });
  });
});
