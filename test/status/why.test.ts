import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCheck, formatWhy, parseCheck, readWhy } from "../../src/core/status/index.js";
import type { CheckId, Store, WhyReport, WhyResult } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { appendRevisions, check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

const COMMIT = "abc1234def5678abc1234def5678abc1234def56";
const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 4, hour, minute);
const LOGIN = check("src/auth.test.ts", "auth > login");

function reportOf(why: WhyResult): WhyReport {
  if (!why.available || !why.found) throw new Error(`no report: ${JSON.stringify(why)}`);
  return why;
}

/**
 * `auth > login` failed in worktree `b` (own result, run `run-b1`), then the
 * main worktree passed it under the key `b` now has, and `b` inherited that
 * pass.
 */
function seedLogin(repo: FakeRepo, store: Store) {
  const b = repo.addWorktree("b");
  for (const [id, root, isMain] of [
    [repo.mainId, repo.main, true],
    [b.id, b.root, false],
  ] as const) {
    store.worktrees.upsert({
      id,
      root,
      commonDir: repo.commonDir,
      isMain,
      registeredAt: 1,
      daemon: null,
    });
  }
  appendRevisions(store, b.id, 2, { head: COMMIT, dirty: true });
  const runsDir = join(repo.commonDir, "squeal", "runs");
  for (const [id, worktreeId, revision] of [
    ["run-b1", b.id, 1],
    ["run-a1", repo.mainId, 3],
  ] as const) {
    store.runs.start({
      id,
      worktreeId,
      revision,
      testFiles: [{ project: "", path: "src/auth.test.ts" }],
      checkpointId: null,
      logDir: join(runsDir, id),
      startedAt: 1,
    });
  }
  const own = result(LOGIN, "k0", {
    outcome: "fail",
    worktreeId: b.id,
    recordedAt: at(9, 30),
    runId: "run-b1",
    errors: [
      {
        name: "AssertionError",
        message: "expected 200, received 500",
        stack: "AssertionError: expected 200, received 500\n    at src/auth.test.ts:9:5",
        location: { path: "src/auth.test.ts", line: 9, column: 5 },
        diff: null,
      },
    ],
  });
  const source = result(LOGIN, "k1", {
    worktreeId: repo.mainId,
    recordedAt: at(10, 30),
    runId: "run-a1",
  });
  store.results.putMany([
    { ...own, provenance: { ...own.provenance, revision: 1 } },
    { ...source, provenance: { ...source.provenance, revision: 3, commit: COMMIT, dirty: false } },
  ]);
  store.knownStates.upsertMany([
    state(b.id, LOGIN, {
      observedAt: 2,
      commit: COMMIT,
      origin: { kind: "inherited", worktreeId: repo.mainId, commit: COMMIT },
    }),
    state(b.id, check("src/auth.test.ts", "auth > logout")),
    state(b.id, check("src/auth.test.ts", "auth > login twice")),
  ]);
  store.transitions.append([
    {
      worktreeId: b.id,
      check: LOGIN,
      kind: "first-seen-fail",
      from: null,
      to: "fail",
      fromFingerprint: null,
      toFingerprint: "AssertionError: expected 200, received 500 @ src/auth.test.ts:9:5",
      revision: 1,
      at: at(9, 30),
    },
    {
      worktreeId: b.id,
      check: LOGIN,
      kind: "fail-to-pass",
      from: "fail",
      to: "pass",
      fromFingerprint: "AssertionError: expected 200, received 500 @ src/auth.test.ts:9:5",
      toFingerprint: null,
      revision: 2,
      at: at(11),
    },
  ]);
  return b;
}

describe("readWhy", () => {
  it("reports history, inherited state and own results across worktrees, newest first", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);

    const why = reportOf(readWhy(b.root, "src/auth.test.ts > auth > login"));

    expect(why).toMatchObject({
      schemaVersion: 1,
      worktreeId: b.id,
      worktreeRoot: b.root,
      revision: 2,
      check: LOGIN,
      knownState: { outcome: "pass", origin: { kind: "inherited", worktreeId: repo.mainId } },
    });
    expect(why.history.map((t) => t.kind)).toEqual(["first-seen-fail", "fail-to-pass"]);
    expect(
      why.results.map((r) => [r.result.outcome, r.result.provenance.worktreeId, r.worktreeRoot]),
    ).toEqual([
      ["pass", repo.mainId, repo.main],
      ["fail", b.id, b.root],
    ]);
    expect(why.results[0]?.logDir).toBe(join(repo.commonDir, "squeal", "runs", "run-a1"));
  });

  it("renders the report for humans", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);

    const text = formatWhy(readWhy(b.root, "src/auth.test.ts > auth > login"))
      .replaceAll(b.root, "<b>")
      .replaceAll(repo.commonDir, "<common>")
      .replaceAll(repo.main, "<main>");

    expect(text).toMatchInlineSnapshot(`
      "Check: src/auth.test.ts > auth > login
      Worktree: <b>
      Revision: 2

      Known state: PASS, current, observed at revision 2, commit abc1234
        Origin: inherited from <main> at abc1234

      History (2 transitions, oldest first):
        revision 1  2026-10-04T09:30:00.000Z  first seen FAIL
        revision 2  2026-10-04T11:00:00.000Z  FAIL -> PASS

      Results (2, newest first):
        PASS  2026-10-04T10:30:00.000Z  <main>, revision 3, commit abc1234, clean
              run run-a1, 12 ms, key k1
              log: <common>/squeal/runs/run-a1
        FAIL  2026-10-04T09:30:00.000Z  <b> (this worktree), revision 1, commit abc123, dirty
              run run-b1, 12 ms, key k0
              log: <common>/squeal/runs/run-b1
              expected 1 to be 2
              AssertionError: expected 200, received 500
                  at src/auth.test.ts:9:5

      Last run log: <common>/squeal/runs/run-a1
      "
    `);
  });

  it("resolves a unique part of a check name", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);

    expect(reportOf(readWhy(b.root, "logout")).check).toEqual(
      check("src/auth.test.ts", "auth > logout"),
    );
    // "auth > login" is also part of "auth > login twice"; the full-name match wins.
    expect(reportOf(readWhy(b.root, "auth > login")).check).toEqual(LOGIN);
  });

  it("lists the candidates when a name is ambiguous or matches nothing", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);

    const ambiguous = readWhy(b.root, "auth > log");
    expect(ambiguous).toEqual({
      schemaVersion: 1,
      available: true,
      found: false,
      query: "auth > log",
      candidates: [
        LOGIN,
        check("src/auth.test.ts", "auth > login twice"),
        check("src/auth.test.ts", "auth > logout"),
      ],
    });
    expect(formatWhy(ambiguous)).toBe(
      [
        '"auth > log" matches 3 checks in this worktree:',
        "  src/auth.test.ts > auth > login",
        "  src/auth.test.ts > auth > login twice",
        "  src/auth.test.ts > auth > logout",
        "",
      ].join("\n"),
    );

    const none = readWhy(b.root, "nothing like it");
    expect(none).toMatchObject({ found: false, candidates: [] });
    expect(formatWhy(none)).toBe('No check matches "nothing like it" in this worktree.\n');
  });

  it("is unavailable without a store", () => {
    const repo = fakeRepo();

    const why = readWhy(repo.main, "anything");

    expect(why).toMatchObject({ available: false, reason: "no-store" });
    expect(formatWhy(why)).toMatch(/^Status unavailable, no Squeal store at /);
  });
});

describe("check names", () => {
  it("round-trips test and file checks, with and without a project", () => {
    const checks: CheckId[] = [
      LOGIN,
      { kind: "test", project: "web", testPath: "src/a.test.ts", fullName: "x > y > z" },
      { kind: "file", project: "", testPath: "src/a.test.ts" },
      { kind: "file", project: "web", testPath: "src/a.test.ts" },
    ];
    expect(checks.map(formatCheck)).toEqual([
      "src/auth.test.ts > auth > login",
      "[web] src/a.test.ts > x > y > z",
      "src/a.test.ts",
      "[web] src/a.test.ts",
    ]);
    for (const c of checks) expect(parseCheck(formatCheck(c))).toEqual(c);
    expect(parseCheck("  ")).toBeNull();
  });
});
