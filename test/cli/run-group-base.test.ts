import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeDaemon } from "./fake-daemon.js";
import {
  CHANGED,
  daemon,
  ref,
  run,
  sent,
  UNIT,
  useBaseEnv,
  worktree as worktreeIn,
} from "./run-group-base-fixture.js";

/*
 * Row 026-07 (spec 026 D4): `squeal run <group> --base <ref>` sends the
 * paths changed since the merge base (branch commits, staged, unstaged,
 * untracked) as a narrow run for a test group, lints a lint group's
 * changed paths, and says what it left for `squeal run <group>` or CI;
 * against a real git repository and a stand-in daemon.
 */

const runtimeDir = useBaseEnv();
const worktree = () => worktreeIn(runtimeDir());

describe("squeal run <group> --base <ref> (spec 026 D4, row 026-07)", () => {
  it("sends the branch's, staged, unstaged and untracked paths as a narrow run", async () => {
    const w = worktree();
    await daemon(w.socket, 1);
    const result = await run(["run", "unit", "--base", "main"], join(w.root, "src"));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(sent()).toEqual([{ type: "run-group-paths", group: "unit", paths: [...CHANGED] }]);
    expect(result.stdout).toBe(
      [
        `Changes since ${w.base.slice(0, 12)} (merge base of main and HEAD): 5 changed paths.`,
        "Group unit at revision 3: these paths select 1 test file; 1 queued, which run now.",
        "4 other test files of group unit read these paths; they wait for `squeal run unit` or CI; this narrow run did not run them.",
        "src/gone.ts, src/new.ts select no test file of any group.",
        "",
      ].join("\n"),
    );
  });

  it("--json names the merge base, the selection, the omitted files and the unmatched paths", async () => {
    const w = worktree();
    await daemon(w.socket, 1);
    const result = await run(["run", "unit", "--base", "main", "--json"], w.root);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      group: "unit",
      kind: "test",
      ref: "main",
      mergeBase: w.base,
      changedPaths: [...CHANGED],
      wholeGroup: false,
      revision: 3,
      selected: [{ path: UNIT, project: "", initialState: null }],
      initialCurrent: 0,
      queued: 1,
      omitted: 4,
      others: [],
      unmatched: ["src/gone.ts", "src/new.ts"],
      verdict: null,
      code: 0,
      note: "4 other test files of group unit read these paths and were not run here; they wait for `squeal run unit` or CI.",
    });
  });

  it("reuses a current selected file: none runs again, and --wait gives its verdict", async () => {
    const w = worktree();
    w.current(UNIT);
    await daemon(w.socket, 0, { current: 1, reached: 0, unmatched: [] });
    const text = await run(["run", "unit", "--base", "main", "--wait", "20000"], w.root);
    expect(text.lines[0]).toBe(
      "Selected test files of group unit completed at revision 3: no known failures; 1 test file, 0 queued by this request",
    );
    expect(text.lines[1]).toBe(
      `Changes since ${w.base.slice(0, 12)} (merge base of main and HEAD): 5 changed paths.`,
    );
    expect(text.lines[2]).toBe(
      "Group unit at revision 3: these paths select 1 test file, current; none runs again.",
    );
    expect(text.stdout).not.toContain("all tests passed");
    expect(text.code).toBe(0);
    const json = await run(["run", "unit", "--base", "main", "--wait", "20000", "--json"], w.root);
    const answer = JSON.parse(json.stdout);
    expect(answer.verdict).toEqual({
      line: "Selected test files of group unit completed at revision 3: no known failures; 1 test file, 0 queued by this request",
      code: 0,
    });
    expect(answer.selected).toEqual([
      { path: UNIT, project: "", initialState: null, verdict: "passed", from: null },
    ]);
    expect(answer.wholeGroup).toBe(false);
    expect(answer.note).toBe(
      "A narrow run: group unit is not current as a whole; `squeal run unit` or CI runs it.",
    );
    expect(json.code).toBe(0);
  });

  it("names a selected file that does not run, by its reason", async () => {
    const w = worktree();
    const notRun = [{ testFile: ref(UNIT), reason: "its runner failed" }];
    await daemon(w.socket, 0, { notRun, reached: 0, unmatched: [] });
    const result = await run(["run", "unit", "--base", "main", "--json"], w.root);
    expect(JSON.parse(result.stdout).selected).toEqual([
      { path: UNIT, project: "", initialState: "not-run", reason: "its runner failed" },
    ]);
  });

  it("lints a lint group's pending checks and names the changed paths", async () => {
    const w = worktree();
    const taken = {
      ok: true,
      type: "run-group",
      requestId: "g1",
      group: "lint",
      requested: { revision: 3, queued: 2 },
      unknown: false,
      error: null,
    };
    await fakeDaemon(w.socket, { "run-group": [taken] });
    const text = await run(["run", "lint", "--base", "main"], w.root);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      [
        `Changes since ${w.base.slice(0, 12)} (merge base of main and HEAD): 5 changed paths; group lint lints its pending lint checks, these among them.`,
        "Group lint requested at revision 3: 2 lint checks queued; they lint now.",
        "",
      ].join("\n"),
    );
    expect(sent()).toEqual([{ type: "run-group", group: "lint" }]);
    const json = await run(["run", "lint", "--base", "main", "--json"], w.root);
    expect(JSON.parse(json.stdout)).toMatchObject({
      group: "lint",
      kind: "lint",
      mergeBase: w.base,
      changedPaths: [...CHANGED],
      revision: 3,
      queued: 2,
      verdict: null,
      code: 0,
    });
  });

  it("says nothing changed and asks no daemon", async () => {
    const w = worktree();
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "rest");
    const result = await run(["run", "unit", "--base", "HEAD"], w.root);
    const head = w.git("rev-parse", "HEAD").trim();
    expect(result.stdout).toBe(
      `Changes since ${head.slice(0, 12)} (merge base of HEAD and HEAD): 0 changed paths: nothing to run.\n`,
    );
    expect(result.code).toBe(0);
    expect(sent()).toEqual([]);
  });

  it("rejects an unknown ref, --base with paths and --json without --base (exit 2)", async () => {
    const w = worktree();
    const bad = await run(["run", "unit", "--base", "nope"], w.root);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/^squeal run: --base nope: "nope" names no commit\n/);
    const paths = await run(["run", "unit", "src/core.ts", "--base", "main"], w.root);
    expect(paths.code).toBe(2);
    expect(paths.stderr).toMatch(/^squeal run: --base takes no paths: squeal run unit --base main/);
    const json = await run(["run", "unit", "--json"], w.root);
    expect(json.code).toBe(2);
    expect(json.stderr).toMatch(/^squeal run: --json needs --base <ref>/);
    const bare = await run(["run", "unit", "--base"], w.root);
    expect(bare.code).toBe(2);
    expect(bare.stderr).toMatch(/^squeal run: --base needs a ref/);
    expect(sent()).toEqual([]);
  });
});
