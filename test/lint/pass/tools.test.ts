import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintScope, offKey, readCursor } from "../../../src/core/lint/pass/records.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { LintTool } from "../../../src/core/types/lint.js";
import type { Policy } from "../../../src/core/types/policy.js";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider, fakeOxlint, lintPass, lintTree, storeOf } from "./helpers.js";

/* Spec 017 D11: one pass per tool, each with its own checks and records, over one lint store. */

const passes: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const pass of passes.splice(0)) await pass.close();
});

/** An ESLint pass and an oxlint pass over `tree`, as the daemon makes them. */
function both(tree: FakeWorktree, policy: () => Policy = () => LINT_ON) {
  const eslint = new FakeProvider();
  const oxlint = fakeOxlint();
  const runs = (["eslint", "oxlint"] as const).map((tool) => {
    const run = lintPass(tree, tool === "eslint" ? eslint : oxlint, { tool, policy });
    passes.push(run.pass);
    return run;
  });
  const settle = async () => {
    for (const run of runs) {
      run.pass.nudge();
      await run.pass.idle();
    }
  };
  return { eslint, oxlint, runs, settle };
}

/** Each check's outcome as `path tool outcome`. */
function checks(store: LintStore, tree: FakeWorktree): string[] {
  return store.states.list(tree.id).map((s) => `${s.check.path} ${s.check.tool} ${s.outcome}`);
}

const history = (store: LintStore, tree: FakeWorktree, tool: LintTool) =>
  store.transitions
    .history(tree.id, { kind: "lint", path: "src/a.js", tool })
    .map((t) => `${t.kind} +${t.added.map((f) => f.rule).join(",")}`);

describe("a lint pass per tool (017 D11)", () => {
  it("gives each file two checks, and an edit a transition per tool", async () => {
    const tree = lintTree().write(".oxlintrc.json", "{}\n");
    tree.write("src/a.js", "ok\n").write("src/b.js", "bad no-undef\n");
    tree.revise();
    const { runs, settle } = both(tree);
    await settle();
    const store = storeOf(tree);
    // oxlint lints ESLint's config file too, as a real oxlint would.
    expect(checks(store, tree)).toEqual([
      "eslint.config.js oxlint pass",
      "src/a.js eslint pass",
      "src/a.js oxlint pass",
      "src/b.js eslint fail",
      "src/b.js oxlint fail",
    ]);

    tree.write("src/a.js", "bad no-console\n");
    tree.revise();
    await settle();
    expect(checks(store, tree).filter((c) => c.startsWith("src/a.js"))).toEqual([
      "src/a.js eslint fail",
      "src/a.js oxlint fail",
    ]);
    expect(history(store, tree, "eslint")).toEqual(["pass-to-fail +no-console"]);
    expect(history(store, tree, "oxlint")).toEqual(["pass-to-fail +no-console"]);
    // Each keeps its own cursor: ESLint's under the worktree's id, oxlint's under its scope.
    expect(readCursor(store.meta, tree.id)?.revision).toBe(2);
    expect(readCursor(store.meta, lintScope(tree.id, "oxlint"))?.revision).toBe(2);
    expect(runs.flatMap((r) => r.errors)).toEqual([]);
  });

  it("keys again only the tool whose config changed", async () => {
    const tree = lintTree().write(".oxlintrc.json", "{}\n").write("src/a.js", "ok\n");
    tree.revise();
    const { runs, settle } = both(tree);
    await settle();
    const before = runs.map((r) => r.reports.length);
    tree.write(".oxlintrc.json", '{ "rules": {} }\n');
    tree.revise();
    await settle();
    // ESLint reads the revision as an edit of a file it does not lint; oxlint keys every file again.
    const modes = runs.map((r, i) => r.reports.slice(before[i]).map((p) => [p.mode, p.linted]));
    expect(modes).toEqual([[["edit", 0]], [["config", 2]]]);
  });

  it("keeps a tool off apart: oxlint off is no ESLint off, and ESLint still lints", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n");
    tree.revise();
    const { oxlint, settle } = both(tree);
    oxlint.declaration = { off: "no oxlint installed in /x" };
    await settle();
    const store = storeOf(tree);
    expect(checks(store, tree)).toEqual(["src/a.js eslint fail"]);
    expect(store.meta.get(offKey(tree.id))).toBeNull();
    expect(store.meta.get(offKey(lintScope(tree.id, "oxlint")))).toBe("no oxlint installed in /x");
  });

  it("with lint.tools naming ESLint alone, opens no oxlint provider and removes its checks", async () => {
    const tree = lintTree().write(".oxlintrc.json", "{}\n").write("src/a.js", "bad no-undef\n");
    tree.revise();
    let policy: Policy = LINT_ON;
    const { eslint, oxlint, settle } = both(tree, () => policy);
    await settle();
    expect(oxlint.opened).toBe(1);

    policy = { ...LINT_ON, lint: { ...LINT_ON.lint, tools: ["eslint"] } };
    tree.write("src/a.js", "bad no-console\n");
    tree.revise();
    await settle();
    const store = storeOf(tree);
    expect(checks(store, tree)).toEqual(["src/a.js eslint fail"]);
    expect(oxlint.closed).toBe(1);
    expect(readCursor(store.meta, lintScope(tree.id, "oxlint"))).toBeNull();
    expect(eslint.calls.at(-1)).toEqual(["src/a.js"]);

    // A new daemon with the same policy opens none.
    const fresh = fakeOxlint();
    const run = lintPass(tree, fresh, { tool: "oxlint", policy: () => policy });
    passes.push(run.pass);
    run.pass.nudge();
    await run.pass.idle();
    expect(fresh.opened).toBe(0);
    expect(fresh.calls).toEqual([]);
  });
});

describe("an oxlint part beside an edit on disk (017 D11, 017-14 notes 6)", () => {
  it("stores nothing for a whole-program file when a listed file moved during the run", async () => {
    const tree = lintTree().write(".oxlintrc.json", "{}\n");
    tree.write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
    tree.revise();
    const oxlint = fakeOxlint();
    oxlint.wholeProgram.add("src/a.js");
    let open: () => void = () => {};
    oxlint.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const run = lintPass(tree, oxlint, { tool: "oxlint" });
    passes.push(run.pass);
    run.pass.nudge();
    while (oxlint.calls.length === 0) await new Promise((r) => setTimeout(r, 5));
    // oxlint's import plugin would read b.js from disk now: bytes no key holds.
    writeFileSync(join(tree.root, "src/b.js"), "bad no-console\n");
    open();
    await run.pass.idle();
    const store = storeOf(tree);
    const a = store.states.list(tree.id, { paths: ["src/a.js"], tool: "oxlint" })[0];
    expect(a?.outcome).toBe("pending");
    // b.js is not whole-program: its own bytes were the given text's, so it is stored.
    expect(checks(store, tree)).toContain("src/b.js oxlint pass");
  });
});
