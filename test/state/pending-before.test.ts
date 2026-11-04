import { describe, expect, it } from "vitest";
import {
  pendingBefore,
  type RequiredFile,
  type StopRequired,
  stopRequired,
} from "../../src/core/state/required.js";
import {
  type CheckGroup,
  DEFAULT_POLICY,
  type KnownState,
  type PendingPhase,
  type Policy,
  type TestFileKeyRecord,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { check, WT } from "./helpers.js";

/*
 * Row 019-30 (`019-run-triggers/lessons.md` P5, option a): why a group at
 * `stop` has not started at Stop's bound: none of its files not current is
 * running, and the groups it follows have test files pending, counted as
 * their status lines count them.
 */

const E2E: TestFileRef = { project: "", path: "test/e2e/a.test.ts" };
const UNIT_A: TestFileRef = { project: "", path: "src/a.test.ts" };
const UNIT_B: TestFileRef = { project: "", path: "src/b.test.ts" };
const API: TestFileRef = { project: "", path: "api/c.test.ts" };

const group = (name: string, tests: string, at: CheckGroup["at"], after?: string[]) =>
  ({ name, runner: "vitest", tests: [tests], at, ...(after ? { after } : {}) }) as CheckGroup;

function policy(checks: CheckGroup[]): Policy {
  return { ...DEFAULT_POLICY, checks };
}

function required(after: string[]): StopRequired {
  const r = stopRequired(
    policy([
      group("unit", "src/**", "edit"),
      group("api", "api/**", "edit"),
      group("e2e", "test/e2e/**", "stop", after),
    ]),
  );
  if (r === null) throw new Error("nothing required");
  return r;
}

const key = (testFile: TestFileRef, pending: PendingPhase | null): TestFileKeyRecord => ({
  worktreeId: WT,
  testFile,
  key: `k-${testFile.path}`,
  revision: 1,
  pending,
});

const current = (testFile: TestFileRef): KnownState =>
  ({
    worktreeId: WT,
    check: check("t", testFile),
    outcome: "pass",
    validity: "current",
    observedAt: 1,
  }) as KnownState;

const OPEN: readonly RequiredFile[] = [{ group: "e2e", ref: E2E }];

describe("pendingBefore (row 019-30, P5)", () => {
  it("names each group it follows with files pending, in `after` order, with its count", () => {
    const keys = [
      key(API, "running"),
      key(UNIT_A, "queued"),
      key(UNIT_B, "queued"),
      key(E2E, "queued"),
    ];
    expect(pendingBefore([], keys, required(["unit", "api"]), "e2e", OPEN)).toEqual([
      { group: "unit", pending: 2 },
      { group: "api", pending: 1 },
    ]);
  });

  it("leaves out a group it follows with nothing pending, and a group it does not follow", () => {
    const keys = [key(API, "queued"), key(UNIT_A, null), key(E2E, "queued")];
    expect(pendingBefore([current(UNIT_A)], keys, required(["unit"]), "e2e", OPEN)).toEqual([]);
  });

  it("is empty once one of the group's files not current is running", () => {
    const keys = [key(UNIT_A, "queued"), key(E2E, "running")];
    expect(pendingBefore([], keys, required(["unit"]), "e2e", OPEN)).toEqual([]);
  });

  it("is empty for a group with no file not current", () => {
    const keys = [key(UNIT_A, "queued"), key(E2E, null)];
    expect(pendingBefore([current(E2E)], keys, required(["unit"]), "e2e", [])).toEqual([]);
  });
});

describe("what stopRequired gives the hold texts (row 019-30)", () => {
  it("each group's `after` and owner, and the texts only with a `checks` key", () => {
    const r = required(["unit"]);
    expect(r.after("e2e")).toEqual(["unit"]);
    expect(r.after("unit")).toEqual([]);
    expect(r.after("no such group")).toEqual([]);
    expect([r.ownerOf(UNIT_A), r.ownerOf(API), r.ownerOf(E2E)]).toEqual(["unit", "api", "e2e"]);
    expect(r.groupTexts).toBe(true);
    const slow = stopRequired({
      ...DEFAULT_POLICY,
      slow: { ...DEFAULT_POLICY.slow, include: ["test/e2e/**"] },
      stop: { ...DEFAULT_POLICY.stop, requireSlowSuite: true },
    });
    expect(slow?.groupTexts).toBe(false);
  });
});
