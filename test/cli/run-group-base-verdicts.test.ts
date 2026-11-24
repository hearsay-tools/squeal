import { describe, expect, it } from "vitest";
import { daemon, ref, run, UNIT, useBaseEnv, worktree } from "./run-group-base-fixture.js";

/*
 * Review 0.1.616 B5 (spec 026 D4.4, repair 026-r3): `squeal run <group>
 * --base <ref> --wait --json` gives each selected file's final verdict
 * after the wait, read from one store snapshot keyed by project and path,
 * beside the request's initial disposition.
 */

const runtimeDir = useBaseEnv();
const OTHER = "test/unit/other.test.ts";

async function answer(root: string, waitMs: string) {
  const result = await run(["run", "unit", "--base", "main", "--wait", waitMs, "--json"], root);
  return { code: result.code, json: JSON.parse(result.stdout) };
}

describe("squeal run <group> --base <ref> --wait --json: final verdicts (review 0.1.616 B5)", () => {
  it("a fresh run's file is passed, from the run, not its initial queued", async () => {
    const w = worktree(runtimeDir());
    w.covered("c1", [{ testFile: ref(UNIT), state: "queued" }]);
    w.current(UNIT);
    await daemon(w.socket, 1, { reached: 0, unmatched: [] }, "c1");
    const { code, json } = await answer(w.root, "20000");
    expect(json.selected).toEqual([
      { path: UNIT, project: "", initialState: "queued", verdict: "passed", from: "run" },
    ]);
    expect(json.initialCurrent).toBe(0);
    expect(json.queued).toBe(1);
    expect(code).toBe(0);
  });

  it("a partial timeout tells the finished file from the one not finished", async () => {
    const w = worktree(runtimeDir());
    w.covered("c1", [
      { testFile: ref(UNIT), state: "queued" },
      { testFile: ref(OTHER), state: "queued" },
    ]);
    w.current(UNIT, "", "fail");
    w.queued(OTHER);
    await daemon(
      w.socket,
      2,
      { selected: [ref(UNIT), ref(OTHER)], reached: 0, unmatched: [] },
      "c1",
    );
    const { code, json } = await answer(w.root, "300");
    expect(json.selected).toEqual([
      { path: UNIT, project: "", initialState: "queued", verdict: "failed", from: "run" },
      { path: OTHER, project: "", initialState: "queued", verdict: "not-finished", from: null },
    ]);
    expect(code).toBe(3);
  });

  it("a reused current result is from the store; a run one is from the run", async () => {
    const w = worktree(runtimeDir());
    w.covered("c1", [
      { testFile: ref(UNIT), state: "current" },
      { testFile: ref(OTHER), state: "queued" },
    ]);
    w.current(UNIT);
    w.current(OTHER);
    const narrow = { selected: [ref(UNIT), ref(OTHER)], current: 1, reached: 0, unmatched: [] };
    await daemon(w.socket, 1, narrow, "c1");
    const { code, json } = await answer(w.root, "20000");
    expect(json.selected).toEqual([
      { path: UNIT, project: "", initialState: "current", verdict: "passed", from: "store" },
      { path: OTHER, project: "", initialState: "queued", verdict: "passed", from: "run" },
    ]);
    expect(json.initialCurrent).toBe(1);
    expect(code).toBe(0);
  });

  it("two projects sharing a test path keep their own verdicts", async () => {
    const w = worktree(runtimeDir());
    w.covered("c1", [
      { testFile: ref(UNIT, "a"), state: "queued" },
      { testFile: ref(UNIT, "b"), state: "queued" },
    ]);
    w.current(UNIT, "a");
    w.current(UNIT, "b", "fail");
    const narrow = { selected: [ref(UNIT, "a"), ref(UNIT, "b")], reached: 0, unmatched: [] };
    await daemon(w.socket, 2, narrow, "c1");
    const { code, json } = await answer(w.root, "20000");
    expect(json.selected).toEqual([
      { path: UNIT, project: "a", initialState: "queued", verdict: "passed", from: "run" },
      { path: UNIT, project: "b", initialState: "queued", verdict: "failed", from: "run" },
    ]);
    expect(code).toBe(1);
  });
});
