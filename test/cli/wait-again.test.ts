import { describe, expect, it } from "vitest";
import type { NamedFile } from "../../src/cli/named-files.js";
import { printNamed } from "../../src/cli/named-print.js";
import { waitAgainCommand } from "../../src/cli/no-verdict-lines.js";
import { namedLine } from "../../src/cli/status-wait-lines.js";
import { namedResult, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { refinedMetaKey } from "../../src/core/types/index.js";
import { A, B, NOW, ref, repoWith } from "./status-wait-fixture.js";
import { ended, ISSUE_99, NINE, SYNCED } from "./wait-again-fixture.js";

/*
 * Row 011-243 (gh-99; 011 C15): a named wait with no verdict says which
 * revision its passes cover, that a later pass is not reported and a failure
 * arrives with a later tool call, and ends with the command to wait again.
 * Exit 3 and the verdict rule stay (`selectionResult`).
 */

describe("a named wait with no verdict names what its passes cover and the next step (row 011-243)", () => {
  it("#99's case: the passes at revision 6, revision 7 not listed, then the same wait again", () => {
    expect(namedResult(ISSUE_99)).toEqual({ result: "none", reason: "unlisted" });
    expect(namedLine(ISSUE_99)).toBe(
      "Named test files have no verdict: the deadline passed after 61.2 s: " +
        "9 test files passed at revision 6; revision 7 is not listed yet (677 test files queued), so these results may not cover it. " +
        "Worktree: known failures 0; not current: 677 of 1026 test files (677 queued); revision 7 is not listed yet, so test files it adds are not counted. " +
        "A later pass is not reported. A failure arrives with a later tool call. " +
        "For the verdict, wait again: `squeal status --wait 60000 <same paths>`",
    );
  });

  it("the daemon's pass not stored: the passes at the results' revision, which may not cover the edits (#99, second report)", () => {
    const wait = ended(NINE.slice(0, 2), "timeout", 42, { sync: { state: "pending" } });

    expect(namedResult(wait)).toEqual({ result: "none", reason: "unsynced" });
    expect(namedLine(wait)).toMatch(
      /^Named test files have no verdict: the deadline passed after 61\.2 s: 2 test files passed at revision 42; the daemon has not stored its pass over the edits made before the wait, so these results may not cover them\. Worktree: .*\. A later pass is not reported\. A failure arrives with a later tool call\. For the verdict, wait again: `squeal status --wait 60000 \S+contract-parity\.automations\.test\.ts \S+contract-parity\.delegation\.test\.ts`$/,
    );
  });

  it("the daemon's pass past the results' revision, one file current and one pending", () => {
    const wait = ended([A, B], "timeout", 4, {
      sync: SYNCED(5),
      files: [
        { testFile: ref(A), state: "current", verdict: "fail" },
        {
          testFile: ref(B),
          state: "pending",
          pending: { kind: "queued", lane: "vitest", behind: null },
        },
      ] as NamedFile[],
    });

    expect(namedLine(wait)).toMatch(
      /^Named test files have no verdict: the deadline passed after 61\.2 s: 1 test file failed at revision 4; the daemon's pass is at revision 5, so this result may not cover it\. Worktree: /,
    );
  });

  it("a wait at a pending tier: the files still pending, then the same wait again", () => {
    const wait = ended([A], "timeout", 4, {
      verdict: { byClass: { current: 0, pending: 1, stale: 0, unknown: 0 } },
      files: [
        {
          testFile: ref(A),
          state: "pending",
          pending: { kind: "running", lane: "vitest", since: null },
        },
      ] as NamedFile[],
      timeoutMs: 120_000,
    });

    expect(namedResult(wait)).toEqual({ result: "none", reason: "pending" });
    expect(namedLine(wait)).toMatch(
      /^Named test files have no verdict: the deadline passed after 61\.2 s: 1 test file still pending at revision 4: 1 running in the vitest lane\. Worktree: .*\. A later pass is not reported\. A failure arrives with a later tool call\. For the verdict, wait again: `squeal status --wait 120000 src\/a\.test\.ts`$/,
    );
  });

  it("no daemon: its own step, the wait once one runs, and no word of a later tool call", () => {
    const wait = ended([A], "no-daemon", 4, {
      down: "stopped",
      result: { daemon: { state: "not-validating", since: NOW - 60_000 } as never },
    });

    const line = namedLine(wait);

    expect(namedResult(wait)).toEqual({ result: "none", reason: "no-daemon" });
    expect(line).toMatch(
      /^Named test files have no verdict: no daemon has validated since \S+: the daemon stopped; results are as of revision 4; `squeal start` starts one\. Worktree: .*\. For the verdict, wait again once a daemon runs: `squeal status --wait 60000 src\/a\.test\.ts`$/,
    );
    expect(line).not.toContain("later tool call");
  });

  it("a snapshot names the wait, at the deadline Squeal's texts name", () => {
    const wait = ended([A], "timeout", 4, {
      snapshot: true,
      sync: { state: "pending" },
      timeoutMs: 5,
    });

    expect(namedLine(wait)).toMatch(
      /^Named test files have no verdict: 1 test file passed at revision 4; the daemon has not stored its pass over the latest edits, so this result may not cover them\. Worktree: .*\. For the verdict, wait: `squeal status --wait 60000 src\/a\.test\.ts`$/,
    );
  });

  it("names no step with a verdict, nor where the line names its own (a stale file nothing queues)", () => {
    expect(namedLine(ended([A], "settled", 4))).not.toContain("wait again");
    const stale = ended([A], "settled", 4, {
      verdict: { byClass: { current: 0, pending: 0, stale: 1, unknown: 0 } },
      files: [
        {
          testFile: ref(A),
          state: "stale",
          verdict: "pass",
          standing: { kind: "stale", verdict: "pass", lookupOnly: true },
        },
      ] as NamedFile[],
    });
    expect(namedResult(stale)).toEqual({ result: "none", reason: "not-current" });
    expect(namedLine(stale)).toMatch(/`squeal retry src\/a\.test\.ts`\. Worktree: [^`]*$/);
  });
});

describe("the command to wait again (row 011-243)", () => {
  it("names each path from the directory it was given in, shell-quoted, with the `--check` texts", () => {
    const wait = ended(["pkg/src/a.test.ts", "pkg/src/b c.test.ts"], "timeout", 4, {
      selection: {
        files: [ref("pkg/src/a.test.ts"), ref("pkg/src/b c.test.ts")],
        unmatched: [],
        unmatchedPaths: [],
        paths: [
          { path: "pkg/src/a.test.ts", kind: "test-file", selects: 1 },
          { path: "pkg/src/b c.test.ts", kind: "test-file", selects: 1 },
        ],
        base: "pkg",
      },
      focus: { texts: ["rejects a token"], files: [] },
    });

    expect(waitAgainCommand(wait, "squeal")).toBe(
      "squeal status --wait 60000 src/a.test.ts 'src/b c.test.ts' --check 'rejects a token'",
    );
  });

  it("names `<same paths>` past three, and a source path as given", () => {
    expect(waitAgainCommand(ISSUE_99, "/opt/squeal")).toBe(
      "/opt/squeal status --wait 60000 <same paths>",
    );
    const source = ended([A], "timeout", 4, {
      selection: {
        files: [ref(A), ref(B)],
        unmatched: [],
        unmatchedPaths: [],
        paths: [{ path: "src/a.ts", kind: "source", selects: 2 }],
        base: "",
      },
    });
    expect(waitAgainCommand(source, "squeal")).toBe("squeal status --wait 60000 src/a.ts");
  });
});

describe("a real named wait at an unlisted revision (row 011-243)", () => {
  it("reads the passes' revision and the queued files from the store, and exits 3 as before", async () => {
    // Revision 5 not listed (the runner part at 4), A current and passing, B queued.
    const { repo, store } = repoWith([B], [A]);
    store.revisions.append({
      worktreeId: repo.mainId,
      createdAt: NOW - 10_000,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "src/other.ts", oldHash: "a", newHash: "b" }],
    });
    store.meta.set(refinedMetaKey(repo.mainId), "4");

    const wait = await waitForNamed(repo.main, [A], {
      timeoutMs: 60,
      pollMs: 20,
      settleMs: 0,
      now: () => NOW,
      sync: () => ({ current: () => SYNCED(5), stop: () => {} }),
      ask: async () => [],
    });
    if (wait.outcome === "unavailable") throw new Error("unavailable");

    expect(namedResult(wait)).toEqual({ result: "none", reason: "unlisted" });
    expect(namedLine(wait)).toMatch(
      /^Named test files have no verdict: the deadline passed after \d+\.\d s: 1 test file passed at revision 4; revision 5 is not listed yet \(1 test file queued\), so this result may not cover it\. Worktree: .*\. For the verdict, wait again: `squeal status --wait \d+ src\/a\.test\.ts`$/,
    );
  });
});

describe("`--json` of a wait with no verdict (row 011-243)", () => {
  it("keeps the selection's fields as before, and the deadline out of it", async () => {
    let out = "";
    const io = { stdout: (t: string) => (out += t), stderr: () => {}, env: {} };
    const code = await printNamed(Promise.resolve(ISSUE_99), { json: true }, io, () => NOW);

    const json = JSON.parse(out);
    expect(code).toBe(3);
    expect(Object.keys(json.selection)).toEqual([
      "outcome",
      "waitedMs",
      "code",
      "result",
      "reason",
      "testFiles",
      "unmatched",
      "paths",
      "leftForPause",
      "verdict",
    ]);
    expect(json.selection).toMatchObject({ code: 3, result: "none", reason: "unlisted" });
    expect(out).not.toContain("timeoutMs");
  });
});
