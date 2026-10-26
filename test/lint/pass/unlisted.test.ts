import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/*
 * Wave 1.6 (review 0.1.348-r2 B2-R, B3-R): the key inputs outside the
 * listing, the config's closure and the program's files, are read on disk
 * at each pass before any lookup.
 */

/** Writes `path` on disk only: outside the listing, as a generated or git-ignored file. */
function unlisted(tree: FakeWorktree, path: string, text: string): void {
  mkdirSync(dirname(join(tree.root, path)), { recursive: true });
  writeFileSync(join(tree.root, path), text);
}

describe("a file the config loaded outside the listing", () => {
  it("is keyed at its bytes on disk, and a missing one apart from an existing one", async () => {
    const dir = commonDir();
    const calls = async (id: string, rule: string | null) => {
      const tree = lintTree(id, dir).write("src/a.js", "ok\n");
      if (rule !== null) unlisted(tree, "rules/local.mjs", rule);
      tree.revise();
      const provider = new FakeProvider();
      provider.closure = ["eslint.config.js", "rules/local.mjs"];
      const rig = lintPass(tree, provider);
      rig.pass.nudge();
      await rig.pass.idle();
      await rig.pass.close();
      return provider.calls;
    };
    expect(await calls("w1", "export default 1;\n")).toEqual([["src/a.js"]]);
    expect(await calls("w2", "export default 2;\n")).toEqual([["src/a.js"]]);
    expect(await calls("w3", null)).toEqual([["src/a.js"]]);
    expect(await calls("w4", "export default 1;\n")).toEqual([]);
  });

  it("an edit with no revision: a new thread, and every file keyed again with no transition", async () => {
    const tree = lintTree().write("src/a.js", "ok\n").write("src/b.js", "ok\n");
    unlisted(tree, "rules/local.mjs", "export default 1;\n");
    tree.revise();
    const provider = new FakeProvider();
    provider.closure = ["eslint.config.js", "rules/local.mjs"];
    const rig = lintPass(tree, provider);
    rig.pass.nudge();
    await rig.pass.idle();
    unlisted(tree, "rules/local.mjs", "export default 2;\n");
    rig.pass.nudge();
    await rig.pass.idle();
    expect(provider.refreshes).toEqual(["none", "thread"]);
    expect(provider.calls).toEqual([
      ["src/a.js", "src/b.js"],
      ["src/a.js", "src/b.js"],
    ]);
    expect(rig.reports.map((r) => r.mode)).toEqual(["first", "config"]);
    await rig.pass.close();
  });
});

describe("a program file outside the listing", () => {
  /**
   * Two whole-program files over an unlisted `gen/c.d.ts` and `types`
   * listed declaration files, after their first pass.
   */
  async function generated(types = 0) {
    const tree = lintTree().write("src/a.js", "ok\n").write("src/b.js", "ok\n");
    const declarations = Array.from({ length: types }, (_, i) => `types/t${i}.d.ts`);
    for (const path of declarations) tree.write(path, "export {};\n");
    unlisted(tree, "gen/c.d.ts", "type C = 1;\n");
    tree.revise();
    const provider = new FakeProvider();
    provider.program = ["src/a.js", "src/b.js", ...declarations, "gen/c.d.ts"];
    provider.wholeProgram.add("src/a.js").add("src/b.js");
    const clock = { idle: false };
    const rig = lintPass(tree, provider, { idleIn: () => (clock.idle ? 0 : 60_000) });
    rig.pass.nudge();
    await rig.pass.idle();
    expect(provider.calls).toEqual([["src/a.js", "src/b.js"]]);
    return { tree, provider, clock, ...rig };
  }

  it("an edit with no revision: the program is read again, the file fed, the others stale", async () => {
    const rig = await generated();
    unlisted(rig.tree, "gen/c.d.ts", "type C = 2;\n");
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes).toEqual(["none", "none"]);
    expect(rig.provider.calls.slice(1)).toEqual([["gen/c.d.ts"]]);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual({
      "src/a.js": "pass+stale",
      "src/b.js": "pass+stale",
    });
    // Nothing moved since: no refresh, no feed.
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes).toHaveLength(2);
    expect(rig.provider.calls).toHaveLength(2);
    await rig.pass.close();
  });

  it("among more inputs than are looked up one by one, it is told from the listed ones", async () => {
    const rig = await generated(80);
    unlisted(rig.tree, "gen/c.d.ts", "type C = 2;\n");
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes).toEqual(["none", "none"]);
    expect(rig.provider.calls.slice(1)).toEqual([["gen/c.d.ts"]]);
    await rig.pass.close();
  });

  it("an edit beside a revision that names no module file is fed in that pass", async () => {
    const rig = await generated();
    unlisted(rig.tree, "gen/c.d.ts", "type C = 2;\n");
    rig.tree.write("README.md", "# readme\n");
    rig.tree.revise();
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes).toEqual(["none", "none"]);
    expect(rig.provider.calls.slice(1)).toEqual([["gen/c.d.ts"]]);
    await rig.pass.close();
  });

  it("moving through every refresh: the pass keys nothing, and the next one refreshes and feeds it", async () => {
    const rig = await generated();
    const refresh = rig.provider.refresh.bind(rig.provider);
    let writes = 10;
    rig.provider.refresh = (level) => {
      unlisted(rig.tree, "gen/c.d.ts", `type C = ${writes++};\n`);
      return refresh(level);
    };
    unlisted(rig.tree, "gen/c.d.ts", "type C = 2;\n");
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes).toEqual(["none", "none", "none", "none"]);
    expect(rig.reports).toHaveLength(1);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual({
      "src/a.js": "pass",
      "src/b.js": "pass",
    });

    // Still now: the refresh left due runs, the file is fed, and the others read stale.
    rig.provider.refresh = refresh;
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes.slice(4)).toEqual(["none"]);
    expect(rig.provider.calls.slice(1)).toEqual([["gen/c.d.ts"]]);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual({
      "src/a.js": "pass+stale",
      "src/b.js": "pass+stale",
    });
    await rig.pass.close();
  });

  it("deleted: a new thread, since the worker's TypeScript service keeps what it read", async () => {
    const rig = await generated();
    rmSync(join(rig.tree.root, "gen/c.d.ts"));
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.refreshes).toEqual(["none", "thread"]);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual({
      "src/a.js": "pass+stale",
      "src/b.js": "pass+stale",
    });
    await rig.pass.close();
  });
});

describe("a changed program file in a config keying", () => {
  it("is fed too: a new instance keeps the worker's TypeScript service", async () => {
    const tree = lintTree()
      .write("src/a.js", "ok\n")
      .write("src/b.js", "ok\n")
      .write("src/c.d.ts", "type C = 1;\n");
    tree.revise();
    const provider = new FakeProvider();
    provider.program = ["src/a.js", "src/b.js", "src/c.d.ts"];
    provider.wholeProgram.add("src/a.js").add("src/b.js");
    const rig = lintPass(tree, provider);
    rig.pass.nudge();
    await rig.pass.idle();
    tree.write("src/eslint.config.js", "export default [];\n").write("src/c.d.ts", "type C = 2;\n");
    tree.revise();
    rig.pass.nudge();
    await rig.pass.idle();
    expect(provider.refreshes).toEqual(["none", "instance"]);
    expect(provider.calls.slice(1)[0]).toContain("src/c.d.ts");
    await rig.pass.close();
  });
});
