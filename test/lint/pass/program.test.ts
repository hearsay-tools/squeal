import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LINT_ON } from "../helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/* Spec 017 D5 as amended 2026-10-26: whole-program files, one program segment, stale until idle. */

/** Three whole-program files after their first pass, with stale files waiting while `idle` is false. */
async function program(files: Record<string, string>, configure: (p: FakeProvider) => void) {
  const tree = lintTree();
  for (const [path, text] of Object.entries(files)) tree.write(path, text);
  tree.revise();
  const provider = new FakeProvider();
  configure(provider);
  const clock = { idle: false };
  const rig = lintPass(tree, provider, { idleIn: () => (clock.idle ? 0 : 60_000) });
  rig.pass.nudge();
  await rig.pass.idle();
  return { tree, provider, clock, ...rig };
}

describe("whole-program files (spec 017 D5)", () => {
  it("an import rule's file, with no program: an edit to another file it may import makes it stale", async () => {
    // A JavaScript project with import rules only: no tsconfig program. The segment holds every
    // file ESLint lints, so `a`'s key moves when `b` changes (D5 as amended 2026-10-26).
    const rig = await program(
      { "src/a.js": "bad import/no-unresolved\n", "src/b.js": "ok\n", "src/c.js": "ok\n" },
      (p) => p.wholeProgram.add("src/a.js").add("src/c.js"),
    );
    expect(rig.provider.calls).toEqual([["src/a.js", "src/b.js", "src/c.js"]]);
    rig.tree.write("src/b.js", "ok\nok\n");
    rig.tree.revise();
    rig.pass.nudge();
    await rig.pass.idle();
    // The changed file lints at once; the others keep their outcome and read stale.
    expect(rig.provider.calls.slice(1)).toEqual([["src/b.js"]]);
    const store = storeOf(rig.tree);
    expect(outcomes(store, rig.tree)).toEqual({
      "src/a.js": "fail+stale",
      "src/b.js": "pass",
      "src/c.js": "pass+stale",
    });
    expect(rig.reports.at(-1)).toMatchObject({ mode: "edit", stale: 2, linted: 1 });

    // Idle: the stale files lint in a part of their own and read current.
    rig.clock.idle = true;
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.calls.slice(2)).toEqual([["src/a.js", "src/c.js"]]);
    expect(outcomes(store, rig.tree)).toEqual({
      "src/a.js": "fail",
      "src/b.js": "pass",
      "src/c.js": "pass",
    });
    await rig.pass.close();
  });

  it("feeds every changed program file in the edit's lint call, hits and unlinted files included", async () => {
    const rig = await program(
      { "src/a.js": "ok\n", "src/b.js": "ok\n", "src/types.d.ts": "type A = 1;\n" },
      (p) => {
        p.program = ["src/a.js", "src/b.js", "src/types.d.ts"];
        p.wholeProgram.add("src/a.js").add("src/b.js");
      },
    );
    // A program file ESLint does not lint: fed, nothing stored, and the others read stale.
    rig.tree.write("src/types.d.ts", "type A = 2;\n");
    rig.tree.revise();
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.calls.slice(1)).toEqual([["src/types.d.ts"]]);
    const store = storeOf(rig.tree);
    expect(outcomes(store, rig.tree)).toEqual({
      "src/a.js": "pass+stale",
      "src/b.js": "pass+stale",
    });

    // Back to the first bytes: every key is a hit again, and the file is still fed.
    rig.tree.write("src/types.d.ts", "type A = 1;\n");
    rig.tree.revise();
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.calls.slice(2)).toEqual([["src/types.d.ts"]]);
    rig.clock.idle = true;
    rig.pass.nudge();
    await rig.pass.idle();
    expect(rig.provider.calls).toHaveLength(3);
    expect(outcomes(store, rig.tree)).toEqual({ "src/a.js": "pass", "src/b.js": "pass" });
    await rig.pass.close();
  });

  it("an extension ESLint lints that the policy leaves out: an edit to such a file makes the others stale", async () => {
    const tree = lintTree()
      .write("src/a.js", "ok\n")
      .write("src/c.vue", "ok\n")
      .write("notes.md", "one\n");
    tree.revise();
    const provider = new FakeProvider();
    provider.extensions.add(".vue");
    provider.wholeProgram.add("src/a.js");
    const policy = { ...LINT_ON, lint: { ...LINT_ON.lint, exclude: ["src/c.vue"] } };
    const rig = lintPass(tree, provider, { policy: () => policy, idleIn: () => 60_000 });
    const step = async (path: string, text: string) => {
      tree.write(path, text);
      tree.revise();
      rig.pass.nudge();
      await rig.pass.idle();
      return outcomes(storeOf(tree), tree);
    };
    rig.pass.nudge();
    await rig.pass.idle();
    expect(provider.calls).toEqual([["src/a.js"]]);
    // A file of no extension ESLint lints keeps its bytes out of the segment; its path is in.
    expect(await step("notes.md", "two\n")).toEqual({ "src/a.js": "pass" });
    expect(await step("src/c.vue", "ok\nok\n")).toEqual({ "src/a.js": "pass+stale" });
    expect(provider.calls).toHaveLength(1);
    await rig.pass.close();
  });

  it("a lint report that names a listed module file the program did not hold stores at once", async () => {
    // The segment already holds every listed module file's blob (D5 as amended for review 0.1.348 B1).
    const rig = await program(
      { "src/a.js": "ok\n", "src/b.js": "ok\n", "src/c.d.ts": "type C = 1;\n" },
      (p) => {
        p.program = ["src/a.js"];
        p.linted = ["src/a.js", "src/c.d.ts"];
        p.wholeProgram.add("src/a.js");
      },
    );
    expect(rig.provider.calls).toEqual([["src/a.js", "src/b.js"]]);
    expect(rig.reports.map((r) => r.mode)).toEqual(["first"]);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual({
      "src/a.js": "pass",
      "src/b.js": "pass",
    });
    await rig.pass.close();
  });
});

describe("a lint report that names an input its keys did not hold (D5, review 0.1.348 B3)", () => {
  /** `a` whole-program and `b` not, a listed `rules/late.mjs` and an unlisted `gen/c.d.ts`. */
  function grownTree(id: string, dir?: string) {
    const tree = lintTree(id, dir)
      .write("src/a.js", "ok\n")
      .write("src/b.js", "ok\n")
      .write("rules/late.mjs", "export {};\n");
    mkdirSync(join(tree.root, "gen"));
    writeFileSync(join(tree.root, "gen/c.d.ts"), "type C = 1;\n");
    tree.revise();
    const provider = new FakeProvider();
    provider.program = ["src/a.js"];
    provider.wholeProgram.add("src/a.js");
    return { tree, provider };
  }

  it.each([
    {
      input: "a program file outside the listing",
      grow: (p: FakeProvider) => {
        p.linted = ["src/a.js", "gen/c.d.ts"];
      },
      again: ["src/a.js"],
      modes: ["first", "edit"],
    },
    {
      input: "a file the config loaded",
      grow: (p: FakeProvider) => {
        p.lintedClosure = ["eslint.config.js", "rules/late.mjs"];
      },
      again: ["src/a.js", "src/b.js"],
      modes: ["first", "config"],
    },
  ])(
    "$input: nothing is stored at the keys it was linted at; another worktree's lookup misses",
    async ({ grow, again, modes }) => {
      const one = grownTree("w1");
      grow(one.provider);
      const first = lintPass(one.tree, one.provider);
      first.pass.nudge();
      await first.pass.idle();
      // The files the grown input changes lint again at their new keys; the pass keys again at once.
      expect(one.provider.calls).toEqual([["src/a.js", "src/b.js"], again]);
      expect(first.reports.map((r) => r.mode)).toEqual(modes);
      expect(outcomes(storeOf(one.tree), one.tree)).toEqual({
        "src/a.js": "pass",
        "src/b.js": "pass",
      });
      await first.pass.close();

      // A second worktree whose provider does not report the input yet keys as the first did at
      // first: no answer may wait at those keys.
      const two = grownTree("w2", one.tree.commonDir);
      const second = lintPass(two.tree, two.provider);
      second.pass.nudge();
      await second.pass.idle();
      expect(two.provider.calls[0]).toEqual(again);
      await second.pass.close();
    },
  );
});
