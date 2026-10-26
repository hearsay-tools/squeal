import { describe, expect, it } from "vitest";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { FakeProvider, history, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/* Spec 017 D5: every key part re-keys its file; goal 7: a key is shared between worktrees. */

/** A tree of two files, `a` failing, after its first pass; the pass and provider as given. */
async function linted(over: Parameters<typeof lintPass>[2] = {}, provider = new FakeProvider()) {
  const tree = lintTree().write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
  tree.revise();
  const rig = lintPass(tree, provider, over);
  rig.pass.nudge();
  await rig.pass.idle();
  expect(provider.calls).toEqual([["src/a.js", "src/b.js"]]);
  return { tree, provider, ...rig };
}

/** One more revision of `tree`, and the pass after it. */
async function revise(rig: Awaited<ReturnType<typeof linted>>, edit: (t: FakeWorktree) => void) {
  edit(rig.tree);
  rig.tree.revise();
  rig.pass.nudge();
  await rig.pass.idle();
  return rig.provider.calls.slice(1);
}

/** A second daemon's pass over the same tree after the first closed, with `provider`. */
async function restarted(
  rig: Awaited<ReturnType<typeof linted>>,
  provider: FakeProvider,
  nodeMajor?: number,
) {
  await rig.pass.close();
  const next = lintPass(rig.tree, provider, nodeMajor === undefined ? {} : { nodeMajor });
  next.pass.nudge();
  await next.pass.idle();
  await next.pass.close();
  return provider.calls;
}

describe("each key part re-keys its file (spec 017 D5)", () => {
  it("the file's blob: only the edited file lints again", async () => {
    const rig = await linted();
    expect(await revise(rig, (t) => t.write("src/b.js", "ok\nok\n"))).toEqual([["src/b.js"]]);
  });

  it("the file's computed config: a worktree whose config differs for one file lints only it", async () => {
    const rig = await linted();
    const provider = new FakeProvider();
    provider.configs.set("src/b.js", '{"rules":{"semi":"error"}}');
    const other = lintTree("w2", rig.tree.commonDir)
      .write("src/a.js", "bad no-undef\n")
      .write("src/b.js", "ok\n");
    other.revise();
    const two = lintPass(other, provider);
    two.pass.nudge();
    await two.pass.idle();
    expect(provider.calls).toEqual([["src/b.js"]]);
    await two.pass.close();
  });

  it("a file the config loaded: a new thread, and every file lints again with no transition", async () => {
    const rig = await linted();
    rig.provider.closure = ["eslint.config.js", "rules/local.mjs"];
    await rig.pass.close();
    rig.tree.write("rules/local.mjs", "module.exports = {};\n");
    rig.tree.revise();
    const next = lintPass(rig.tree, rig.provider);
    next.pass.nudge();
    await next.pass.idle();
    expect(rig.provider.calls.at(-1)).toEqual(["src/a.js", "src/b.js"]);
    rig.tree.write("rules/local.mjs", "module.exports = { meta: {} };\n");
    rig.tree.revise();
    next.pass.nudge();
    await next.pass.idle();
    expect(rig.provider.refreshes.slice(-1)).toEqual(["thread"]);
    expect(rig.provider.calls.slice(-1)).toEqual([["src/a.js", "src/b.js"]]);
    expect(history(storeOf(rig.tree), rig.tree, "src/a.js")).toEqual([]);
    await next.pass.close();
  });

  it("a nested flat config (017-04: ESLint reads one per directory): a new instance, every file re-keyed with no transition", async () => {
    const rig = await linted();
    rig.provider.off.add("no-undef");
    const calls = await revise(rig, (t) => t.write("src/eslint.config.js", "export default [];\n"));
    expect(rig.provider.refreshes.slice(-1)).toEqual(["instance"]);
    expect(calls).toEqual([["src/eslint.config.js", "src/a.js", "src/b.js"]]);
    expect(outcomes(storeOf(rig.tree), rig.tree)["src/a.js"]).toBe("pass");
    expect(history(storeOf(rig.tree), rig.tree, "src/a.js")).toEqual([]);
    await rig.pass.close();
  });

  it("the installed packages the config loaded: an install re-keys every file on a new thread", async () => {
    const provider = new FakeProvider();
    provider.packages = ["node_modules/eslint-plugin-x"];
    const rig = await linted({}, provider);
    provider.installed = "install-2";
    const calls = await revise(rig, (t) => t.write("node_modules/.package-lock.json", "{}\n"));
    expect(provider.refreshes).toEqual(["none", "thread"]);
    expect(calls).toEqual([["src/a.js", "src/b.js"]]);
  });

  it("no package loaded: an install changes no key", async () => {
    const rig = await linted();
    rig.provider.installed = "install-2";
    expect(await revise(rig, (t) => t.write("node_modules/.package-lock.json", "{}\n"))).toEqual(
      [],
    );
    expect(rig.provider.refreshes).toEqual(["none", "thread"]);
  });

  it("ESLint's version, the provider's version, a keyed variable and Node's major", async () => {
    const changes: [string, (p: FakeProvider) => void, number?][] = [
      ["eslint", (p) => (p.declaration = { ...declarationOf(p), toolVersion: "10.0.0" })],
      ["provider", (p) => (p.declaration = { ...declarationOf(p), providerVersion: 2 })],
      ["env", (p) => (p.env = { ...p.env, TSESTREE_SINGLE_RUN: "false" })],
      ["node", () => {}, 26],
    ];
    for (const [part, change, nodeMajor] of changes) {
      const rig = await linted({ nodeMajor: 24 });
      const provider = new FakeProvider();
      change(provider);
      expect(await restarted(rig, provider, nodeMajor ?? 24), part).toEqual([
        ["src/a.js", "src/b.js"],
      ]);
    }
  });

  it("nothing moved: a restarted daemon lints nothing", async () => {
    const rig = await linted({ nodeMajor: 24 });
    expect(await restarted(rig, new FakeProvider(), 24)).toEqual([]);
  });
});

describe("results are shared by key (goal 7)", () => {
  it("a second worktree at the same bytes, config and packages lints nothing", async () => {
    const dir = commonDir();
    const files = (id: string) =>
      lintTree(id, dir).write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
    const first = files("w1");
    first.revise();
    const one = lintPass(first, new FakeProvider());
    one.pass.nudge();
    await one.pass.idle();

    const second = files("w2");
    second.revise();
    const provider = new FakeProvider();
    const two = lintPass(second, provider);
    two.pass.nudge();
    await two.pass.idle();
    expect(provider.calls).toEqual([]);
    expect(two.reports.map((r) => [r.mode, r.hits, r.linted])).toEqual([["first", 2, 0]]);
    expect(outcomes(storeOf(second), second)).toEqual({ "src/a.js": "fail", "src/b.js": "pass" });
    await one.pass.close();
    await two.pass.close();
  });
});

function declarationOf(provider: FakeProvider) {
  if ("off" in provider.declaration) throw new Error("the provider is off");
  return provider.declaration;
}
