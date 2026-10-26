import { readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { lintCheck } from "../../../src/core/lint/pass/judge.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { Policy } from "../../../src/core/types/index.js";
import type { LintFinding } from "../../../src/core/types/lint.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir, LINT_ON } from "../helpers.js";
import { lintPass, outcomes, storeOf } from "../pass/helpers.js";
import { cli, project, provider } from "../provider/helpers.js";

/*
 * Review 0.1.348 B1: neither Squeal's policy nor ESLint's ignores take an
 * import target out of the program segment (spec 017 D5 as amended). The
 * real provider and pass over `test/fixtures/lint/project`, whose `a.js`
 * imports `x` from `b.js` under a rule that reads `b.js` from disk.
 */

/** Every file under `dir` but `node_modules`, by its path from `root`. */
function filesOf(root: string, dir = root, files = new Map<string, string>()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.name === "node_modules") continue;
    if (entry.isDirectory()) filesOf(root, path, files);
    else files.set(relative(root, path), readFileSync(path, "utf8"));
  }
  return files;
}

/** The fixture, after `change`, as a worktree the pass lists; its `node_modules` linked, not listed. */
function fixture(change: (files: Map<string, string>) => void): FakeWorktree {
  const copy = project("project");
  const files = filesOf(copy);
  change(files);
  const tree = new FakeWorktree("w1", commonDir());
  for (const [path, text] of files) tree.write(path, text);
  symlinkSync(join(copy, "node_modules"), join(tree.root, "node_modules"));
  tree.revise();
  return tree;
}

const brief = (findings: readonly LintFinding[]) =>
  findings.map((f) => `${f.line}:${f.rule} ${f.message}`).sort();

/** `path`'s findings at the key its state was judged at. */
function stored(store: LintStore, tree: FakeWorktree, path: string): string[] {
  const state = store.states.list(tree.id, { paths: [path] })[0];
  const key = state?.judged?.key;
  const result = key === undefined ? null : store.results.get(lintCheck(path), key);
  return brief(result?.findings ?? []);
}

/** `path`'s findings from a fresh `eslint -f json` run. */
function fresh(tree: FakeWorktree, path: string): string[] {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? brief(result.findings) : [];
}

const withLint = (lint: Partial<Policy["lint"]>): Policy => ({
  ...LINT_ON,
  lint: { ...LINT_ON.lint, ...lint },
});

describe("an import target the checks leave out stays in the program segment (review 0.1.348 B1)", () => {
  it.each([
    {
      left: "Squeal's lint.exclude",
      policy: withLint({ exclude: ["src/b.js"] }),
      change: () => {},
    },
    {
      left: "Squeal's lint.include",
      policy: withLint({ include: ["src/a.js"] }),
      change: () => {},
    },
    {
      left: "ESLint's ignores, in a JavaScript project",
      policy: LINT_ON,
      change: (files: Map<string, string>) => {
        for (const path of ["src/t.ts", "src/u.ts", "tsconfig.json"]) files.delete(path);
        const config = files.get("eslint.config.js") ?? "";
        files.set(
          "eslint.config.js",
          config.replace('"eslint.config.js"]', '"eslint.config.js", "src/b.js"]'),
        );
      },
    },
  ])(
    "$left: an edit to the target makes the importer stale, and idle lints it as ESLint does",
    async ({ policy, change }) => {
      const tree = fixture(change);
      const clock = { idle: false };
      const rig = lintPass(tree, provider(tree.root), {
        policy: () => policy,
        idleIn: () => (clock.idle ? 0 : 60_000),
      });
      rig.pass.nudge();
      await rig.pass.idle();
      expect(rig.errors).toEqual([]);
      const store = storeOf(tree);
      expect(outcomes(store, tree)["src/a.js"]).toBe("fail");
      expect(outcomes(store, tree)["src/b.js"]).toBeUndefined();
      expect(stored(store, tree, "src/a.js")).toEqual(fresh(tree, "src/a.js"));

      // Only the target changes, and it no longer exports `x`.
      tree.write("src/b.js", "export const other = 1;\n");
      tree.revise();
      rig.pass.nudge();
      await rig.pass.idle();
      expect(outcomes(store, tree)["src/a.js"]).toBe("fail+stale");

      clock.idle = true;
      rig.pass.nudge();
      await rig.pass.idle();
      expect(outcomes(store, tree)["src/a.js"]).toBe("fail");
      const now = fresh(tree, "src/a.js");
      expect(now.some((f) => f.includes("import-x/named x not found in './b.js'"))).toBe(true);
      expect(stored(store, tree, "src/a.js")).toEqual(now);
      await rig.pass.close();
    },
    60_000,
  );
});
