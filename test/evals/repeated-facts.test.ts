import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { Delta, Registration, TransitionEntry } from "../../src/core/types/delivery.js";
import type { KnownFailure, StatusHeader } from "../../src/core/types/status.js";

// Row 005-92: the evals parser reads the real formatters' texts once a repeated fact moves after
// the blocks: a group's own changed-imports line in plain words, the shared line, and a
// registration's retry advice said once.

const header: StatusHeader = {
  revision: 3,
  counts: { current: 100, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
};
const consumer = { worktreeId: "wt", sessionId: "s", agentId: "main" };

const failure = (
  path: string,
  name: string,
  summary: string,
  paths: string[],
): TransitionEntry => ({
  check: { kind: "test", project: "", testPath: path, fullName: name },
  kind: "pass-to-fail",
  from: "pass",
  to: "fail",
  validity: "current",
  observedAt: 3,
  origin: { kind: "own" },
  summary,
  location: null,
  changesInClosure: paths,
});

const delta = (entries: TransitionEntry[]): Delta => ({
  schemaVersion: 1,
  consumer,
  header,
  label: "transitions",
  entries,
});

const current = { to: "fail", from: "pass", observed: 3, validity: "current" };

function read(text: string) {
  const step = squealEvidence(text, "push");
  if (step === null) throw new Error(`no evidence in: ${text}`);
  return step;
}

describe("the evals parser reads a report that says a repeated fact once (row 005-92)", () => {
  it("reads a group with its own changed-imports line, and singles before the shared line", () => {
    const text = formatDelta(
      delta([
        failure("test/a.test.ts", "one", "boom", ["src/x.ts"]),
        failure("test/b.test.ts", "two", "boom", ["src/x.ts"]),
        failure("test/c.test.ts", "three", "bang", ["src/y.ts"]),
        failure("test/d.test.ts", "four", "crash", ["src/y.ts"]),
      ]),
    );
    expect(text).toContain("      its imports include files changed here");
    expect(text).toContain("\n\n2 of the 4 failing tests import files changed here");
    const step = read(text);
    expect(step).toMatchObject({ revision: 3, failures: 4, verdict: "fail" });
    expect(step.checks).toEqual([
      { ...current, check: "test/a.test.ts > one", file: "test/a.test.ts" },
      { ...current, check: "test/b.test.ts > two", file: "test/b.test.ts" },
      { ...current, check: "test/c.test.ts > three", file: "test/c.test.ts" },
      { ...current, check: "test/d.test.ts > four", file: "test/d.test.ts" },
    ]);
  });

  it("reads a registration whose retry advice and changed imports follow the blocks", () => {
    const known = (name: string): KnownFailure => ({
      check: { kind: "test", project: "", testPath: `test/${name}.test.ts`, fullName: name },
      outcome: "fail",
      validity: "current",
      observedAt: 3,
      summary: `${name} broke`,
      fingerprint: `Error: ${name} broke`,
      location: null,
      changesInClosure: ["src/x.ts"],
      recorded: {
        worktreeId: "wt",
        worktreeRoot: null,
        revision: 3 as never,
        loadPerCpu: 2,
        noEarlierPass: true,
      },
    });
    const registration: Registration = {
      schemaVersion: 1,
      consumer,
      header,
      knownFailures: [known("a"), known("b")],
    };
    const text = formatRegistration(registration);
    expect(text).toContain("--reason load` runs them once more");
    expect(text).toContain("All 2 failing tests import files changed here");
    const step = read(text);
    expect(step).toMatchObject({ revision: 3, failures: 2 });
    expect([...(step.failing ?? [])].sort()).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  });
});

describe("the evals parser reads a group recorded before row 005-92", () => {
  it("skips its 'its closure reads' line as a fact, not a check", () => {
    const text = formatDelta(
      delta([
        failure("test/a.test.ts", "one", "boom", ["src/x.ts"]),
        failure("test/b.test.ts", "two", "boom", ["src/x.ts"]),
      ]),
    ).replace("its imports include", "its closure reads");
    expect(text).toContain("      its closure reads files changed here");
    expect(read(text)).toMatchObject({ failures: 2 });
  });
});
