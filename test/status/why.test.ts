import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCheck, formatWhy, parseCheck, readWhy } from "../../src/core/status/index.js";
import type { CheckId } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore } from "./helpers.js";
import { LOGIN, reportOf, seedLogin } from "./why-seed.js";

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
    const runDir = join(repo.commonDir, "squeal", "runs", "run-a1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "vitest.log"), "squeal vitest run run-a1\n");

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

      Run log: <common>/squeal/runs/run-a1/vitest.log
        Run run-a1 in <main> (inherited) produced the result shown. The log covers that whole run, every test file in it, not only this check.
        --include-logs prints the console lines of src/auth.test.ts from it.
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
      "src/a.test.ts (file-level)",
      "[web] src/a.test.ts (file-level)",
    ]);
    for (const c of checks) expect(parseCheck(formatCheck(c))).toEqual(c);
    expect(parseCheck("[web] src/a.test.ts")).toEqual(checks[3]);
    expect(parseCheck("  ")).toBeNull();
  });
});
