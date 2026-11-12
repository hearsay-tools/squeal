import { describe, expect, it } from "vitest";
import { keeps, type RunDecision } from "../../src/core/run-evidence/run-evidence.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { A, B, type During, decide } from "./fixture.js";

/*
 * Row 011-319 (`specifications/011-core/research/run-evidence.md`): one
 * table at the run evidence module's interface. In: the input state before
 * the run, what happened during it, and its report. Out: `a`'s store
 * decision and its reason, once with the daemon's sources
 * (`readRecordEvidence`, then `decideFiles` with its ledger as the daemon's
 * record acts on it) and once with `squeal code`'s (`keepDecisions`).
 * `squeal code` keeps a file only on "store at the key it ran under". Rows
 * marked "difference N" are the research's differences between the two
 * callers; the keeper's column of differences 2 to 4 is row 011-320's.
 */

/** A decision as a row names it: its kind, and where it stores. */
type Named = RunDecision["kind"] | "store at ran" | "store at grown";

interface Row {
  readonly during: During;
  readonly daemon: Named;
  /** `null`: `squeal code` has no such source (it has no ledger). */
  readonly keeper: Named | null;
  /** What the reasons name, each the daemon's and, where it decides alike, the keeper's. */
  readonly names?: string;
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
  },
  "an input was touched": {
    during: { touch: ["src/a.ts"] },
    daemon: "touched",
    keeper: "touched",
    names: "src/a.ts",
  },
  "difference 1: it read a path its key lacks, known before the run": {
    during: { read: ["data/known.txt"] },
    daemon: "store at grown",
    keeper: "store at grown",
    names: "data/known.txt",
  },
  "difference 1: a path it read beyond its key changed": {
    during: { read: ["data/known.txt"], write: { "data/known.txt": "other\n" } },
    daemon: "unstable",
    keeper: "store at grown",
    names: "data/known.txt",
  },
  "difference 1: a path it read beyond its key was touched": {
    during: { read: ["data/known.txt"], touch: ["data/known.txt"] },
    daemon: "touched",
    keeper: "store at grown",
    names: "data/known.txt",
  },
  "it read a path first seen during the run": {
    during: { create: { "data/new.txt": "new\n" }, read: ["data/new.txt"] },
    daemon: "first-seen",
    keeper: "first-seen",
    names: "data/new.txt",
  },
  "it loaded an environment file its key lacks": {
    during: { loaded: ["setup.ts"] },
    daemon: "environment",
    keeper: "environment",
    names: "environment files",
  },
  "difference 2: the runtime's identity moved": {
    during: { runtimeMoved: true },
    daemon: "environment",
    keeper: "store at ran",
    names: "runtime's identity",
  },
  "difference 3: a merge holds an input": {
    during: { merging: ["src/a.ts"] },
    daemon: "held",
    keeper: "store at ran",
    names: "merge",
  },
  "difference 4: an editor's scratch file moved a listed directory": {
    during: { batch: { "src/.a.ts.swp": "swap\n" } },
    daemon: "unstable",
    keeper: "store at ran",
    names: "src/",
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
  },
  "the runner withheld it": {
    during: { report: (r) => ({ ...only([B])(r), withheld: [A] }) },
    daemon: "withheld",
    keeper: "withheld",
  },
  "the daemon queues it again": { during: { ledger: "requeue" }, daemon: "requeue", keeper: null },
  "a cancel cut it short": {
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

function named(decision: RunDecision): Named {
  return decision.kind === "store" ? `store at ${decision.at}` : decision.kind;
}

describe("run evidence: the store decision per file, the daemon's sources and squeal code's", () => {
  it.each(Object.entries(TABLE))("%s", { timeout: 60_000 }, async (_, row) => {
    const { daemon, keeper } = await decide(row.during);

    expect([named(daemon.decision), keeper === null ? null : named(keeper.decision)]).toEqual([
      row.daemon,
      row.keeper,
    ]);
    expect(keeper === null ? null : keeps(keeper.decision)).toBe(
      row.keeper === null ? null : row.keeper === "store at ran",
    );
    if (row.names === undefined) return;
    expect(daemon.reason).toContain(row.names);
    if (keeper !== null && row.keeper === row.daemon) expect(keeper.reason).toContain(row.names);
  });
});
