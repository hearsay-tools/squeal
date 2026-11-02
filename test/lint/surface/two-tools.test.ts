import { afterEach, describe, expect, it } from "vitest";
import { formatLintChanged, formatLintDetails } from "../../../src/cli/lint-report.js";
import type { CodeSince } from "../../../src/core/delivery/code-since.js";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import { lintLines, lintStatusLines } from "../../../src/core/lint/surface/format.js";
import { lintChanged, lintDetails, lintStatus } from "../../../src/core/lint/surface/report.js";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { FakeProvider, fakeOxlint, lintPass, lintTree } from "../pass/helpers.js";
import { consumer, ownAfter, sourceOf } from "./helpers.js";

/* Spec 017 D8, D11: what the agent, status and `squeal lint` say of two tools' checks. */

const passes: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const pass of passes.splice(0)) await pass.close();
});

const session = (since: number): CodeSince => ({ ...ownAfter(since), scope: "session" });

/** An ESLint pass and an oxlint pass over `files`, their first passes run. */
async function bothRig(files: Record<string, string>) {
  const tree = lintTree().write(".oxlintrc.json", "{}\n");
  for (const [path, text] of Object.entries(files)) tree.write(path, text);
  tree.revise();
  const eslint = new FakeProvider();
  const oxlint = fakeOxlint();
  const runs = [lintPass(tree, eslint), lintPass(tree, oxlint, { tool: "oxlint" })];
  for (const run of runs) passes.push(run.pass);
  const settle = async () => {
    for (const run of runs) {
      run.pass.nudge();
      await run.pass.idle();
    }
  };
  await settle();
  const revise = async () => {
    tree.revise();
    await settle();
  };
  return { tree, eslint, oxlint, settle, revise, source: sourceOf(tree) };
}

const status = (tree: FakeWorktree, source: ReturnType<typeof sourceOf>) =>
  lintStatus(source, tree.id, null) ?? expect.unreachable();

describe("two tools' lint checks on the surfaces (017 D11)", () => {
  it("tells each tool's change once, oxlint's line naming the tool, ESLint's as before", async () => {
    const rig = await bothRig({ "src/a.js": "ok\n", "src/b.js": "bad no-undef\n" });
    const me = consumer(rig.tree);
    // Counts are of checks: b fails in each tool.
    expect(registerLint(rig.source, me, 2_000)).toEqual({ v: 1, failing: 2, stale: 0 });

    rig.tree.write("src/a.js", "bad no-console\n");
    await rig.revise();
    const news = tellLint(rig.source, me, 2_100, () => ownAfter(1));
    expect(lintLines(news ?? expect.unreachable(), "squeal")).toEqual([
      "FAIL lint: src/a.js: 1 finding, +1 no-console (no-console found)",
      "FAIL lint: src/a.js (oxlint): 1 finding, +1 no-console (no-console found)",
    ]);
    expect(tellLint(rig.source, me, 2_101, () => ownAfter(1))).toBeNull();

    rig.tree.write("src/a.js", "ok\n");
    await rig.revise();
    const fixed = tellLint(rig.source, me, 2_200, () => ownAfter(1));
    expect(lintLines(fixed ?? expect.unreachable(), "squeal")).toEqual([
      "PASS lint: src/a.js: no findings",
      "PASS lint: src/a.js (oxlint): no findings",
    ]);
  });

  it("lists each tool's findings in squeal lint and --changed, naming oxlint", async () => {
    const rig = await bothRig({ "src/a.js": "ok\n" });
    rig.tree.write("src/a.js", "bad no-console\n");
    await rig.revise();
    const details = lintDetails(rig.source, rig.tree.id) ?? expect.unreachable();
    expect(details.files.map((f) => [f.path, f.tool, f.outcome])).toEqual([
      ["src/a.js", undefined, "fail"],
      ["src/a.js", "oxlint", "fail"],
    ]);
    expect(Object.keys(details.files[0] ?? {})).not.toContain("tool");
    const text = formatLintDetails(details, null);
    expect(text).toContain("  src/a.js: 1 finding, linted at revision 2\n");
    expect(text).toContain("  src/a.js (oxlint): 1 finding, linted at revision 2\n");
    expect(text).toMatch(/^Lint: 2 files with findings$/m);

    // A path asked for lists the checks it holds, once each.
    const asked = lintDetails(rig.source, rig.tree.id, ["src/a.js", "src"]);
    expect(asked?.files.map((f) => f.tool ?? "eslint")).toEqual(["eslint", "oxlint"]);

    const changed = lintChanged(rig.source, rig.tree.id, session(1)) ?? expect.unreachable();
    expect(changed.entries.map((e) => [e.path, e.tool, e.kind, e.outcome])).toEqual([
      ["src/a.js", undefined, "pass-to-fail", "fail"],
      ["src/a.js", "oxlint", "pass-to-fail", "fail"],
    ]);
    expect(formatLintChanged(changed)).toContain(
      "  FAIL lint: src/a.js (oxlint): 1 finding, +1 no-console (no-console found); at revision 2",
    );
  });

  it("tells an oxlint off reason beside ESLint's counts; a tool not installed says nothing", async () => {
    const rig = await bothRig({ "src/a.js": "bad no-undef\n" });
    const typeAware = "oxlint with type-aware rules is not supported yet";
    rig.oxlint.declaration = { off: typeAware };
    rig.tree.write(".oxlintrc.json", '{ "options": { "typeAware": true } }\n');
    await rig.revise();
    const off = status(rig.tree, rig.source);
    expect(off.off).toBeUndefined();
    expect(off.toolsOff).toEqual([typeAware]);
    // The off tool's last results stay counted, as an off ESLint's stay stored; its line says why.
    expect(lintStatusLines(off, "squeal")).toEqual([
      "Lint: 2 files with findings; squeal lint lists them.",
      `Lint: off: ${typeAware}.`,
    ]);

    rig.oxlint.declaration = { off: "no oxlint installed in /x" };
    rig.tree.write(".oxlintrc.json", "{}\n");
    await rig.revise();
    const quiet = status(rig.tree, rig.source);
    expect(quiet).not.toHaveProperty("off");
    expect(quiet).not.toHaveProperty("toolsOff");
    expect(lintStatusLines(quiet, "squeal")).toEqual([
      "Lint: 2 files with findings; squeal lint lists them.",
    ]);
  });

  it("with neither tool linting, tells ESLint's off reason as the release before did", async () => {
    const rig = await bothRig({ "src/a.js": "ok\n" });
    rig.eslint.declaration = { off: "no ESLint installed in /x" };
    rig.oxlint.declaration = { off: "no oxlint installed in /x" };
    rig.tree.write("package.json", "{}\n");
    await rig.revise();
    const off = status(rig.tree, rig.source);
    expect(lintStatusLines(off, "squeal")).toEqual(["Lint: off: no ESLint installed in /x."]);
  });
});
