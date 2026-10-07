import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import type {
  Delta,
  Registration,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

/* Task 001-91, lessons defect 16: where a failure came from and whether the agent's changes reach it. */

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const header: StatusHeader = {
  revision: 9,
  counts: { current: 10, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
};

const failure: TransitionEntry = {
  check: { kind: "test", project: "", testPath: "tests/a.test.ts", fullName: "a" },
  kind: "pass-to-fail",
  from: "pass",
  to: "fail",
  validity: "current",
  observedAt: 9,
  origin: { kind: "own" },
  summary: "expected 1 to be 2",
  location: null,
};

function delta(entries: TransitionEntry[], head: Partial<StatusHeader> = {}): Delta {
  return {
    schemaVersion: 1,
    consumer,
    header: { ...header, ...head },
    label: "transitions",
    entries,
  };
}

/** The lines under the first block's head. */
const lines = (d: Delta) => formatDelta(d).split("\n\n")[1]?.split("\n").slice(1) ?? [];

describe("who saw a failure (task 001-91)", () => {
  it("says Squeal's run saw it at its revision, never 'baseline finding'", () => {
    expect(lines(delta([failure]))[0]).toBe(
      "      PASS -> FAIL, seen by Squeal's run at revision 9",
    );
    const baseline = { ...failure, kind: "first-seen-fail" as const, from: null, baseline: true };
    const text = formatDelta({ ...delta([baseline]), label: "baseline" });
    expect(text).toContain(
      "      first observed: FAIL, seen by Squeal's run at revision 9, at start (baseline)",
    );
    expect(text).not.toContain("baseline finding");
  });

  it("states a pending or stale failure against the revision it was seen at", () => {
    const pending = { ...failure, validity: "pending" as const, observedAt: 7 };
    expect(lines(delta([pending]))[0]).toBe(
      "      PASS -> FAIL, seen by Squeal's run at revision 7, revision 9 pending",
    );
    const stale = { ...failure, validity: "stale" as const, observedAt: 6 };
    expect(lines(delta([stale]))[0]).toBe(
      "      PASS -> FAIL, seen by Squeal's run at revision 6, stale",
    );
  });

  it("names the worktree and commit of an inherited failure", () => {
    const inherited: TransitionEntry = {
      ...failure,
      origin: { kind: "inherited", worktreeId: "wt-main", commit: "0123456789abcdef0123" },
      originRoot: "/repo/main",
    };
    expect(lines(delta([inherited]))[0]).toBe(
      "      PASS -> FAIL, seen by Squeal's run in /repo/main at commit 0123456789ab, inherited at revision 9",
    );
  });
});

describe("whether the agent's changes reach a failure (task 001-91)", () => {
  it("names the changed files in its imports, three and a count of the rest", () => {
    const touched = {
      ...failure,
      changesInClosure: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
    };
    expect(lines(delta([touched]))).toContain(
      "      touches your changes: src/a.ts, src/b.ts, src/c.ts and 2 more",
    );
    expect(lines(delta([{ ...failure, changesInClosure: ["src/x.ts"] }]))).toContain(
      "      touches your changes: src/x.ts",
    );
  });

  it("says when none of the changes are in its imports", () => {
    expect(lines(delta([{ ...failure, changesInClosure: [] }]))).toContain(
      "      none of your changes are in its imports",
    );
  });

  it("says nothing when it is not known", () => {
    const text = formatDelta(delta([failure]));
    expect(text).not.toContain("your changes");
  });
});

describe("timeouts (task 001-91)", () => {
  it("carries the load average when the timed-out test ran", () => {
    const timeout = { ...failure, summary: "Test timed out in 5000ms.", loadAverage: 11.523 };
    expect(lines(delta([timeout]))).toContain("      load average 11.52 when it ran");
    expect(formatDelta(delta([failure]))).not.toContain("load average");
  });
});

describe("install context in the header (task 001-91)", () => {
  const second = (d: Delta) => formatDelta(d).split("\n")[1] ?? "";

  it("says once that no dependencies are installed", () => {
    const failures = [1, 2, 3].map((i) => ({
      ...failure,
      check: { ...failure.check, fullName: `case ${i}` },
      summary: "Cannot find package 'vitest'",
    }));
    const text = formatDelta(delta(failures, { dependenciesInstalled: false }));
    const note =
      "No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.";
    expect(second(delta(failures, { dependenciesInstalled: false }))).toContain(note);
    expect(text.split(note)).toHaveLength(2);
    expect(formatDelta(delta(failures))).not.toContain("No dependencies");
    const registration: Registration = {
      schemaVersion: 1,
      consumer,
      header: { ...header, dependenciesInstalled: false },
      knownFailures: [],
    };
    expect(formatRegistration(registration)).toContain(note);
  });

  it("says the results follow an install when the changes wrote an installed lockfile", () => {
    const after = delta([failure], { installedLockfile: "node_modules/.package-lock.json" });
    expect(second(after)).toContain(
      "These results follow a dependency install (node_modules/.package-lock.json changed).",
    );
    const nested = delta([failure], { installedLockfile: "pkg/node_modules/.yarn-state.yml" });
    expect(second(nested)).toContain("(pkg/node_modules/.yarn-state.yml changed)");
    expect(second(delta([failure], { changedPaths: ["src/a.ts"] }))).not.toContain("install");
  });

  it("never says both that none is installed and that the results follow an install (S1)", () => {
    const both = delta([failure], {
      dependenciesInstalled: false,
      installedLockfile: "node_modules/.package-lock.json",
    });
    expect(second(both)).toContain("No dependencies are installed");
    expect(second(both)).not.toContain("follow a dependency install");
  });
});
