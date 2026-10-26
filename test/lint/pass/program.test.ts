import { describe, expect, it } from "vitest";
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

  it("a lint report that grows the program makes the whole-program files stale", async () => {
    const rig = await program(
      { "src/a.js": "ok\n", "src/b.js": "ok\n", "src/c.d.ts": "type C = 1;\n" },
      (p) => {
        p.program = ["src/a.js"];
        p.linted = ["src/a.js", "src/c.d.ts"];
        p.wholeProgram.add("src/a.js");
      },
    );
    // The first pass's report named `c.d.ts`: the pass keyed again at once, and `a` is stale.
    expect(rig.provider.calls).toEqual([["src/a.js", "src/b.js"]]);
    expect(rig.reports.map((r) => [r.mode, r.stale])).toEqual([
      ["first", 0],
      ["edit", 1],
    ]);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual({
      "src/a.js": "pass+stale",
      "src/b.js": "pass",
    });
    await rig.pass.close();
  });
});
