import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { type FileDecision, keeps } from "../../src/core/run-evidence/run-evidence.js";
import type { StoreDecision } from "../../src/core/scheduler/store-decision.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { A, B, type During, decide } from "./fixture.js";

/*
 * Row 011-319 (`specifications/011-core/research/run-evidence.md`): one
 * table at the run evidence module's interface. In: the input state before
 * the run, what happened during it, and its report. Out: `a`'s store
 * decision and its reason, and `b`'s beside it. The daemon's column runs
 * the daemon's record: `unstableInputs`, `readRecordEvidence`, then
 * `recordOutcome` (the report and requeue `TierRecords.#write` hands
 * `recordTier`), then `runEnd` and `storeDecision` per file as `recordTier`
 * and `recordFile` do. The keeper's column runs `keepDecisions`, and `squeal
 * code` keeps a file only on "store at the key it ran under". A merge hold
 * or a touched input is a reason beside the decision, not a decision. Rows
 * marked "difference N" are the research's differences between the two
 * callers. Row 011-320 gave the keeper the sources of differences 2 to 4
 * and of a file added to or removed from a listed directory (proposed row
 * `keep-listing-revision`): its column equals the daemon's there, but where
 * no revision of the file exists, which the daemon's record reads and
 * `squeal code` does not: the keeper, reading the disk, is stricter.
 */

/** A decision as a row names it: its kind, and where it stores. */
type Named = StoreDecision["kind"] | "store at ran" | "store at grown";

interface Row {
  readonly during: During;
  readonly daemon: Named;
  /** `null`: the row is a fact of the daemon's alone (its ledger, its record's retry). */
  readonly keeper: Named | null;
  /** What the daemon's reason names. */
  readonly names?: string;
  /** What the keeper's reason names. */
  readonly keeperNames?: string;
  /** `b`'s decision in both columns, which nothing of `a`'s evidence moves; default "store at ran". */
  readonly beside?: Named;
}

const only = (files: RunReport["completedFiles"]) => (report: RunReport) => ({
  ...report,
  completedFiles: files,
});

const TABLE: Readonly<Record<string, Row>> = {
  "nothing moved": { during: {}, daemon: "store at ran", keeper: "store at ran" },
  "an input changed": {
    during: { write: { "src/a.ts": "export const a = 3;\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/a.ts",
    keeperNames: "src/a.ts",
  },
  "an input was touched, the first time at its key": {
    during: { touch: ["src/a.ts"] },
    daemon: "requeue",
    keeper: "unknown",
    names: "src/a.ts was written",
    keeperNames: "src/a.ts was written",
  },
  "an input was touched, its run before at its key withheld too": {
    during: { touch: ["src/a.ts"], withheldBefore: true },
    daemon: "unknown",
    keeper: "unknown",
    names: "src/a.ts was written",
    keeperNames: "src/a.ts was written",
  },
  "difference 1: it read a path its key lacks, known before the run": {
    during: { read: ["data/known.txt"] },
    daemon: "store at grown",
    keeper: "store at grown",
    names: "data/known.txt",
    keeperNames: "data/known.txt",
  },
  "difference 1: a path it read beyond its key changed": {
    during: { read: ["data/known.txt"], write: { "data/known.txt": "other\n" } },
    daemon: "unstable",
    keeper: "store at grown",
    names: "data/known.txt changed",
  },
  "difference 1: a path it read beyond its key was touched": {
    during: { read: ["data/known.txt"], touch: ["data/known.txt"] },
    daemon: "requeue",
    keeper: "store at grown",
    names: "data/known.txt was written",
  },
  "it read a path its key names": {
    during: { keyed: ["data/known.txt"], read: ["data/known.txt"] },
    daemon: "store at ran",
    keeper: "store at ran",
  },
  "it read a path first seen during the run": {
    during: { create: { "data/new.txt": "new\n" }, read: ["data/new.txt"] },
    daemon: "first-seen",
    keeper: "first-seen",
    names: "data/new.txt",
    keeperNames: "data/new.txt",
  },
  "it loaded only environment files its key names": {
    during: { loaded: ["setup.ts"] },
    daemon: "store at ran",
    keeper: "store at ran",
  },
  "it loaded an environment file its key lacks": {
    during: { loaded: ["setup.ts", "other-setup.ts"] },
    daemon: "environment",
    keeper: "environment",
    names: "environment files",
    keeperNames: "environment files",
    beside: "environment",
  },
  "difference 2: the runtime's identity moved": {
    during: { runtimeMoved: true },
    daemon: "environment",
    keeper: "environment",
    names: "runtime's identity",
    keeperNames: "runtime's identity",
  },
  "difference 2: the policy's runtime files moved during the run": {
    during: {
      policy: {
        runtimeFiles: [{ project: "", tests: ["test/a.test.ts"], paths: ["runtime.txt"] }],
      },
    },
    daemon: "environment",
    keeper: "environment",
    names: "runtime's identity",
    keeperNames: "runtime's identity",
  },
  "difference 3: a merge holds an input": {
    during: { merging: ["src/a.ts"] },
    daemon: "requeue",
    keeper: "requeue",
    names: "merge holds",
    keeperNames: "merge holds",
  },
  "difference 4: an editor's scratch file moved a listed directory": {
    during: { batch: { "src/.a.ts.swp": "swap\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/",
    keeperNames: "src/",
  },
  "difference 4, no revision of it: no daemon serves, or the record came before its batch": {
    during: { create: { "src/.a.ts.swp": "swap\n" } },
    daemon: "store at ran",
    keeper: "unstable",
    keeperNames: "src/",
  },
  "difference 4: an editor's scratch file left a listed directory": {
    during: { untracked: { "src/.a.ts.swp": "swap\n" }, batch: { "src/.a.ts.swp": null } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/",
    keeperNames: "src/",
  },
  "difference 4: an editor's scratch file moved a directory below a listed one": {
    during: { batch: { "src/sub/.c.ts.swp": "swap\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/",
    keeperNames: "src/",
  },
  "an editor's scratch file that was there before and stayed": {
    during: { untracked: { "src/.a.ts.swp": "swap\n" }, batch: { "src/.a.ts.swp": "swap 2\n" } },
    daemon: "store at ran",
    keeper: "store at ran",
  },
  "a file added to a listed directory, a revision of it": {
    during: { batch: { "src/c.ts": "export const c = 3;\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/ changed",
    keeperNames: "src/ changed",
  },
  "a file added to a listed directory, no revision of it: no daemon serves, or the record came before its batch":
    {
      during: { create: { "src/c.ts": "export const c = 3;\n" } },
      daemon: "store at ran",
      keeper: "unstable",
      keeperNames: "src/ changed",
    },
  "a file added to a listed directory and removed again, a revision of each": {
    during: { batch: { "src/new.ts": "export const n = 1;\n" }, then: { "src/new.ts": null } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/ changed",
    keeperNames: "src/ changed",
  },
  "an editor's scratch file added and removed again, a revision of each": {
    during: { batch: { "src/.a.ts.swp": "swap\n" }, then: { "src/.a.ts.swp": null } },
    daemon: "store at ran",
    keeper: "store at ran",
  },
  "a file removed from a listed directory": {
    during: { batch: { "src/d.ts": null } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/ changed",
    keeperNames: "src/ changed",
  },
  "a file added below a listed directory": {
    during: { batch: { "src/sub/e.ts": "export const e = 5;\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/",
    keeperNames: "src/",
  },
  "a symlinked directory below a listed one, nothing moved": {
    during: { links: { "src/linked": "../lib" } },
    daemon: "store at ran",
    keeper: "store at ran",
  },
  "a file added through a symlinked directory below a listed one": {
    during: { links: { "src/linked": "../lib" }, batch: { "src/linked/new.ts": "export {};\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/",
    keeperNames: "src/",
  },
  "a file added through a symlinked directory below a listed one, no revision of it": {
    during: { links: { "src/linked": "../lib" }, create: { "src/linked/new.ts": "export {};\n" } },
    daemon: "store at ran",
    keeper: "unstable",
    keeperNames: "src/",
  },
  "an editor's scratch file added through a symlinked directory below a listed one": {
    during: { links: { "src/linked": "../lib" }, batch: { "src/linked/.x.ts.swp": "swap\n" } },
    daemon: "unstable",
    keeper: "unstable",
    names: "src/",
    keeperNames: "src/",
  },
  "an editor's scratch file added through a symlinked directory, no revision of it": {
    during: { links: { "src/linked": "../lib" }, create: { "src/linked/.x.ts.swp": "swap\n" } },
    daemon: "store at ran",
    keeper: "unstable",
    keeperNames: "src/",
  },
  "an ignored file added to a listed directory, which the watcher drops": {
    during: { create: { "src/run.log": "log\n" } },
    daemon: "store at ran",
    keeper: "store at ran",
  },
  "the run did not complete it": {
    during: { report: only([B]) },
    daemon: "unknown",
    keeper: "unknown",
  },
  "the run timed out before it ended": {
    during: { report: (r) => ({ ...only([B])(r), end: "timed-out" }) },
    daemon: "split",
    keeper: "split",
    names: "at most 1",
    keeperNames: "at most 1",
  },
  "the global setup failed": {
    during: {
      report: (r) => ({
        ...only([])(r),
        startupFailure: {
          projects: [""],
          testFiles: [A, B],
          setupFile: "setup.ts",
          error: { name: "Error", message: "no db", stack: null, location: null, diff: null },
        },
      }),
    },
    daemon: "not-started",
    keeper: "not-started",
    beside: "not-started",
  },
  "the runner withheld it": {
    during: { report: (r) => ({ ...only([B])(r), withheld: [A] }) },
    daemon: "withheld",
    keeper: "withheld",
  },
  "a stop's or a hold's cancel cut it short": {
    during: { queued: "unfinished", report: only([B]) },
    daemon: "requeue",
    keeper: null,
  },
  "a crash after the stop interrupted it": {
    during: { queued: "interrupted", report: (r) => ({ ...only([B])(r), end: "crashed" }) },
    daemon: "requeue",
    keeper: null,
  },
  "a startup failure the merge hold rejects kept it from starting": {
    during: {
      queued: "not started",
      report: (r) => ({
        ...only([B])(r),
        startupFailure: {
          projects: [""],
          testFiles: [A],
          setupFile: "setup.ts",
          error: { name: "Error", message: "held", stack: null, location: null, diff: null },
        },
      }),
    },
    daemon: "requeue",
    keeper: null,
  },
  "the install moved during the run": {
    during: { queued: "install moved" },
    daemon: "requeue",
    keeper: null,
    beside: "requeue",
  },
  "a backlog cancel cut it short": {
    during: { ledger: "cancelled", report: only([B]) },
    daemon: "requeue",
    keeper: null,
  },
  "a newer run has it at another key": {
    during: { ledger: "superseded" },
    daemon: "superseded",
    keeper: null,
  },
  "the ledger no longer holds it": { during: { ledger: "gone" }, daemon: "gone", keeper: null },
  "an edit moved its key and it read beyond it": {
    during: { ledger: "rekeyed", read: ["data/known.txt"] },
    daemon: "no-key",
    keeper: null,
  },
};

function named(decision: StoreDecision): Named {
  return decision.kind === "store" ? `store at ${decision.at}` : decision.kind;
}

describe("run evidence: the store decision per file, the daemon's record and squeal code's", () => {
  it.each(Object.entries(TABLE))("%s", { timeout: 60_000 }, async (_, row) => {
    const decided = await decide(row.during);
    const of = (decisions: ReadonlyMap<string, FileDecision>, ref: typeof A) =>
      decisions.get(testFileId(ref)) as FileDecision;
    const daemon = of(decided.daemon, A);
    const keeper = decided.keeper === null ? null : of(decided.keeper, A);

    expect([named(daemon.decision), keeper === null ? null : named(keeper.decision)]).toEqual([
      row.daemon,
      row.keeper,
    ]);
    const besides = [decided.daemon, ...(decided.keeper === null ? [] : [decided.keeper])];
    expect(besides.map((decisions) => named(of(decisions, B).decision))).toEqual(
      besides.map(() => row.beside ?? "store at ran"),
    );
    expect(keeper === null ? null : keeps(keeper.decision)).toBe(
      row.keeper === null ? null : row.keeper === "store at ran",
    );
    if (row.names !== undefined) expect(daemon.reason).toContain(row.names);
    if (row.keeperNames !== undefined) expect(keeper?.reason).toContain(row.keeperNames);
  });
});
