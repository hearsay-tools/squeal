import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLintPass, type LintPassReport } from "../../../src/core/lint/pass/index.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir, LINT_ON, open } from "../helpers.js";
import { FIXTURES, install, provider, sources } from "../provider/helpers.js";

/*
 * Review 0.1.348 B3 with the real provider and pass: `t.ts` imports
 * `u.ts`, which neither the tsconfig's `include` nor ESLint lints. A second
 * worktree on the same lint store changes only `u.ts`; its pass must lint
 * `t.ts` again, not take the first worktree's pass at the same key. And an
 * edit's new import is in the keys of the pass after it (wave 1.5).
 */

const PROMISE = (text: string) =>
  text.replace(
    "export function load(): number {\n  return 1;",
    "export function load(): Promise<number> {\n  return Promise.resolve(1);",
  );

/** The fixture project in `tree`, the tsconfig narrowed to `t.ts` and `u.ts` ESLint-ignored. */
function narrowed(tree: FakeWorktree, u: (text: string) => string = (text) => text): void {
  for (const path of sources("project")) {
    let text = readFileSync(join(FIXTURES, "project", path), "utf8");
    if (path === "tsconfig.json") text = text.replace('"src/**/*.ts"', '"src/t.ts"');
    if (path === "eslint.config.js")
      text = text.replace('"eslint.config.js"]', '"eslint.config.js", "src/u.ts"]');
    if (path === "src/u.ts") text = u(text);
    tree.write(path, text);
  }
  install(tree.root, "project");
  tree.revise();
}

/** The daemon's lint pass over `tree` with the real provider, kept open between revisions. */
function daemon(tree: FakeWorktree) {
  const reports: LintPassReport[] = [];
  const errors: Error[] = [];
  const pass = createLintPass({
    worktreeId: tree.id,
    root: tree.root,
    commonDir: tree.commonDir,
    format: "sha1",
    source: tree.source,
    policy: () => LINT_ON,
    provider: () => provider(tree.root),
    installed: () => Promise.resolve("install-1"),
    log: () => {},
    onError: (error) => errors.push(error),
    onPass: (report) => reports.push(report),
  });
  return {
    reports,
    /** A pass at the latest revision, and `t.ts`'s state and findings after it. */
    async run() {
      pass.nudge();
      await pass.idle();
      expect(errors).toEqual([]);
      const store = open(tree.commonDir);
      const state = store.states.list(tree.id, { paths: ["src/t.ts"] })[0];
      const check = { kind: "lint", path: "src/t.ts", tool: "eslint" } as const;
      const result = state?.judged ? store.results.get(check, state.judged.key) : null;
      return { state, rules: result?.findings.map((f) => f.rule) };
    },
    close: () => pass.close(),
  };
}

/** One pass of a new daemon over `tree`. */
async function passOver(tree: FakeWorktree) {
  const one = daemon(tree);
  const after = await one.run();
  await one.close();
  return { ...after, reports: one.reports };
}

describe("a changed import target outside include and ESLint's ignores (review 0.1.348 B3)", () => {
  it("moves the importer's key, so a second worktree lints it and finds the floating promise", async () => {
    const dir = commonDir();
    const first = new FakeWorktree("w1", dir);
    narrowed(first);
    const one = await passOver(first);
    expect(one.state?.outcome).toBe("pass");

    const second = new FakeWorktree("w2", dir);
    narrowed(second, PROMISE);
    const two = await passOver(second);
    expect(two.state?.judged?.key).not.toBe(one.state?.judged?.key);
    expect(two.reports.reduce((n, r) => n + r.linted, 0)).toBeGreaterThan(0);
    expect(two.state).toMatchObject({ outcome: "fail", stale: false });
    expect(two.rules).toEqual(["@typescript-eslint/no-floating-promises"]);
  }, 120_000);
});

describe("an edit's new import of a file outside the listing (wave 1.5)", () => {
  it("is in the keys of the pass after it, so a worktree whose copy differs gets no false hit", async () => {
    const dir = commonDir();
    const made = (returns: string, body: string) =>
      `export function made(): ${returns} {\n  return ${body};\n}\n`;
    const trees = [new FakeWorktree("w1", dir), new FakeWorktree("w2", dir)];
    for (const [tree, gen] of [
      [trees[0], made("number", "1")],
      [trees[1], made("Promise<number>", "Promise.resolve(1)")],
    ] as const) {
      if (tree === undefined) throw new Error("no tree");
      narrowed(tree);
      // Generated and git-ignored: on disk, outside the listing.
      writeFileSync(join(tree.root, "src/gen.ts"), gen);
    }
    const daemons = trees.map(daemon);
    for (const one of daemons) expect((await one.run()).state?.outcome).toBe("pass");

    // Both worktrees make the same edit: `t.ts` imports `gen.ts` and calls it.
    for (const tree of trees) {
      const text = readFileSync(join(tree.root, "src/t.ts"), "utf8");
      tree.write(
        "src/t.ts",
        `import { made } from "./gen.js";\n${text.replace("  load();\n", "  load();\n  made();\n")}`,
      );
      tree.revise();
    }
    const [one, two] = daemons;
    if (one === undefined || two === undefined) throw new Error("no daemon");
    const first = await one.run();
    expect(first.state).toMatchObject({ outcome: "pass", stale: false });
    const second = await two.run();
    expect(second.state?.judged?.key).not.toBe(first.state?.judged?.key);
    expect(second.state).toMatchObject({ outcome: "fail", stale: false });
    expect(second.rules).toEqual(["@typescript-eslint/no-floating-promises"]);
    for (const each of daemons) await each.close();
  }, 120_000);
});
